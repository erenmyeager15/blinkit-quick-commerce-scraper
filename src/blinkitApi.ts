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

/** Joins Set-Cookie values into a request cookie header, keeping only name=value. */
export const cookieHeader = (setCookie: string[] | string | undefined): string => {
    const values = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
    return values.map((value) => value.split(';')[0]).filter(Boolean).join('; ');
};

/**
 * Fetches the public storefront once to collect the cookies Blinkit's edge expects
 * (including __cf_bm). This replaces booting a browser: the search API accepts these
 * cookies directly, which is the same approach the BigBasket Actor uses.
 */
export async function warmUpSession(query: string, proxyUrl?: string): Promise<{
    session: BlinkitSession;
    statusCode: number;
    html: string;
}> {
    const response = await gotScraping({
        url: buildSearchUrl(query),
        proxyUrl,
        headers: {
            'user-agent': USER_AGENT,
            'accept-language': 'en-IN,en;q=0.9',
            accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
        },
        responseType: 'text',
        throwHttpErrors: false,
        timeout: { request: REQUEST_TIMEOUT_MS },
    });

    return {
        session: {
            cookies: cookieHeader(response.headers['set-cookie']),
            deviceId: randomUUID(),
            sessionUuid: randomUUID(),
        },
        statusCode: response.statusCode,
        html: response.body ?? '',
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
