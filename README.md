# IKEA Product Scraper

Extract comprehensive IKEA product data with lightning-fast API-powered collection. Gather product details, pricing, ratings, and availability from IKEA's global catalog at scale. Perfect for retail research, price monitoring, and market intelligence.

## Features

- **Complete Product Data** — Extract names, prices, images, ratings, and availability
- **Multi-Country Support** — Scrape from 30+ IKEA markets worldwide
- **Fast API Extraction** — Direct access to IKEA's internal search API for maximum speed
- **Flexible Search Options** — Search by keywords or browse categories and new products
- **Automatic Pagination** — Collect thousands of products with intelligent page handling
- **Built-in Deduplication** — Eliminate duplicate products automatically
- **Proxy Protection** — Residential proxies for reliable, uninterrupted scraping

## Use Cases

### Product Research
Analyze IKEA's complete product catalog to identify trending items, pricing patterns, and customer favorites. Perfect for retailers researching competitive products and sourcing opportunities.

### Price Monitoring
Track IKEA product prices across different countries and time periods. Monitor pricing strategies, seasonal discounts, and market positioning for competitive intelligence.

### Market Intelligence
Build comprehensive datasets of IKEA's offerings for market analysis. Understand product categories, availability patterns, and customer rating trends across global markets.

### Inventory Analysis
Monitor product availability and stock levels across IKEA's worldwide network. Identify popular items, out-of-stock patterns, and regional inventory differences.

### Competitive Analysis
Compare IKEA's product offerings, pricing, and customer feedback against competitors. Gain insights into market positioning and product strategy.

---

## Input Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `startUrls` | Array | No | `[]` | IKEA listing or search URLs to scrape |
| `country` | String | No | `"gb"` | IKEA country code (gb, us, de, fr, etc.) |
| `language` | String | No | `"en"` | Website language code |
| `category` | String | No | `"new-products"` | Category or search term |
| `maxProducts` | Integer | No | `20` | Maximum products to collect |
| `maxPages` | Integer | No | `2` | Maximum API pages to process |
| `proxyConfiguration` | Object | No | Residential proxy | Proxy settings for reliability |

---

## Output Data

Each item in the dataset contains:

| Field | Type | Description |
|-------|------|-------------|
| `productId` | String | Unique IKEA product identifier |
| `name` | String | Product name and variant details |
| `price` | Number | Current product price |
| `currency` | String | Currency code (GBP, USD, EUR, etc.) |
| `image` | String | Main product image URL |
| `url` | String | Direct link to product page |
| `rating` | Number | Average customer rating (0-5) |
| `reviewCount` | Number | Total number of customer reviews |
| `availability` | String | Stock availability status |
| `categoryOrQuery` | String | Search term or category used |
| `sourceType` | String | API mode (QUERY, SPECIAL, CATEGORY) |
| `scrapedAt` | String | ISO timestamp of data collection |

---

## Usage Examples

### Basic Product Search

Extract products from a keyword search:

```json
{
  "startUrls": [
    {
      "url": "https://www.ikea.com/gb/en/search/?q=chair"
    }
  ],
  "maxProducts": 50
}
```

### Category Collection

Collect products from IKEA's new arrivals:

```json
{
  "category": "new-products",
  "country": "us",
  "language": "en",
  "maxProducts": 100,
  "maxPages": 5
}
```

### Multi-Country Research

Compare product availability across markets:

```json
{
  "startUrls": [
    {
      "url": "https://www.ikea.com/de/de/search/?q=sofa"
    }
  ],
  "country": "de",
  "language": "de",
  "maxProducts": 25,
  "proxyConfiguration": {
    "useApifyProxy": true,
    "apifyProxyGroups": ["RESIDENTIAL"]
  }
}
```

---

## Sample Output

```json
{
  "productId": "10605424",
  "name": "SANDSBERG Chair",
  "price": 10,
  "currency": "GBP",
  "image": "https://www.ikea.com/gb/en/images/products/sandsberg-chair-white__1390727_pe965548_s5.jpg",
  "url": "https://www.ikea.com/gb/en/p/sandsberg-chair-white-10605424/",
  "rating": 4.5,
  "reviewCount": 20,
  "availability": "Check availability",
  "categoryOrQuery": "chair",
  "sourceType": "QUERY",
  "scrapedAt": "2026-02-14T06:58:14.195Z"
}
```

---

## Tips for Best Results

### Choose Effective Search Terms
- Use specific product keywords like "dining chair" or "storage cabinet"
- Start with popular categories like "new-products" or "furniture"
- Test different search terms to find the most relevant results

### Optimize Collection Size
- Start with smaller batches (20-50 products) for testing
- Increase to hundreds or thousands for comprehensive research
- Balance data volume with processing time

### Select Appropriate Countries
- Choose countries relevant to your market research
- Consider language barriers for non-English markets
- Test with your target market first

---

## Integrations

Connect your IKEA product data with:

- **Google Sheets** — Export for collaborative analysis
- **Airtable** — Build searchable product databases
- **Slack** — Get notifications on new product launches
- **Make** — Create automated price monitoring workflows
- **Zapier** — Trigger actions based on price changes
- **Power BI** — Visualize pricing and availability trends

### Export Formats

Download data in multiple formats:

- **JSON** — For developers and API integrations
- **CSV** — For spreadsheet analysis and reporting
- **Excel** — For business intelligence dashboards
- **XML** — For enterprise system integrations

---

## Frequently Asked Questions

### How many products can I collect?
You can collect thousands of products. The practical limit depends on your search criteria and available products.

### Can I scrape multiple countries?
Yes, run separate actor instances for each country you want to research. Each run targets one country/language combination.

### What if products are out of stock?
Out-of-stock items are still included in results with appropriate availability status. This helps track inventory patterns.

### How current is the data?
Data is collected in real-time from IKEA's live catalog. Prices and availability reflect current website information.

### Can I monitor price changes over time?
Yes, schedule regular runs to track price changes, new product launches, and availability updates.

### What about product images?
All product images are included as direct URLs. Images remain accessible as long as the product exists in IKEA's catalog.

### How do I handle different currencies?
Each product includes both price amount and currency code. Convert currencies using your preferred exchange rate service.

### Can I filter by price range?
Use the search functionality to find products within specific price ranges, or filter results after collection.

---

## Support

For issues or feature requests, contact support through the Apify Console.

### Resources

- [Apify Documentation](https://docs.apify.com/)
- [API Reference](https://docs.apify.com/api/v2)
- [Scheduling Runs](https://docs.apify.com/schedules)

---

## Legal Notice

This actor is designed for legitimate data collection purposes. Users are responsible for ensuring compliance with website terms of service and applicable laws. Use data responsibly and respect rate limits.
