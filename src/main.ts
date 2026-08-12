import { Actor, log } from 'apify';
import { PlaywrightCrawler } from 'crawlee';
import { normalizeInput } from './input.js';
import { buildSearchUrl, extractProducts, isBlockedPage } from './routes.js';
import type { ActorInput, RequestData } from './types.js';

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

const proxyConfiguration = await Actor.createProxyConfiguration(
    proxyInput,
);

const seenProductIds = new Set<string>();
let savedCount = 0;
let spendingLimitReached = false;
let fatalBillingError: Error | null = null;
let failedRequestCount = 0;

const requests = searchQueries.map((searchQuery) => ({
    url: buildSearchUrl(searchQuery),
    uniqueKey: `blinkit-${searchQuery.toLowerCase()}`,
    userData: { searchQuery } satisfies RequestData,
}));

/**
 * Blinkit is a JavaScript app whose catalogue arrives over XHR, so scripts and API calls
 * must be allowed. Images, media, fonts and stylesheets carry no data and are the bulk of
 * residential-proxy bandwidth on a grocery catalogue.
 */
const BLOCKED_RESOURCE_TYPES = new Set(['image', 'media', 'font', 'stylesheet']);

/** Keeps infinite-scroll paging inside requestHandlerTimeoutSecs. */
const SCROLL_BUDGET_MS = 150_000;

type SearchCapture = {
    payloads: unknown[];
    tasks: Set<Promise<void>>;
    detach: () => void;
};

/** Payloads are captured from the first navigation, keyed per page. */
const captures = new WeakMap<object, SearchCapture>();

