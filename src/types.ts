export interface ProxyInput {
    useApifyProxy?: boolean;
    apifyProxyGroups?: string[];
    apifyProxyCountry?: string;
    proxyUrls?: string[];
}

export interface ActorInput {
    searchQueries?: string[];
    locationName?: string;
    latitude?: number;
    longitude?: number;
    brands?: string[];
    inStockOnly?: boolean;
    minPrice?: number;
    maxPrice?: number;
    maxResults?: number;
    maxPagesPerQuery?: number;
    proxyConfiguration?: ProxyInput;
}

export interface RequestData {
    searchQuery: string;
}

export interface ProductRecord {
    source: 'blinkit';
    searchQuery: string;
    locationName: string;
    position: number;
    productId: string;
    merchantId: string | null;
    productName: string;
    brand: string | null;
    packSize: string | null;
    currentPrice: number;
    marketPrice: number | null;
    discountPercent: number | null;
    savingsAmount: number | null;
    currency: 'INR';
    inventory: number | null;
    inStock: boolean;
    merchantType: string | null;
    rating: number | null;
    ratingCount: number | null;
    ratingCountText: string | null;
    imageUrl: string | null;
    productUrl: string;
    scrapedAt: string;
}
