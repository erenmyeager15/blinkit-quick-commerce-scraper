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
    position: number;
    productId: string | null;
    title: string;
    brand: string;
    price: number | null;
    mrp: number | null;
    discountPercent: number | null;
    currency: string;
    packSize: string;
    category: string;
    rating: number | null;
    ratingCount: number | null;
    inStock: boolean | null;
    productUrl: string | null;
    imageUrl: string | null;
    scrapedAt: string;
}
