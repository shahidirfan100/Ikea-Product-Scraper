# IKEA Product Scraper

Extract comprehensive product information from IKEA's online catalog across multiple countries and categories. This solution efficiently retrieves product details, pricing, images, ratings, specifications, and availability data.

## Features

<ul>
<li><strong>Multi-Country Support</strong> — Scrape from 30+ IKEA country websites including UK, US, Germany, France, Sweden, and more</li>
<li><strong>Comprehensive Data Extraction</strong> — Collect product names, IDs, prices, images, descriptions, measurements, ratings, reviews, and availability</li>
<li><strong>Smart Extraction Methods</strong> — Automatically tries JSON API extraction first for speed, falls back to HTML parsing for reliability</li>
<li><strong>Flexible Configuration</strong> — Choose between quick overview scraping or detailed product information extraction</li>
<li><strong>Category Filtering</strong> — Target specific categories like new products, furniture, storage, kitchens, and more</li>
<li><strong>Built-in Deduplication</strong> — Automatically prevents duplicate products in results</li>
<li><strong>Pagination Support</strong> — Automatically navigates through multiple pages of product listings</li>
<li><strong>Rate Limit Protection</strong> — Configurable proxy support to avoid blocking</li>
</ul>

## Use Cases

<ul>
<li><strong>Price Monitoring</strong> — Track product prices across different regions and time periods</li>
<li><strong>Market Research</strong> — Analyze product catalogs, pricing strategies, and inventory availability</li>
<li><strong>Competitor Analysis</strong> — Compare product offerings and pricing across markets</li>
<li><strong>Inventory Management</strong> — Monitor stock availability and product launches</li>
<li><strong>E-commerce Intelligence</strong> — Build price comparison platforms and shopping assistants</li>
<li><strong>Data Analysis</strong> — Conduct market trend analysis and consumer behavior studies</li>
</ul>

## Input Configuration

The scraper accepts the following input parameters:

<table>
<thead>
<tr>
<th>Parameter</th>
<th>Type</th>
<th>Description</th>
<th>Default</th>
</tr>
</thead>
<tbody>
<tr>
<td><code>startUrls</code></td>
<td>Array</td>
<td>List of IKEA URLs to scrape (category pages, search results, or product pages). Leave empty to use default new products page.</td>
<td><code>[]</code></td>
</tr>
<tr>
<td><code>country</code></td>
<td>String</td>
<td>IKEA country code (e.g., 'gb' for UK, 'us' for USA, 'de' for Germany). Supports 30+ countries.</td>
<td><code>"gb"</code></td>
</tr>
<tr>
<td><code>language</code></td>
<td>String</td>
<td>Language code for the website (e.g., 'en' for English, 'de' for German).</td>
<td><code>"en"</code></td>
</tr>
<tr>
<td><code>category</code></td>
<td>String</td>
<td>Product category to scrape. Use 'new-products' for latest items, or specify categories like 'furniture', 'storage', 'kitchens', etc.</td>
<td><code>"new-products"</code></td>
</tr>
<tr>
<td><code>maxProducts</code></td>
<td>Integer</td>
<td>Maximum number of products to scrape. Set to 0 for unlimited.</td>
<td><code>100</code></td>
</tr>
<tr>
<td><code>maxPages</code></td>
<td>Integer</td>
<td>Maximum number of listing pages to process (safety limit).</td>
<td><code>10</code></td>
</tr>
<tr>
<td><code>collectDetails</code></td>
<td>Boolean</td>
<td>If enabled, visits each product page to extract full details (description, features, measurements, all images). Disable for faster scraping with basic info only.</td>
<td><code>true</code></td>
</tr>
<tr>
<td><code>proxyConfiguration</code></td>
<td>Object</td>
<td>Proxy settings to avoid rate limiting. Residential proxies recommended for best results.</td>
<td>Apify Proxy (Residential)</td>
</tr>
</tbody>
</table>

### Input Example

```json
{
  "startUrls": [],
  "country": "gb",
  "language": "en",
  "category": "new-products",
  "maxProducts": 50,
  "maxPages": 5,
  "collectDetails": true,
  "proxyConfiguration": {
    "useApifyProxy": true,
    "apifyProxyGroups": ["RESIDENTIAL"]
  }
}
```

### Custom Start URLs

You can provide specific IKEA URLs to scrape:

