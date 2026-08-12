import assert from 'node:assert/strict';
import test from 'node:test';

import { buildSearchEndpoint, cookieHeader, PAGE_SIZE } from '../dist/blinkitApi.js';
import { normalizeInput } from '../dist/input.js';
import { buildSearchUrl, extractProducts, isBlockedPage } from '../dist/routes.js';

const blinkitPayload = {
    widgets: [
        {
            data: {
                product_state: 'available',
                atc_action: {
                    add_to_cart: {
                        cart_item: {
                            product_id: 19512,
                            product_name: 'Amul Taaza Toned Milk',
                            brand: 'Amul',
                            unit: '500 ml',
                            price: '30',
                            mrp: '40',
                            inventory: 8,
                            image_url: '//cdn.grofers.com/da/cms-assets/cms/product/example.png',
                        },
                    },
                },
                rating: {
                    bar: {
                        value: '4.62',
                        title: { text: '8.3L ratings' },
                    },
                },
            },
        },
        {
            data: {
                atc_action: {
                    add_to_cart: {
                        cart_item: {
                            product_id: 19512,
                            product_name: 'Duplicate Milk',
                            price: 30,
                        },
                    },
                },
            },
        },
    ],
};

test('normalizes default input to one low-cost Mumbai milk run', () => {
    const input = normalizeInput({});

    assert.deepEqual(input.searchQueries, ['milk']);
    assert.equal(input.locationName, 'Mumbai');
    assert.equal(input.latitude, 19.076);
    assert.equal(input.longitude, 72.8777);
    assert.deepEqual(input.brands, []);
    assert.equal(input.inStockOnly, true);
    assert.equal(input.minPrice, 0);
    assert.equal(input.maxPrice, 1000000);
    assert.equal(input.maxResults, 50);
    assert.equal(input.maxPagesPerQuery, 5);
    assert.equal(input.proxyConfiguration.useApifyProxy, true);
    assert.deepEqual(input.proxyConfiguration.apifyProxyGroups, ['RESIDENTIAL']);
    assert.equal(input.proxyConfiguration.apifyProxyCountry, 'IN');
});

test('rejects oversized or invalid input values', () => {
    assert.throws(
        () => normalizeInput({ searchQueries: ['a', 'b', 'c', 'd', 'e', 'f'] }),
        /at most 5/,
    );
    assert.throws(
        () => normalizeInput({ searchQueries: ['milk'], maxResults: 0 }),
        /between 1 and 500/,
    );
    assert.throws(
        () => normalizeInput({ searchQueries: ['milk'], latitude: 120 }),
        /latitude/,
    );
    assert.throws(
        () => normalizeInput({ searchQueries: ['milk'], minPrice: 100, maxPrice: 50 }),
        /maxPrice/,
    );
});

test('builds Blinkit search URLs and detects challenge pages', async () => {
    assert.equal(buildSearchUrl('amul milk'), 'https://blinkit.com/s/?q=amul%20milk');
    assert.equal(await isBlockedPage('Just a moment...', ''), true);
    assert.equal(await isBlockedPage('Blinkit', 'fresh groceries near you'), false);
});

test('extracts and deduplicates Blinkit products from structured payloads', () => {
    const products = extractProducts([blinkitPayload], 'milk', 'Mumbai');

    assert.equal(products.length, 1);
    assert.equal(products[0].source, 'blinkit');
    assert.equal(products[0].searchQuery, 'milk');
    assert.equal(products[0].position, 1);
    assert.equal(products[0].productId, '19512');
    assert.equal(products[0].title, 'Amul Taaza Toned Milk');
    assert.equal(products[0].brand, 'Amul');
    assert.equal(products[0].price, 30);
    assert.equal(products[0].mrp, 40);
    assert.equal(products[0].discountPercent, 25);
    assert.equal(products[0].currency, 'INR');
    assert.equal(products[0].packSize, '500 ml');
    assert.equal(products[0].rating, 4.62);
    assert.equal(products[0].ratingCount, 830000);
    assert.equal(products[0].inStock, true);
    assert.equal(products[0].productUrl, 'https://blinkit.com/prn/amul-taaza-toned-milk/prid/19512');
    assert.equal(products[0].imageUrl, 'https://cdn.grofers.com/da/cms-assets/cms/product/example.png');
});

test('search endpoint omits paging parameters on the first page', () => {
    const url = new URL(buildSearchEndpoint('milk', 0));

    assert.equal(url.origin + url.pathname, 'https://blinkit.com/v1/layout/search');
    assert.equal(url.searchParams.get('q'), 'milk');
    assert.equal(url.searchParams.get('search_type'), 'type_to_search');
    assert.equal(url.searchParams.has('offset'), false);
    assert.equal(url.searchParams.has('page_index'), false);
});

test('search endpoint pages by offset for later pages', () => {
    const url = new URL(buildSearchEndpoint('fresh milk', 2));

    assert.equal(url.searchParams.get('q'), 'fresh milk');
    assert.equal(url.searchParams.get('actual_query'), 'fresh milk');
    assert.equal(url.searchParams.get('offset'), String(2 * PAGE_SIZE));
    assert.equal(url.searchParams.get('limit'), String(PAGE_SIZE));
    assert.equal(url.searchParams.get('page_index'), '2');
});

test('cookie header keeps only name=value pairs', () => {
    const header = cookieHeader([
        'gr_1_deviceId=abc123; Path=/; HttpOnly',
        '__cf_bm=token-value; Path=/; Secure; SameSite=None',
    ]);

    assert.equal(header, 'gr_1_deviceId=abc123; __cf_bm=token-value');
    assert.equal(cookieHeader(undefined), '');
    assert.equal(cookieHeader('single=value; Path=/'), 'single=value');
});
