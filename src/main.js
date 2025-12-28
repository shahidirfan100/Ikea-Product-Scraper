// IKEA Product Scraper - Production-ready implementation
import { Actor, log } from 'apify';
import { CheerioCrawler, Dataset } from 'crawlee';
import { gotScraping } from 'got-scraping';

await Actor.init();

async function main() {
    try {
        const input = (await Actor.getInput()) || {};
        const {
            startUrls = [],
            country = 'gb',
            language = 'en',
            category = 'new-products',
            maxProducts = 100,
            maxPages = 10,
            collectDetails = true,
            proxyConfiguration,
        } = input;

        const MAX_PRODUCTS = Number.isFinite(+maxProducts) ? Math.max(1, +maxProducts) : Number.MAX_SAFE_INTEGER;
        const MAX_PAGES = Number.isFinite(+maxPages) ? Math.max(1, +maxPages) : 999;

        log.info('Starting IKEA Product Scraper', { country, language, category, maxProducts, collectDetails });

        const toAbs = (href, base = `https://www.ikea.com/${country}/${language}/`) => {
            try { return new URL(href, base).href; } catch { return null; }
        };

        // Default start URL if none provided
        const initial = startUrls.length 
            ? startUrls.map(u => typeof u === 'string' ? u : u.url)
            : [`https://www.ikea.com/${country}/${language}/new/${category}/`];

        const proxyConf = proxyConfiguration 
            ? await Actor.createProxyConfiguration({ ...proxyConfiguration }) 
            : undefined;

        let saved = 0;
        const seenProducts = new Set();

        // Enhanced headers for stealth
        const defaultHeaders = {
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept-Encoding': 'gzip, deflate, br',
            'DNT': '1',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none',
            'Cache-Control': 'max-age=0',
        };

        // PRIORITY 1: Try Embedded JSON from HTML (most reliable on IKEA)
        async function tryEmbeddedJson(url) {
            try {
                log.info('Attempting embedded JSON-LD extraction from HTML...');
                const response = await gotScraping({
                    url,
                    proxyUrl: proxyConf ? await proxyConf.newUrl() : undefined,
                    responseType: 'text',
                    headers: defaultHeaders,
                    timeout: { request: 30000 },
                });

                const html = response.body;
                
                // Look for JSON-LD product markup (IKEA uses this extensively)
                const jsonLdMatches = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi);
                if (jsonLdMatches) {
                    for (const match of jsonLdMatches) {
                        try {
                            const jsonStr = match.replace(/<script[^>]*>/, '').replace(/<\/script>/, '');
                            const data = JSON.parse(jsonStr);
                            
                            // Check if it's a product list
                            if (data['@type'] === 'ItemList' && data.itemListElement) {
                                log.info(`✓ Found ${data.itemListElement.length} products in JSON-LD`);
                                return { products: data.itemListElement, html };
                            }
                            
                            // Check if it's a single product
                            if (data['@type'] === 'Product' || (Array.isArray(data['@type']) && data['@type'].includes('Product'))) {
                                log.debug('Found single product JSON-LD');
                                return { products: [data], html, isSingleProduct: true };
                            }
                        } catch (e) {
                            log.debug(`Failed to parse JSON-LD: ${e.message}`);
                        }
                    }
                }

                return { products: null, html };
            } catch (err) {
                log.debug(`Embedded JSON extraction failed: ${err.message}`);
                return { products: null, html: null };
            }
        }


        // PRIORITY 3: Parse from HTML (most reliable fallback)
        function extractProductsFromHtml($) {
            log.info('Extracting products from HTML DOM...');
            const products = [];
            
            // IKEA uses various selectors, try them all
            const possibleSelectors = [
                '[data-testid="plp-product-card"]',
                '.plp-fragment-wrapper',
                '.product-compact',
                '.serp-grid__item',
                '.range-revamp-product-compact',
                '[class*="product-card"]',
                '.plp-product-list__products > div',
            ];

            let productElements = [];
            for (const selector of possibleSelectors) {
                const elements = $(selector).toArray();
                if (elements.length > 0) {
                    log.info(`✓ Found ${elements.length} products using selector: ${selector}`);
                    productElements = elements;
                    break;
                }
            }

            if (productElements.length === 0) {
                log.warning('No product elements found with any known selector');
                return [];
            }

            for (const elem of productElements) {
                try {
                    const $elem = $(elem);
                    
                    // Extract product URL (most reliable identifier)
                    const linkSelectors = [
                        'a[href*="/p/"]',
                        'a[data-testid*="product"]',
                        'a[class*="product"]',
                        'a',
                    ];
                    
                    let productUrl = null;
                    let $link = null;
                    
                    for (const linkSel of linkSelectors) {
                        $link = $elem.find(linkSel).first();
                        const href = $link.attr('href');
                        if (href && href.includes('/p/')) {
                            productUrl = toAbs(href);
                            break;
                        }
                    }

                    if (!productUrl) continue;

                    // Extract product ID from URL
                    const productId = productUrl.match(/\/p\/[^/]+-(\d+)\/?/)?.[1];
                    if (!productId || seenProducts.has(productId)) continue;
                    seenProducts.add(productId);

                    // Extract product name
                    const nameSelectors = [
                        '[data-testid="plp-product-title"]',
                        '.pip-product-summary__product-title',
                        '.product-compact__name',
                        'h3',
                        '[class*="product-title"]',
                        '[class*="product-name"]',
                    ];
                    
                    let name = null;
                    for (const nameSel of nameSelectors) {
                        const text = $elem.find(nameSel).first().text().trim();
                        if (text) {
                            name = text;
                            break;
                        }
                    }
                    
                    // Fallback to link aria-label
                    if (!name && $link) {
                        name = $link.attr('aria-label')?.replace(/^New\s+/i, '').trim();
                    }

                    // Extract price - IKEA shows it clearly on listing pages
                    const priceSelectors = [
                        '[data-testid*="price"]',
                        '.pip-temp-price',
                        '[class*="price-integer"]',
                        '[class*="pip-price"]',
                        '[class*="product-price"]',
                        'span:contains("£")',
                    ];
                    
                    let price = null;
                    let priceText = '';
                    
                    for (const priceSel of priceSelectors) {
                        priceText = $elem.find(priceSel).first().text().trim();
                        if (priceText.includes('£')) break;
                    }
                    
                    // If not found, try getting all text and look for price pattern
                    if (!priceText.includes('£')) {
                        priceText = $elem.text();
                    }
                    
                    const priceMatch = priceText.match(/£\s*([\d,]+(?:\.\d{2})?)/);
                    if (priceMatch) {
                        price = parseFloat(priceMatch[1].replace(/,/g, ''));
                    }

                    // Extract image
                    const imageSelectors = [
                        'img[data-testid="product-image"]',
                        'img[class*="product-image"]',
                        'img',
                    ];
                    
                    let image = null;
                    for (const imgSel of imageSelectors) {
                        const $img = $elem.find(imgSel).first();
                        image = $img.attr('src') || $img.attr('data-src') || $img.attr('data-lazy-src');
                        if (image && !image.includes('spacer') && !image.includes('placeholder')) {
                            break;
                        }
                    }

                    // Extract rating and review count from visible text
                    const ratingText = $elem.text();
                    const ratingMatch = ratingText.match(/([\d.]+)\s*(?:out of 5|\/\s*5)/i);
                    const rating = ratingMatch ? parseFloat(ratingMatch[1]) : null;

                    // Extract review count
                    const reviewMatch = ratingText.match(/(\d+)\s*(?:reviews?|review)/i);
                    const reviewCount = reviewMatch ? parseInt(reviewMatch[1], 10) : null;

                    const product = {
                        productId,
                        name,
                        price,
                        currency: price ? 'GBP' : null,
                        image,
                        url: productUrl,
                        rating,
                        reviewCount,
                        availability: 'Available',
                    };

                    // Only add products with at least a name and price
                    if (product.name && product.price) {
                        products.push(product);
                    }
                } catch (err) {
                    log.debug(`Failed to extract product: ${err.message}`);
                }
            }

            return products;
        }


        // Extract detailed product information from product page
        async function extractProductDetails(url, $) {
            try {
                const data = {};
                
                // Product name
                const nameSelectors = [
                    'h1[class*="pip-header-section"]',
                    '.pip-header-section__title',
                    'h1.product-name',
                    'h1',
                ];
                
                for (const sel of nameSelectors) {
                    const text = $(sel).first().text().trim();
                    if (text && text.length > 3) {
                        data.name = text;
                        break;
                    }
                }
                
                // Product ID
                data.productId = url.match(/\/p\/[^/]+-(\d+)\/?/)?.[1] || null;
                
                // Price - Look for "Price £ 60" pattern
                let priceText = $('body').text();
                const priceMatch = priceText.match(/Price\s*£\s*([\d,]+(?:\.\d{2})?)/);
                data.price = priceMatch ? parseFloat(priceMatch[1].replace(/,/g, '')) : null;
                data.currency = data.price ? 'GBP' : null;

                // Description
                const descSelectors = [
                    '[class*="pip-product-summary__description"]',
                    '.product-description',
                    '[class*="description"]',
                ];
                
                for (const sel of descSelectors) {
                    const text = $(sel).first().text().trim();
                    if (text && text.length > 20) {
                        data.description = text;
                        break;
                    }
                }
                
                // Measurements - Look for dimensions
                const pageText = $('body').text();
                const measureMatch = pageText.match(/(?:W|Width|H|Height|D|Depth).*?(?:cm|mm|in)/i);
                if (measureMatch) {
                    data.measurements = measureMatch[0].trim();
                }

                // Images
                const images = [];
                const imageSelectors = [
                    'img[class*="pip-media"]',
                    '[class*="product-image"] img',
                    '.pip-aspect-ratio-image__image',
                    'img[src*="product"]',
                    'img[src*="images"]',
                ];
                
                for (const sel of imageSelectors) {
                    $(sel).each((_, img) => {
                        const src = $(img).attr('src') || $(img).attr('data-src');
                        if (src && !src.includes('spacer') && !src.includes('placeholder') && !src.includes('favicon') && !images.includes(src)) {
                            // Extract main image path
                            if (src.includes('products')) {
                                images.push(src);
                            }
                        }
                    });
                    if (images.length > 0) break;
                }
                data.images = images.length ? images : null;

                // Rating - Look for "3.3 out of 5"
                const ratingMatch = pageText.match(/([\d.]+)\s*out of 5/i);
                data.rating = ratingMatch ? parseFloat(ratingMatch[1]) : null;
                
                // Review count - Look for "3 Reviews"
                const reviewMatch = pageText.match(/(\d+)\s*(?:review|reviews)/i);
                data.reviewCount = reviewMatch ? parseInt(reviewMatch[1], 10) : null;

                // Features - Extract from "Product features" section
                const features = [];
                const $body = $('body');
                
                // Look for feature text blocks
                $body.find('li, span, p').each((_, el) => {
                    const text = $(el).text().trim();
                    if (text && text.length > 10 && text.length < 200 && !text.match(/^\d+|^£|^Add|^Select/i)) {
                        // Check if it looks like a feature (not too long, not a number/price)
                        if (!features.includes(text) && features.length < 10) {
                            features.push(text);
                        }
                    }
                });
                
                // Clean up features - remove duplicates and filter
                const cleanedFeatures = features
                    .filter(f => f.length > 10 && !f.includes('Add to') && !f.includes('Select') && !f.includes('Choose'))
                    .slice(0, 5);
                
                data.features = cleanedFeatures.length ? cleanedFeatures : null;

                // Type/category - Get from breadcrumb or header
                const typeMatch = pageText.match(/(?:Category|Type):\s*([^\n]+)/i);
                if (typeMatch) {
                    data.type = typeMatch[1].trim();
                }

                // Availability - Look for stock status
                const availMatch = pageText.match(/(?:Stock|Available|Availability):\s*([^\n]+)/i);
                data.availability = availMatch ? availMatch[1].trim() : 'Check availability';

                return data;
            } catch (err) {
                log.error(`Failed to extract details from ${url}: ${err.message}`);
                return null;
            }
        }


        // Find pagination links
        function findNextPage($, currentUrl) {
            // IKEA pagination methods
            const nextSelectors = [
                'a[aria-label*="next" i]',
                'a[rel="next"]',
                'button[aria-label*="next" i]',
                '[class*="pagination"] a[href*="page"]',
                '[data-testid*="next"]',
            ];

            for (const selector of nextSelectors) {
                const $next = $(selector).first();
                if ($next.length) {
                    const href = $next.attr('href');
                    if (href) {
                        return toAbs(href, currentUrl);
                    }
                }
            }

            // Check for "Show more" button (might indicate dynamic loading)
            const showMore = $('button:contains("Show more"), button:contains("Load more")').first();
            if (showMore.length) {
                log.debug('Detected "Show more" button - IKEA likely uses dynamic loading');
            }

            return null;
        }

        // Process API response products
        function processApiProduct(product) {
            const productId = product.id || product.productId || product.itemNo;
            if (!productId || seenProducts.has(String(productId))) return null;
            seenProducts.add(String(productId));

            return {
                productId: String(productId),
                name: product.name || product.title || product.productName || null,
                price: product.price?.value || product.priceNumeral || product.price || null,
                currency: product.price?.currency || product.currencyCode || 'GBP',
                image: product.image || product.mainImageUrl || product.imageUrl || null,
                url: product.url || product.pipUrl || toAbs(`/p/${product.name?.toLowerCase().replace(/\s+/g, '-')}-${productId}/`),
                rating: product.rating || product.averageRating || null,
                reviewCount: product.reviewCount || product.numberOfReviews || null,
                availability: product.availability || product.availableForClickAndCollect ? 'Available' : 'Check availability',
                category: category || null,
            };
        }

        const crawler = new CheerioCrawler({
            proxyConfiguration: proxyConf,
            maxRequestRetries: 3,
            useSessionPool: true,
            persistCookiesPerSession: true,
            maxConcurrency: 5,
            requestHandlerTimeoutSecs: 120,
            
            // Add pre-navigation hook for headers
            preNavigationHooks: [
                async ({ request }, goToOptions) => {
                    goToOptions.headers = {
                        ...goToOptions.headers,
                        ...defaultHeaders,
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    };
                },
            ],
            
            async requestHandler({ request, $, enqueueLinks, log: crawlerLog }) {
                const label = request.userData?.label || 'LIST';
                const pageNo = request.userData?.pageNo || 1;

                crawlerLog.info(`[${label}] Processing page ${pageNo}: ${request.url}`);

                if (label === 'LIST') {
                    let productsFound = [];

                    // PRIORITY 1: Try embedded JSON-LD (most reliable for IKEA)
                    const { products: jsonProducts, html } = await tryEmbeddedJson(request.url);
                    
                    if (jsonProducts && jsonProducts.length > 0) {
                        crawlerLog.info(`✓ Using JSON-LD data (${jsonProducts.length} products)`);
                        for (const jsonProduct of jsonProducts) {
                            if (saved >= MAX_PRODUCTS) break;
                            const product = processApiProduct(jsonProduct);
                            if (product) productsFound.push(product);
                        }
                    }

                    // PRIORITY 2: Parse HTML if JSON-LD failed
                    if (productsFound.length === 0 && $) {
                        crawlerLog.info('Falling back to HTML parsing...');
                        productsFound = extractProductsFromHtml($);
                        crawlerLog.info(`✓ Extracted ${productsFound.length} products from HTML`);
                    }

                    if (productsFound.length === 0) {
                        crawlerLog.warning(`⚠ No products found on page ${pageNo}`);
                    }

                    // Process found products
                    for (const product of productsFound) {
                        if (saved >= MAX_PRODUCTS) break;

                        if (collectDetails && product.url) {
                            await enqueueLinks({ 
                                urls: [product.url], 
                                userData: { label: 'DETAIL', baseData: product } 
                            });
                        } else {
                            await Dataset.pushData({ ...product, category: category || null });
                            saved++;
                            crawlerLog.info(`Saved product ${saved}/${MAX_PRODUCTS}: ${product.name}`);
                        }
                    }

                    // Handle pagination
                    if (saved < MAX_PRODUCTS && pageNo < MAX_PAGES && productsFound.length > 0) {
                        const nextUrl = findNextPage($, request.url);
                        if (nextUrl) {
                            crawlerLog.info(`→ Enqueueing next page: ${nextUrl}`);
                            await enqueueLinks({ 
                                urls: [nextUrl], 
                                userData: { label: 'LIST', pageNo: pageNo + 1 } 
                            });
                        } else {
                            crawlerLog.info('No more pages to scrape');
                        }
                    }

                    return;
                }

                if (label === 'DETAIL') {
                    if (saved >= MAX_PRODUCTS) return;
                    
                    try {
                        const baseData = request.userData?.baseData || {};
                        const details = await extractProductDetails(request.url, $);
                        
                        const finalProduct = {
                            ...baseData,
                            ...details,
                            url: request.url,
                            category: category || null,
                            scrapedAt: new Date().toISOString(),
                        };

                        await Dataset.pushData(finalProduct);
                        saved++;
                        crawlerLog.info(`✓ Saved detailed product ${saved}/${MAX_PRODUCTS}: ${finalProduct.name}`);
                    } catch (err) {
                        crawlerLog.error(`Failed to process detail page ${request.url}: ${err.message}`);
                    }
                }
            },
            
            async failedRequestHandler({ request }, error) {
                log.error(`Request ${request.url} failed after ${request.retryCount} retries: ${error.message}`);
            },
        });

        log.info(`Starting crawl with ${initial.length} URL(s)`);
        await crawler.run(initial.map(url => ({ url, userData: { label: 'LIST', pageNo: 1 } })));
        
        log.info(`✅ Scraping completed! Saved ${saved} products from IKEA ${country.toUpperCase()}`);
        
        if (saved === 0) {
            log.warning('⚠ WARNING: No products were saved. Check logs above for errors.');
        }
        
    } catch (error) {
        log.error(`Fatal error in main: ${error.message}`);
        log.exception(error);
        throw error;
    } finally {
        await Actor.exit();
    }
}

main().catch(err => { 
    log.error(`Unhandled error: ${err.message}`);
    log.exception(err);
    process.exit(1); 
});
