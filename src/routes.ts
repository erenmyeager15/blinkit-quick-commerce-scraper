import type { ProductRecord } from './types.js';

type JsonObject = Record<string, unknown>;

const isObject = (value: unknown): value is JsonObject => (
    typeof value === 'object' && value !== null && !Array.isArray(value)
);

const asObject = (value: unknown): JsonObject | null => (isObject(value) ? value : null);

const asString = (value: unknown): string | null => (
    typeof value === 'string' && value.trim() ? value.trim() : null
);

const asNumber = (value: unknown): number | null => {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
        const parsed = Number(value.replace(/[^0-9.-]/g, ''));
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
};

const textValue = (value: unknown): string | null => asString(asObject(value)?.text);

const slugify = (value: string): string => value
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const parseCompactCount = (value: string | null): number | null => {
    if (!value) return null;
    const normalized = value.toLowerCase().replace(/,/g, '').trim();
    const number = Number.parseFloat(normalized);
    if (!Number.isFinite(number)) return null;
    if (/crore|\bcr\b/.test(normalized)) return Math.round(number * 10_000_000);
    if (/lac|lakh|\bl\b/.test(normalized)) return Math.round(number * 100_000);
    if (/\bk\b|thousand/.test(normalized)) return Math.round(number * 1_000);
    return Math.round(number);
};

const findCartItem = (candidate: JsonObject): JsonObject | null => {
    const atcAction = asObject(candidate.atc_action);
    const addToCart = asObject(atcAction?.add_to_cart);
    return asObject(addToCart?.cart_item);
};

export const buildSearchUrl = (query: string): string => (
    `https://blinkit.com/s/?q=${encodeURIComponent(query)}`
);

export const isBlockedPage = async (title: string, body: string): Promise<boolean> => {
    const text = `${title}\n${body}`.toLowerCase();
    return [
        'access denied',
        'just a moment',
        'verify you are human',
        'cf-chl-',
        'request blocked',
    ].some((marker) => text.includes(marker));
};

export const extractProducts = (
    payloads: unknown[],
    searchQuery: string,
    locationName: string,
): ProductRecord[] => {
    const products = new Map<string, ProductRecord>();
    let position = 0;

    const visit = (value: unknown): void => {
        if (Array.isArray(value)) {
            for (const item of value) visit(item);
            return;
        }
        if (!isObject(value)) return;

        const cartItem = findCartItem(value);
        const productId = asString(cartItem?.product_id) ?? (
            typeof cartItem?.product_id === 'number' ? String(cartItem.product_id) : null
        );
        const productName = asString(cartItem?.product_name) ?? textValue(value.display_name) ?? textValue(value.name);

        if (cartItem && productId && productName && !products.has(productId)) {
            const currentPrice = asNumber(cartItem.price);
            const marketPrice = asNumber(cartItem.mrp);
            if (currentPrice !== null) {
                position += 1;
                const inventory = asNumber(cartItem.inventory);
                const ratingBar = asObject(asObject(value.rating)?.bar);
                const ratingCountText = textValue(ratingBar?.title);
                const soldOut = value.is_sold_out === true || value.product_state === 'sold_out';
                const savingsAmount = marketPrice !== null && marketPrice > currentPrice
                    ? Number((marketPrice - currentPrice).toFixed(2))
                    : null;
                const discountPercent = savingsAmount !== null && marketPrice && marketPrice > 0
                    ? Math.round((savingsAmount / marketPrice) * 100)
                    : null;

                products.set(productId, {
                    source: 'blinkit',
                    searchQuery,
                    locationName,
                    position,
                    productId,
                    merchantId: asString(cartItem.merchant_id) ?? (
                        typeof cartItem.merchant_id === 'number' ? String(cartItem.merchant_id) : null
                    ),
                    productName,
                    brand: asString(cartItem.brand) ?? textValue(value.brand_name),
                    packSize: asString(cartItem.unit) ?? textValue(value.variant),
                    currentPrice,
                    marketPrice,
                    discountPercent,
                    savingsAmount,
                    currency: 'INR',
                    inventory,
                    inStock: !soldOut && (inventory === null || inventory > 0),
                    merchantType: asString(cartItem.merchant_type),
                    rating: asNumber(ratingBar?.value) === null
                        ? null
                        : Number((asNumber(ratingBar?.value) as number).toFixed(2)),
                    ratingCount: parseCompactCount(ratingCountText),
                    ratingCountText,
                    imageUrl: asString(cartItem.image_url) ?? asString(asObject(value.image)?.url),
                    productUrl: `https://blinkit.com/prn/${slugify(productName)}/prid/${productId}`,
                    scrapedAt: new Date().toISOString(),
                });
            }
        }

        for (const child of Object.values(value)) visit(child);
    };

    for (const payload of payloads) visit(payload);
    return [...products.values()];
};
