import { Actor, log } from 'apify';
import { fetchSearchPage, PAGE_SIZE, warmUpSession } from './blinkitApi.js';
import { normalizeInput } from './input.js';
import { extractProducts, isBlockedPage } from './routes.js';
import type { ActorInput, ProductRecord } from './types.js';

await Actor.init();

const input = (await Actor.getInput<ActorInput>()) ?? {};
const normalizedInput = normalizeInput(input);
const {
    searchQueries,
    locationName,
    latitude,
    longitude,
    inStockOnly,
    minPrice,
    maxPrice,
    maxResults,
    maxPagesPerQuery,
    proxyConfiguration: proxyInput,
} = normalizedInput;
const brands = new Set(normalizedInput.brands.map((value) => value.toLowerCase()));

const proxyConfiguration = await Actor.createProxyConfiguration(proxyInput);

const seenProductIds = new Set<string>();
let savedCount = 0;
let spendingLimitReached = false;
let fatalBillingError: Error | null = null;
const skippedQueries: Array<{ query: string; reason: string }> = [];

log.info('Starting Blinkit scrape', {
    searchQueries,
    locationName,
    latitude,
    longitude,
    maxResults,
    maxPagesPerQuery,
});

/** Collects the search payloads for one query, stopping as soon as enough products exist. */
async function collectPayloadsForQuery(query: string, queryIndex: number, remaining: number): Promise<unknown[]> {
    const payloads: unknown[] = [];
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
            const proxyUrl = await proxyConfiguration?.newUrl(`blinkit_${queryIndex}_${attempt}`);
            const { session, statusCode, html } = await warmUpSession(query, proxyUrl);

            if (statusCode >= 400) throw new Error(`Blinkit storefront returned HTTP ${statusCode}`);
            if (await isBlockedPage('', html)) throw new Error('Blinkit storefront returned a challenge page');

            payloads.length = 0;
            for (let pageIndex = 0; pageIndex < maxPagesPerQuery; pageIndex += 1) {
                const page = await fetchSearchPage({
                    query,
                    latitude,
                    longitude,
                    session,
                    pageIndex,
                    proxyUrl,
                });

                if (page.statusCode >= 400) {
                    if (pageIndex === 0) throw new Error(`Blinkit search API returned HTTP ${page.statusCode}`);
                    log.warning(`Stopping "${query}" at page ${pageIndex + 1}: HTTP ${page.statusCode}`);
                    break;
                }
                if (await isBlockedPage('', page.bodyText)) {
                    throw new Error('Blinkit search API returned a challenge page');
                }
                if (page.payload === null) {
                    if (pageIndex === 0) throw new Error('Blinkit search API returned an unreadable response');
                    break;
                }

                const before = extractProducts(payloads, query, locationName).length;
                payloads.push(page.payload);
                const after = extractProducts(payloads, query, locationName).length;

                // A page that adds no new products means the result set is exhausted.
                if (after === before) break;
                if (after >= remaining) break;
                if (after - before < PAGE_SIZE / 2) break;
            }

            if (payloads.length === 0) throw new Error('Blinkit returned no search payloads');
            return payloads;
        } catch (error) {
            lastError = error;
            log.warning(`Blinkit attempt ${attempt}/3 failed for "${query}"`, { error: String(error) });
            if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 1_000 * attempt));
        }
    }

    const reason = lastError instanceof Error ? lastError.message : String(lastError);
    skippedQueries.push({ query, reason });
    log.warning(`Skipping "${query}" after repeated failures`, { reason });
    return [];
}

for (const [queryIndex, searchQuery] of searchQueries.entries()) {
    if (savedCount >= maxResults || spendingLimitReached || fatalBillingError) break;

    const remaining = maxResults - savedCount;
    const payloads = await collectPayloadsForQuery(searchQuery, queryIndex, remaining);
    if (payloads.length === 0) continue;

    const products: ProductRecord[] = extractProducts(payloads, searchQuery, locationName);
    log.info(`Parsed Blinkit search "${searchQuery}"`, {
        payloadsCaptured: payloads.length,
        productsFound: products.length,
    });

    for (const product of products) {
        if (savedCount >= maxResults || spendingLimitReached) break;

        const uniqueKey = product.productId ?? product.productUrl ?? product.title;
        if (!uniqueKey || seenProductIds.has(uniqueKey)) continue;
        if (brands.size > 0 && (!product.brand || !brands.has(product.brand.toLowerCase()))) continue;
        if (inStockOnly && !product.inStock) continue;
        if (product.price === null || product.price < minPrice || product.price > maxPrice) continue;

        try {
            // Push and charge atomically so records beyond the user's charge limit are not
            // saved for free and billing failures stop the run immediately.
            const chargeResult = await Actor.pushData(product, 'product-scraped');
            const recordWasSaved = chargeResult.chargedCount > 0 || !chargeResult.eventChargeLimitReached;

            if (recordWasSaved) {
                seenProductIds.add(uniqueKey);
                savedCount += 1;
            }

            if (chargeResult.eventChargeLimitReached) {
                spendingLimitReached = true;
                await Actor.setStatusMessage(`Stopped at the user's spending limit after ${savedCount} products`);
                log.info('User spending limit reached; stopping before more requests are made.');
                break;
            }
        } catch (error) {
            fatalBillingError = error instanceof Error ? error : new Error(String(error));
            spendingLimitReached = true;
            await Actor.setStatusMessage('Stopped because product output billing failed.');
            log.error('Stopping Blinkit run because dataset push with product-scraped charge failed.', {
                error: fatalBillingError.message,
            });
            break;
        }
    }

    if (!spendingLimitReached && !fatalBillingError) {
        await Actor.setStatusMessage(`Saved ${savedCount}/${maxResults} Blinkit products`);
        const moreQueriesLeft = queryIndex < searchQueries.length - 1;
        if (moreQueriesLeft && savedCount < maxResults) {
            await new Promise((resolve) => setTimeout(resolve, 500 + Math.floor(Math.random() * 1_000)));
        }
    }
}

if (fatalBillingError) throw fatalBillingError;

if (savedCount === 0 && !spendingLimitReached) {
    const reasons = skippedQueries.map((item) => `${item.query}: ${item.reason}`).join('; ');
    throw new Error(`Blinkit scrape failed: no products were saved.${reasons ? ` Skipped: ${reasons}` : ''} The source may be blocked, empty, or filtered out.`);
}

if (skippedQueries.length > 0) log.warning('Some Blinkit queries were skipped', { skippedQueries });
if (!spendingLimitReached) await Actor.setStatusMessage(`Finished with ${savedCount} unique products`);
log.info(`Blinkit scrape finished with ${savedCount} unique products.`);

await Actor.exit();
