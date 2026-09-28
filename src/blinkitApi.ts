import { randomUUID } from 'node:crypto';
import { gotScraping } from 'got-scraping';
import { buildSearchUrl } from './routes.js';

const BASE_URL = 'https://blinkit.com';
const SEARCH_PATH = '/v1/layout/search';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36';
const REQUEST_TIMEOUT_MS = 60_000;

/** Blinkit's search API returns twelve product cards per page. */
export const PAGE_SIZE = 12;

export interface BlinkitSession {
    cookies: string;
    deviceId: string;
    sessionUuid: string;
}

export interface SearchPageOptions {
    query: string;
    latitude: number;
    longitude: number;
    session: BlinkitSession;
    pageIndex: number;
    proxyUrl?: string;
}

export interface SearchPageResult {
    payload: unknown;
    statusCode: number;
    bodyText: string;
}

/** A new proxy attempt gets a fresh Blinkit request identity. The public search API
 * currently works without first visiting the storefront, which now often returns 403. */
export function createSearchSession(): BlinkitSession {
    return {
        cookies: '',
        deviceId: randomUUID(),
        sessionUuid: randomUUID(),
    };
}

/** Builds the paginated search endpoint. Page one omits the paging parameters. */
export function buildSearchEndpoint(query: string, pageIndex: number): string {
    const endpoint = new URL(SEARCH_PATH, BASE_URL);
    endpoint.searchParams.set('q', query);
    endpoint.searchParams.set('search_type', 'type_to_search');

    if (pageIndex > 0) {
        endpoint.searchParams.set('offset', String(pageIndex * PAGE_SIZE));
        endpoint.searchParams.set('limit', String(PAGE_SIZE));
        endpoint.searchParams.set('actual_query', query);
        endpoint.searchParams.set('page_index', String(pageIndex));
        endpoint.searchParams.set('search_method', 'basic');
        endpoint.searchParams.set('last_snippet_type', 'product_card_snippet_type_2');
        endpoint.searchParams.set('last_widget_type', 'listing_container');
        endpoint.searchParams.set('tab_position', '0');
    }

    return endpoint.toString();
}

/**
 * Requests one page of search results. Latitude and longitude are sent as headers, which
 * is how Blinkit resolves the serving dark store, so prices and stock are location aware.
 */
export async function fetchSearchPage(options: SearchPageOptions): Promise<SearchPageResult> {
    const { query, latitude, longitude, session, pageIndex, proxyUrl } = options;
    const landingUrl = buildSearchUrl(query);

    const response = await gotScraping({
        url: buildSearchEndpoint(query, pageIndex),
        method: 'POST',
        proxyUrl,
        headers: {
            'user-agent': USER_AGENT,
            accept: '*/*',
            'content-type': 'application/json',
            'accept-language': 'en-IN,en;q=0.9',
            origin: BASE_URL,
            referer: landingUrl,
            cookie: session.cookies,
            access_token: 'null',
            app_client: 'consumer_web',
            app_version: '1010101010',
            web_app_version: '1010101010',
            lat: String(latitude),
            lon: String(longitude),
            device_id: session.deviceId,
            session_uuid: session.sessionUuid,
        },
        body: JSON.stringify({ applied_filters: null, previous_search_query: '' }),
        responseType: 'text',
        throwHttpErrors: false,
        timeout: { request: REQUEST_TIMEOUT_MS },
    });

    const bodyText = response.body ?? '';
    let payload: unknown = null;
    if (response.statusCode < 400 && bodyText) {
        try {
            payload = JSON.parse(bodyText);
        } catch {
            payload = null;
        }
    }

    return { payload, statusCode: response.statusCode, bodyText };
}