```json
{
  "startUrls": [
    "https://www.ikea.com/gb/en/new/new-products/",
    "https://www.ikea.com/us/en/cat/furniture-fu001/",
    "https://www.ikea.com/de/de/cat/storage-st001/"
  ],
  "maxProducts": 100,
  "collectDetails": true
}
```

## Output

The scraper outputs structured product data in the following format:

### Basic Output (when `collectDetails: false`)

```json
{
  "productId": "40604574",
  "name": "CHOKLADHAJ Food storage box, set of 2, wood",
  "price": 10.0,
  "currency": "GBP",
  "image": "https://www.ikea.com/...",
  "url": "https://www.ikea.com/gb/en/p/chokladhaj-food-storage-box-set-of-2-wood-40604574/",
  "rating": 5.0,
  "reviewCount": 2,
  "availability": "In stock",
  "category": "new-products"
}
```

### Detailed Output (when `collectDetails: true`)

```json
{
  "productId": "40604574",
  "name": "CHOKLADHAJ Food storage box, set of 2, wood",
  "price": 10.0,
  "currency": "GBP",
  "description": "Store your food in sustainable and stylish containers...",
  "measurements": "Length: 20 cm, Width: 15 cm, Height: 8 cm",
  "type": "Storage",
  "category": "new-products",
  "images": [
    "https://www.ikea.com/gb/en/images/products/...",
    "https://www.ikea.com/gb/en/images/products/..."
  ],
  "features": [
    "Made from sustainable materials",
    "Stackable design saves space",
    "Easy to clean"
  ],
  "rating": 5.0,
  "reviewCount": 2,
  "availability": "In stock",
  "url": "https://www.ikea.com/gb/en/p/chokladhaj-food-storage-box-set-of-2-wood-40604574/",
  "scrapedAt": "2025-12-28T10:30:00.000Z"
}
```

### Output Fields

<table>
<thead>
<tr>
<th>Field</th>
<th>Type</th>
<th>Description</th>
</tr>
</thead>
<tbody>
<tr>
<td><code>productId</code></td>
<td>String</td>
<td>Unique IKEA product identifier</td>
</tr>
<tr>
<td><code>name</code></td>
<td>String</td>
<td>Product name including variant details</td>
</tr>
<tr>
<td><code>price</code></td>
<td>Number</td>
<td>Product price in local currency</td>
</tr>
<tr>
<td><code>currency</code></td>
<td>String</td>
<td>Currency code (e.g., GBP, USD, EUR)</td>
</tr>
<tr>
<td><code>description</code></td>
<td>String</td>
<td>Product description (detailed mode only)</td>
</tr>
<tr>
<td><code>measurements</code></td>
<td>String</td>
<td>Product dimensions and specifications (detailed mode only)</td>
</tr>
<tr>
<td><code>type</code></td>
<td>String</td>
<td>Product type or subcategory (detailed mode only)</td>
</tr>
<tr>
<td><code>category</code></td>
<td>String</td>
<td>Main category being scraped</td>
</tr>
<tr>
<td><code>image</code></td>
<td>String</td>
<td>Main product image URL</td>
</tr>
<tr>
<td><code>images</code></td>
<td>Array</td>
<td>All product images (detailed mode only)</td>
</tr>
<tr>
<td><code>features</code></td>
<td>Array</td>
<td>Product features and highlights (detailed mode only)</td>
</tr>
<tr>
<td><code>rating</code></td>
<td>Number</td>
<td>Average customer rating (out of 5)</td>
</tr>
<tr>
<td><code>reviewCount</code></td>
<td>Number</td>
<td>Total number of customer reviews</td>
</tr>
<tr>
<td><code>availability</code></td>
<td>String</td>
<td>Stock availability status</td>
</tr>
<tr>
<td><code>url</code></td>
<td>String</td>
<td>Direct link to product page</td>
</tr>
<tr>
<td><code>scrapedAt</code></td>
<td>String</td>
<td>ISO timestamp of when data was scraped (detailed mode only)</td>
</tr>
</tbody>
</table>

## Performance and Limits

<ul>
<li><strong>Speed</strong> — Basic scraping: ~50-100 products per minute. Detailed scraping: ~20-30 products per minute</li>
<li><strong>Concurrency</strong> — Optimized at 5 concurrent requests for IKEA servers</li>
<li><strong>Deduplication</strong> — Automatically removes duplicate products based on product ID</li>
<li><strong>Timeout</strong> — 90 seconds per request with 3 retry attempts</li>
</ul>

