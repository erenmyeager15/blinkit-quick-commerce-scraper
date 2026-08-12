import type { ActorInput, ProxyInput } from './types.js';

export interface NormalizedInput {
    searchQueries: string[];
    locationName: string;
    latitude: number;
    longitude: number;
    brands: string[];
    inStockOnly: boolean;
    minPrice: number;
    maxPrice: number;
    maxResults: number;
    maxPagesPerQuery: number;
    proxyConfiguration: ProxyInput;
}

const DEFAULT_PROXY_CONFIGURATION: ProxyInput = {
    useApifyProxy: true,
    apifyProxyGroups: ['RESIDENTIAL'],
    apifyProxyCountry: 'IN',
};

function fail(message: string, field?: string): never {
    throw new Error(field ? `Field "${field}": ${message}` : message);
}

function asString(value: unknown, fieldName: string, defaultValue: string): string {
    if (value === undefined || value === null || value === '') return defaultValue;
    if (typeof value !== 'string') fail('must be a string.', fieldName);
    const trimmed = value.trim();
    if (!trimmed) fail('must not be empty.', fieldName);
    return trimmed;
}

function asStringArray(value: unknown, fieldName: string, defaultValue: string[], minItems: number, maxItems: number): string[] {
    if (value === undefined || value === null) return [...defaultValue];
    if (!Array.isArray(value)) fail('must be an array of strings.', fieldName);

    const result = (value as unknown[]).map((item) => {
        if (typeof item !== 'string') fail('all items must be strings.', fieldName);
        const trimmed = item.trim();
        if (!trimmed) fail('items must not be empty.', fieldName);
        return trimmed;
    });

    if (result.length < minItems) fail(`must contain at least ${minItems} item(s).`, fieldName);
    if (result.length > maxItems) fail(`must contain at most ${maxItems} items.`, fieldName);
    return [...new Set(result)];
}

function asNumberInRange(value: unknown, fieldName: string, defaultValue: number, min: number, max: number): number {
    if (value === undefined || value === null || value === '') return defaultValue;
    const parsed = typeof value === 'string' ? Number(value) : value;
    if (typeof parsed !== 'number' || !Number.isFinite(parsed)) fail('must be a number.', fieldName);
    if (parsed < min || parsed > max) fail(`must be between ${min} and ${max}.`, fieldName);
    return parsed;
}

function asIntInRange(value: unknown, fieldName: string, defaultValue: number, min: number, max: number): number {
    const parsed = asNumberInRange(value, fieldName, defaultValue, min, max);
    if (!Number.isInteger(parsed)) fail('must be an integer.', fieldName);
    return parsed;
}

function asBoolean(value: unknown, fieldName: string, defaultValue: boolean): boolean {
    if (value === undefined || value === null || value === '') return defaultValue;
    if (typeof value === 'boolean') return value;
    if (value === 'true' || value === '1' || value === 1) return true;
    if (value === 'false' || value === '0' || value === 0) return false;
    fail('must be a boolean.', fieldName);
}

function asProxyConfiguration(value: unknown): ProxyInput {
    if (value === undefined || value === null || value === '') return { ...DEFAULT_PROXY_CONFIGURATION };
    if (typeof value !== 'object' || Array.isArray(value)) fail('must be a proxy configuration object.', 'proxyConfiguration');
    return value as ProxyInput;
}

export function normalizeInput(raw: ActorInput = {}): NormalizedInput {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('Input must be a JSON object.');

    const minPrice = asNumberInRange(raw.minPrice, 'minPrice', 0, 0, 1_000_000);
    const maxPrice = asNumberInRange(raw.maxPrice, 'maxPrice', 1_000_000, 0, 1_000_000);
    if (maxPrice < minPrice) fail('must be greater than or equal to minPrice.', 'maxPrice');

    return {
        searchQueries: asStringArray(raw.searchQueries, 'searchQueries', ['milk'], 1, 5),
        locationName: asString(raw.locationName, 'locationName', 'Mumbai'),
        latitude: asNumberInRange(raw.latitude, 'latitude', 19.076, -90, 90),
        longitude: asNumberInRange(raw.longitude, 'longitude', 72.8777, -180, 180),
        brands: asStringArray(raw.brands, 'brands', [], 0, 20),
        inStockOnly: asBoolean(raw.inStockOnly, 'inStockOnly', true),
        minPrice,
        maxPrice,
        // Defaults deliberately return a useful page of results. The browser boot is a fixed
        // cost per query (~2.4 MB of proxy traffic), so a 1-result run costs far more to
        // produce than it bills, and shows the user almost nothing.
        maxResults: asIntInRange(raw.maxResults, 'maxResults', 50, 1, 500),
        maxPagesPerQuery: asIntInRange(raw.maxPagesPerQuery, 'maxPagesPerQuery', 5, 1, 40),
        proxyConfiguration: asProxyConfiguration(raw.proxyConfiguration),
    };
}