const crawler = new PlaywrightCrawler({
    proxyConfiguration,
    headless: false,
    maxConcurrency: 1,
    minConcurrency: 1,
    maxRequestRetries: 3,
    maxSessionRotations: 3,
    retryOnBlocked: true,
    navigationTimeoutSecs: 90,
    requestHandlerTimeoutSecs: 240,
    maxRequestsPerCrawl: requests.length,
    sessionPoolOptions: {
        maxPoolSize: 30,
        // Deliberately empty: Crawlee warns that setting blockedStatusCodes alongside
        // retryOnBlocked stops retryOnBlocked working as expected. Blocking is detected by
        // retryOnBlocked plus the challenge-text check in isBlockedPage.
        blockedStatusCodes: [],
        sessionOptions: { maxUsageCount: 10 },
    },
    browserPoolOptions: { useFingerprints: true },
    launchContext: {
        useChrome: true,
        launchOptions: {
            args: ['--disable-blink-features=AutomationControlled', '--no-sandbox', '--disable-dev-shm-usage'],
        },
    },
    preNavigationHooks: [async ({ page }, gotoOptions) => {
        // Listen before the first navigation so the search payloads are captured on the way
        // in. Previously the page had to be reloaded to catch them, paying for it twice.
        const payloads: unknown[] = [];
        const tasks = new Set<Promise<void>>();
        const responseHandler = (response: Awaited<ReturnType<typeof page.waitForResponse>>): void => {
            const url = response.url();
            if (response.status() !== 200 || !url.includes('/v1/layout/search')) return;
            const task = response.json()
                .then((payload: unknown) => { payloads.push(payload); })
                .catch(() => undefined)
                .finally(() => { tasks.delete(task); });
            tasks.add(task);
        };

        page.on('response', responseHandler);
        captures.set(page, {
            payloads,
            tasks,
            detach: () => page.off('response', responseHandler),
        });

        await page.route('**/*', async (route) => {
            if (BLOCKED_RESOURCE_TYPES.has(route.request().resourceType())) {
                await route.abort().catch(() => { /* navigation already settled */ });
                return;
            }
            await route.continue().catch(() => { /* navigation already settled */ });
        }).catch(() => { /* best effort */ });

        await page.context().grantPermissions(['geolocation'], { origin: 'https://blinkit.com' });
        await page.context().setGeolocation({ latitude, longitude });
        await page.setExtraHTTPHeaders({
            'accept-language': 'en-IN,en;q=0.9',
        });
        page.setDefaultTimeout(15_000);
        if (gotoOptions) gotoOptions.waitUntil = 'domcontentloaded';
        await page.waitForTimeout(600 + Math.floor(Math.random() * 900));
    }],
    requestHandler: async ({ page, request, session }) => {
        if (fatalBillingError) throw fatalBillingError;
        if (savedCount >= maxResults || spendingLimitReached) return;

        const { searchQuery } = request.userData as RequestData;
        const capture = captures.get(page);
        if (!capture) throw new Error('Blinkit response capture was not initialised for this page.');
        const { payloads, tasks: responseTasks } = capture;

        // Proceed as soon as the catalogue arrives instead of always sleeping for a fixed
        // window. Falls through to the block checks below if nothing shows up.
        const waitForPayloads = async (timeoutMs: number): Promise<void> => {
            const deadline = Date.now() + timeoutMs;
            while (payloads.length === 0 && Date.now() < deadline) {
                await page.waitForTimeout(250);
            }
        };

        // Waiting is far cheaper than a retry: idle seconds cost only compute, while a failed
        // attempt repeats the whole navigation and its bandwidth. If the catalogue still has
        // not arrived, reload once against a warm cache rather than failing the request.
        await waitForPayloads(20_000);
        if (payloads.length === 0) {
            log.info(`No search payload on first load for "${searchQuery}"; reloading once.`);
            await page.reload({ waitUntil: 'domcontentloaded', timeout: 90_000 });
            await waitForPayloads(15_000);
        }

        let title = await page.title();
        let body = await page.locator('body').innerText().catch(() => '');
        if (await isBlockedPage(title, body)) {
            session?.markBad();
            throw new Error(`Blinkit challenge page detected for ${request.url}`);
        }

        if (payloads.length === 0 && !body.toLowerCase().includes(searchQuery.toLowerCase())) {
            await waitForPayloads(5_000);
            title = await page.title();
            body = await page.locator('body').innerText().catch(() => '');
        }

        if (await isBlockedPage(title, body)) {
            session?.markBad();
            throw new Error(`Blinkit challenge page detected for ${request.url}`);
        }

        if (payloads.length === 0 && !body.toLowerCase().includes(searchQuery.toLowerCase())) {
            throw new Error(`Blinkit did not return a usable search page for "${searchQuery}".`);
        }

        // A wall-clock deadline keeps a high maxPagesPerQuery from outliving
        // requestHandlerTimeoutSecs, which used to abort the whole request.
        let idleRounds = 0;
        const scrollDeadline = Date.now() + SCROLL_BUDGET_MS;
        for (let round = 0; round < maxPagesPerQuery * 3 && payloads.length < maxPagesPerQuery; round += 1) {
            if (Date.now() > scrollDeadline) {
                log.info(`Scroll budget reached for "${searchQuery}" after ${payloads.length} payload(s).`);
                break;
            }
            const before = payloads.length;
            await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
            await page.waitForTimeout(800 + Math.floor(Math.random() * 800));
            idleRounds = payloads.length === before ? idleRounds + 1 : 0;
            if (idleRounds >= 3) break;
        }

        await Promise.allSettled([...responseTasks]);
        capture.detach();
        captures.delete(page);

        const products = extractProducts(payloads.slice(0, maxPagesPerQuery), searchQuery, locationName);
        if (products.length === 0) {
            session?.markBad();
            throw new Error(`No Blinkit product records found for "${searchQuery}".`);
        }

        for (const product of products) {
            if (savedCount >= maxResults || spendingLimitReached) break;
            const uniqueKey = product.productId ?? product.productUrl ?? product.title;
            if (!uniqueKey || seenProductIds.has(uniqueKey)) continue;
            if (brands.size > 0 && (!product.brand || !brands.has(product.brand.toLowerCase()))) continue;
            if (inStockOnly && !product.inStock) continue;
            if (product.price === null || product.price < minPrice || product.price > maxPrice) continue;

            try {
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
                    await crawler.autoscaledPool?.abort();
                    break;
                }
            } catch (error) {
                fatalBillingError = error instanceof Error ? error : new Error(String(error));
                spendingLimitReached = true;
                await Actor.setStatusMessage('Stopped because product output billing failed.');
                log.error('Stopping Blinkit run because dataset push with product-scraped charge failed.', {
                    error: fatalBillingError.message,
                });
                await crawler.autoscaledPool?.abort();
                throw fatalBillingError;
            }
        }

        log.info(`Processed Blinkit search "${searchQuery}"`, {
            payloadsCaptured: payloads.length,
            productsFound: products.length,
            totalSaved: savedCount,
        });
        if (!spendingLimitReached) {
            await Actor.setStatusMessage(`Saved ${savedCount}/${maxResults} Blinkit products`);
        }
    },
    failedRequestHandler: async ({ request }, error) => {
        failedRequestCount += 1;
        log.error(`Blinkit request failed after retries: ${request.url}`, { error: String(error) });
    },
});

await crawler.run(requests);
if (fatalBillingError) throw fatalBillingError;
if (savedCount === 0 && !spendingLimitReached) {
    const failedPart = failedRequestCount > 0 ? `${failedRequestCount} request(s) failed and ` : '';
    throw new Error(`Blinkit scrape failed: ${failedPart}no products were saved. The source may be blocked, empty, or filtered out.`);
}
if (!spendingLimitReached) await Actor.setStatusMessage(`Finished with ${savedCount} unique products`);
log.info(`Blinkit scrape finished with ${savedCount} unique products.`);

await Actor.exit();