## Best Practices

<ol>
<li><strong>Use Proxy Configuration</strong> — Always enable Apify Proxy (residential proxies recommended) to prevent rate limiting and blocking</li>
<li><strong>Set Reasonable Limits</strong> — Use <code>maxProducts</code> and <code>maxPages</code> to control scraping scope and costs</li>
<li><strong>Choose Appropriate Detail Level</strong> — Disable <code>collectDetails</code> if you only need basic product information for faster results</li>
<li><strong>Target Specific Categories</strong> — Use specific category URLs in <code>startUrls</code> for focused data collection</li>
<li><strong>Monitor Results</strong> — Check the Output tab during runs to ensure data quality</li>
<li><strong>Respect Rate Limits</strong> — The scraper is configured with appropriate delays and concurrency limits</li>
</ol>

## Supported Countries

The scraper supports IKEA websites from these countries:

<p>
United Kingdom, United States, Germany, France, Sweden, Norway, Denmark, Finland, Netherlands, Belgium, Switzerland, Austria, Italy, Spain, Portugal, Poland, Czech Republic, Slovakia, Hungary, Romania, Croatia, Slovenia, Ireland, Canada, Australia, Japan, South Korea, China, Taiwan, Hong Kong, Singapore, Malaysia, Thailand, United Arab Emirates
</p>

## Troubleshooting

<h3>No Results Returned</h3>

<ul>
<li>Verify the country code and language match the target IKEA website</li>
<li>Check that <code>startUrls</code> are valid IKEA URLs</li>
<li>Ensure proxy configuration is enabled</li>
<li>Try increasing <code>maxPages</code> if scraping a large category</li>
</ul>

<h3>Incomplete Data</h3>

<ul>
<li>Enable <code>collectDetails: true</code> to extract full product information</li>
<li>Some products may have limited information on IKEA's website</li>
<li>Check the log for any error messages during scraping</li>
</ul>

<h3>Rate Limiting or Blocking</h3>

<ul>
<li>Ensure Apify Proxy is enabled with residential proxies</li>
<li>Reduce concurrency by decreasing <code>maxProducts</code></li>
<li>Add delays between requests if needed</li>
</ul>

<h3>Outdated Selectors</h3>

<ul>
<li>IKEA may update their website structure periodically</li>
<li>The scraper uses both JSON API and HTML fallback methods for reliability</li>
<li>Report issues if extraction fails consistently</li>
</ul>

## Integration

<h3>API Access</h3>

Access your scraped data via the Apify API:

```bash
curl "https://api.apify.com/v2/datasets/[DATASET_ID]/items"
```

<h3>Export Formats</h3>

Download data in multiple formats:
<ul>
<li>JSON</li>
<li>CSV</li>
<li>Excel</li>
<li>XML</li>
<li>RSS</li>
</ul>

<h3>Webhooks</h3>

Set up webhooks to receive notifications when scraping completes or integrate directly with your applications.

## Technical Details

<ul>
<li><strong>Runtime</strong> — Node.js 22</li>
<li><strong>Architecture</strong> — CheerioCrawler with gotScraping for efficient HTTP requests</li>
<li><strong>Extraction Methods</strong> — Prioritizes JSON API extraction, falls back to HTML parsing</li>
<li><strong>Memory Usage</strong> — Optimized for low memory consumption</li>
<li><strong>Error Handling</strong> — Comprehensive error handling with automatic retries</li>
</ul>

## Support and Feedback

<p>
For issues, questions, or feature requests, please reach out through the Apify platform. We continuously improve the scraper based on user feedback and IKEA website changes.
</p>

## Legal and Ethical Considerations

<p>
This scraper is intended for legitimate use cases such as price monitoring, market research, and data analysis. Users are responsible for ensuring their use complies with IKEA's terms of service and applicable laws. Always respect robots.txt directives and implement appropriate rate limiting. Do not use this tool to harm IKEA's infrastructure or for unauthorized commercial purposes.
</p>

## Version History

<ul>
<li><strong>1.0.0</strong> — Initial release with multi-country support, JSON API extraction, and comprehensive product data collection</li>
</ul>
