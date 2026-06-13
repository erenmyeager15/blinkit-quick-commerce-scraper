import { Actor, log } from 'apify';
import { PlaywrightCrawler } from 'crawlee';
import { buildSearchUrl, extractProducts, isBlockedPage } from './routes.js';
import type { ActorInput, RequestData } from './types.js';

await Actor.init();

const input = (await Actor.getInput<ActorInput>()) ?? {};
const searchQueries = [...new Set((input.searchQueries ?? ['milk']).map((value) => value.trim()).filter(Boolean))];
const locationName = input.locationName?.trim() || 'Mumbai';
const latitude = input.latitude ?? 19.076;
const longitude = input.longitude ?? 72.8777;
const brands = new Set((input.brands ?? []).map((value) => value.trim().toLowerCase()).filter(Boolean));
const inStockOnly = input.inStockOnly ?? false;
const minPrice = Math.max(input.minPrice ?? 0, 0);
const maxPrice = Math.max(input.maxPrice ?? 1_000_000, minPrice);
const maxResults = Math.min(Math.max(input.maxResults ?? 100, 1), 500);
const maxPagesPerQuery = Math.min(Math.max(input.maxPagesPerQuery ?? 10, 1), 40);

if (searchQueries.length === 0) throw new Error('Provide at least one Blinkit search query.');

const proxyConfiguration = await Actor.createProxyConfiguration(
    input.proxyConfiguration ?? {
        useApifyProxy: true,
        apifyProxyGroups: ['RESIDENTIAL'],
        apifyProxyCountry: 'IN',
    },
);

const seenProductIds = new Set<string>();
let savedCount = 0;
let spendingLimitReached = false;

const requests = searchQueries.map((searchQuery) => ({
    url: buildSearchUrl(searchQuery),
    uniqueKey: `blinkit-${searchQuery.toLowerCase()}`,
    userData: { searchQuery } satisfies RequestData,
}));

const crawler = new PlaywrightCrawler({
    proxyConfiguration,
    headless: false,
    maxConcurrency: 1,
    minConcurrency: 1,
    maxRequestRetries: 3,
    retryOnBlocked: true,
    navigationTimeoutSecs: 90,
    requestHandlerTimeoutSecs: 240,
    maxRequestsPerCrawl: requests.length,
    sessionPoolOptions: {
        maxPoolSize: 30,
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
        await page.context().grantPermissions(['geolocation'], { origin: 'https://blinkit.com' });
        await page.context().setGeolocation({ latitude, longitude });
        await page.setExtraHTTPHeaders({
            'accept-language': 'en-IN,en;q=0.9',
        });
        page.setDefaultTimeout(15_000);
        if (gotoOptions) gotoOptions.waitUntil = 'domcontentloaded';
        await page.waitForTimeout(1_000 + Math.floor(Math.random() * 2_000));
    }],
    requestHandler: async ({ page, request, session }) => {
        if (savedCount >= maxResults || spendingLimitReached) return;

        const { searchQuery } = request.userData as RequestData;
        const payloads: unknown[] = [];
        const responseTasks = new Set<Promise<void>>();

        const responseHandler = (response: Awaited<ReturnType<typeof page.waitForResponse>>): void => {
            const url = response.url();
            if (response.status() !== 200 || !url.includes('/v1/layout/search')) return;
            const task = response.json()
                .then((payload: unknown) => { payloads.push(payload); })
                .catch(() => undefined)
                .finally(() => { responseTasks.delete(task); });
            responseTasks.add(task);
        };

        page.on('response', responseHandler);
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 90_000 });
        await page.waitForTimeout(5_000);

        const title = await page.title();
        const body = await page.locator('body').innerText().catch(() => '');
        if (await isBlockedPage(title, body)) {
            session?.markBad();
            throw new Error(`Blinkit challenge page detected for ${request.url}`);
        }

        if (!body.toLowerCase().includes('showing results') && !body.toLowerCase().includes(searchQuery.toLowerCase())) {
            throw new Error(`Blinkit did not return a usable search page for "${searchQuery}".`);
        }

        let idleRounds = 0;
        for (let round = 0; round < maxPagesPerQuery * 3 && payloads.length < maxPagesPerQuery; round += 1) {
            const before = payloads.length;
            await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
            await page.waitForTimeout(1_500 + Math.floor(Math.random() * 1_500));
            idleRounds = payloads.length === before ? idleRounds + 1 : 0;
            if (idleRounds >= 3) break;
        }

        await Promise.allSettled([...responseTasks]);
        page.off('response', responseHandler);

        const products = extractProducts(payloads.slice(0, maxPagesPerQuery), searchQuery, locationName);
        if (products.length === 0) {
            session?.markBad();
            throw new Error(`No Blinkit product records found for "${searchQuery}".`);
        }

        for (const product of products) {
            if (savedCount >= maxResults || spendingLimitReached) break;
            if (seenProductIds.has(product.productId)) continue;
            if (brands.size > 0 && (!product.brand || !brands.has(product.brand.toLowerCase()))) continue;
            if (inStockOnly && !product.inStock) continue;
            if (product.currentPrice < minPrice || product.currentPrice > maxPrice) continue;

            seenProductIds.add(product.productId);
            await Actor.pushData(product);
            const chargeResult = await Actor.charge({ eventName: 'product-scraped' });
            savedCount += 1;

            if (chargeResult.eventChargeLimitReached) {
                spendingLimitReached = true;
                await Actor.setStatusMessage(`Stopped at the user's spending limit after ${savedCount} products`);
                log.info('User spending limit reached; stopping before more requests are made.');
                await crawler.autoscaledPool?.abort();
                break;
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
        log.error(`Blinkit request failed after retries: ${request.url}`, { error: String(error) });
    },
});

await crawler.run(requests);
if (!spendingLimitReached) await Actor.setStatusMessage(`Finished with ${savedCount} unique products`);
log.info(`Blinkit scrape finished with ${savedCount} unique products.`);

await Actor.exit();
