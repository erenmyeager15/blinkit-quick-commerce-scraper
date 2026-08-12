# Blinkit Product Scraper: Prices & Stock

Scrape public Blinkit search results for a selected delivery location and export clean product rows from the Apify Dataset in JSON, CSV, Excel, XML, HTML, RSS, or JSONL. The Actor is built for quick-commerce price monitoring, FMCG catalog research, local stock checks, and lightweight retail reports.

It collects public product details such as title, brand, pack size, price, MRP, discount percentage, rating, rating count, stock status, image URL, product URL, search query, and scrape timestamp. It does not require a Blinkit login or API key, and it does not collect private customer, account, order, seller, or contact data.

The default run is intentionally small: one in-stock `milk` result for Mumbai with one result payload and Apify Residential proxy in India.

## What you get

- Search query and result position
- Blinkit product ID
- Product title, brand, and pack size
- Current price, MRP, discount percentage, and currency
- Rating and rating count when visible
- Stock status
- Product URL and image URL
- Timestamp for each saved row

## Common uses

1. Monitor grocery and quick-commerce prices by delivery area.
2. Compare brands, pack sizes, discounts, and availability for local searches.
3. Build small product snapshots for retail dashboards or market reports.
4. Track local assortment changes for high-value product keywords.
5. Enrich internal catalog rows with public Blinkit listing metadata.

## Quick start

Use this input for a low-cost first run:

```json
{
  "searchQueries": ["milk"],
  "locationName": "Mumbai",
  "latitude": 19.076,
  "longitude": 72.8777,
  "brands": [],
  "inStockOnly": true,
  "minPrice": 0,
  "maxPrice": 1000000,
  "maxResults": 50,
  "maxPagesPerQuery": 5,
  "proxyConfiguration": {
    "useApifyProxy": true,
    "apifyProxyGroups": ["RESIDENTIAL"],
    "apifyProxyCountry": "IN"
  }
}
```

After the run finishes, open the dataset and export the `Products` view.

## Input

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `searchQueries` | array | `["milk"]` | One to five Blinkit product searches, such as `milk`, `rice`, or `shampoo`. |
| `locationName` | string | `Mumbai` | Human-readable location label saved with the run output. |
| `latitude` | number | `19.076` | Delivery-area latitude used for Blinkit's location-specific catalog. |
| `longitude` | number | `72.8777` | Delivery-area longitude used for Blinkit's location-specific catalog. |
| `brands` | array | `[]` | Optional exact brand filters. Matching is case-insensitive. |
| `inStockOnly` | boolean | `true` | Save only products that appear available. |
| `minPrice` | number | `0` | Minimum INR price to save. |
| `maxPrice` | number | `1000000` | Maximum INR price to save. |
| `maxResults` | integer | `50` | Maximum unique products saved across the run. Range: 1-500. |
| `maxPagesPerQuery` | integer | `5` | Maximum structured search payloads processed per query. Range: 1-40. |
| `proxyConfiguration` | object | Residential India | Apify proxy settings. Residential India proxy is recommended for regional prices and availability. |

## Output

A saved dataset row looks like this:

```json
{
  "source": "blinkit",
  "searchQuery": "milk",
  "position": 1,
  "productId": "19512",
  "title": "Amul Taaza Toned Milk",
  "brand": "Amul",
  "price": 30,
  "mrp": 30,
  "discountPercent": null,
  "currency": "INR",
  "packSize": "500 ml",
  "category": "N/A",
  "rating": 4.62,
  "ratingCount": 830000,
  "inStock": true,
  "productUrl": "https://blinkit.com/prn/amul-taaza-toned-milk/prid/19512",
  "imageUrl": "https://cdn.grofers.com/da/cms-assets/cms/product/example.png",
  "scrapedAt": "2026-06-30T10:00:00.000Z"
}
```

Optional fields may be `null` or `N/A` when Blinkit does not expose them in the captured search payload.

## Pricing

This Actor uses Apify Pay Per Event pricing.

| Event | Price |
| --- | ---: |
| `product-scraped` | `$0.003` per saved product row |
| `apify-actor-start` | `$0.00005` per GB when the Actor starts |

Products are charged only when a clean product record is saved to the dataset. The Actor uses atomic dataset charging, so the run stops before saving unpaid records after the user's maximum charge is reached.

Platform usage, such as browser compute and proxy traffic, may also be charged by Apify depending on the run configuration. Residential India proxy is recommended for Blinkit reliability and regional pricing, but it can increase platform usage cost.

## Cost control

- Each query loads the Blinkit app once, which is the main fixed cost of a run. Asking one query for 100 products is far cheaper per product than ten runs of 10 products.
- Start with one query and the default `maxResults: 50`.
- Keep `inStockOnly` enabled unless you need unavailable products.
- Add more queries, pages, or cities only after checking the output.
- Use the run's maximum cost setting if you want a strict spending cap.

## Reliability

Blinkit prices and availability vary by delivery area and can change frequently. The Actor includes:

- Browser-based capture of Blinkit's public structured search responses
- Geolocation setup from the latitude/longitude input
- India residential proxy defaults
- Block/challenge detection with retries and session rotation
- Deduplication by product ID, URL, or title
- A zero-result failure guard so blocked, empty, or over-filtered runs do not look successful
- Field-level fallbacks when optional listing data is unavailable

## Limits

- This Actor reads public search-result data, not private account or order data.
- Prices and stock are location-specific and represent the selected delivery area at scrape time.
- Some product cards do not expose ratings, discounts, images, stock flags, or MRP.
- This Actor is not an official Blinkit API and is not affiliated with Blinkit.

## Responsible use

Use this Actor for lawful research, price monitoring, and analysis of publicly available information. You are responsible for complying with Blinkit's terms, robots.txt, privacy laws, India's DPDP Act where applicable, and all local regulations.

Do not use this Actor to collect, infer, sell, or misuse personal data. The Actor author is not responsible for misuse by end users.

## License

Apache-2.0. See `LICENSE`.
