# Blinkit Quick Commerce Scraper - Products & Prices

Collect location-specific Blinkit product catalog data for grocery research, price monitoring, assortment analysis, and retail intelligence. Search multiple keywords and export clean product records with prices, MRP, discounts, brands, pack sizes, inventory, ratings, images, and product URLs. Export to JSON, CSV, Excel, or HTML, or pull results through the Apify API. No Blinkit login or API key is required.

## What It Extracts

- Product ID, merchant ID, product name, brand, and pack size
- Current price, MRP, savings, discount percentage, and currency
- Inventory, stock status, and merchant type
- Rating, rating count, product image, and product URL
- Search query, requested location label, result position, and scrape timestamp

## Use Cases

- Monitor Blinkit grocery prices and promotions by delivery area
- Compare brands, pack sizes, and discounts across product searches
- Track local stock and quick-commerce assortment changes
- Build retail intelligence, pricing dashboards, and market reports
- Discover products for catalog enrichment and competitive research

## Pricing

| Event | Price | 1,000 products | 10,000 products |
| --- | ---: | ---: | ---: |
| `product-scraped` | $0.003/product | $3.00 | $30.00 |

You are charged only after a clean product record is saved. The Actor stops requesting more pages when the run's maximum charge is reached.

## Input

| Field | Type | Description |
| --- | --- | --- |
| `searchQueries` | string[] | Blinkit searches such as `milk`, `rice`, or `shampoo` |
| `locationName` | string | Human-readable location saved with each result |
| `latitude` | number | Delivery-area latitude |
| `longitude` | number | Delivery-area longitude |
| `brands` | string[] | Optional exact brand filter |
| `inStockOnly` | boolean | Save only available products |
| `minPrice` / `maxPrice` | number | Optional INR price range |
| `maxResults` | integer | Maximum unique products, up to 500 |
| `maxPagesPerQuery` | integer | Maximum result payloads per query |
| `proxyConfiguration` | object | India residential proxy configuration |

## How to Scrape Blinkit (Step by Step)

1. Add one or more product searches to `searchQueries`.
2. Enter a location label and its latitude and longitude.
3. Optionally filter by brand, stock status, or price range.
4. Set the maximum number of products and start the Actor.
5. Open the Dataset to export results or consume them through the API.

## Sample Output

```json
{
  "source": "blinkit",
  "searchQuery": "milk",
  "locationName": "Mumbai",
  "position": 1,
  "productId": "19512",
  "merchantId": "31719",
  "productName": "Amul Taaza Toned Milk",
  "brand": "Amul",
  "packSize": "500 ml",
  "currentPrice": 30,
  "marketPrice": 30,
  "discountPercent": null,
  "savingsAmount": null,
  "currency": "INR",
  "inventory": 12,
  "inStock": true,
  "merchantType": "express",
  "rating": 4.62,
  "ratingCount": 830000,
  "ratingCountText": "8.3 lac",
  "imageUrl": "https://cdn.grofers.com/da/cms-assets/cms/product/example.png",
  "productUrl": "https://blinkit.com/prn/amul-taaza-toned-milk/prid/19512",
  "scrapedAt": "2026-06-13T08:30:00.000Z"
}
```

## How It Works

The Actor opens Blinkit's public search interface in Chromium, applies the requested geolocation, and captures the site's structured search responses. It parses product records from those responses, removes duplicate product IDs, applies your filters, and saves each accepted record to the Dataset.

## Known Limits

- Blinkit inventory and prices vary by delivery area and can change frequently.
- Some products do not expose ratings, discounts, or exact inventory; those fields remain `null` rather than being fabricated.
- Blinkit can change its public interface or protection rules. Residential proxy traffic is recommended.
- Results represent public catalog information visible for the selected location at scrape time.

## Responsible Use

Use this Actor only for lawful purposes and in compliance with applicable website terms, robots rules, privacy laws, and local regulations. Do not use it to collect or resell personal data.

## License

Apache License 2.0. See [LICENSE](LICENSE).
