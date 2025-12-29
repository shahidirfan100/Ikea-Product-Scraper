// IKEA Product Scraper - Production-ready implementation
import { Actor, log } from 'apify';
import { CheerioCrawler, Dataset, sleep } from 'crawlee';
import { gotScraping } from 'got-scraping';

const SPECIAL_CATEGORY_MAP = {
    'new-products': 'new_product',
    'family-offers': 'family_price',
    'lower-price': 'new_lower_price',
    'last-chance': 'last_chance',
    'lowest-price': 'breath_taking',
    'limited-time-offers': 'time_restricted',
    'best-sellers': 'top_seller',
    'limited-edition': 'limited_edition',
};

const SIK_CLIENT_ID = 'listaf';
const SIK_VERSION = '20250507';
const DEFAULT_PAGE_SIZE = 48;
const MAX_API_WINDOW = 480;

const pickUserAgent = () => {
    const agents = [
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6_1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    ];
    return agents[Math.floor(Math.random() * agents.length)];
};

const buildAcceptLanguage = (language, country) => {
    const normalizedLang = (language || 'en').toLowerCase();
    const countryCode = (country || 'gb').toUpperCase();
    return `${normalizedLang}-${countryCode},${normalizedLang};q=0.9,en;q=0.8`;
};

const fetchWithRetry = async (options, { attempts = 3, label = 'request', proxyConf } = {}) => {
    let lastErr;
    for (let i = 1; i <= attempts; i++) {
        try {
            const proxiedOptions = { ...options };
            if (proxyConf) {
                proxiedOptions.proxyUrl = await proxyConf.newUrl();
            }
            return await gotScraping(proxiedOptions);
        } catch (err) {
            lastErr = err;
            const status = err.response?.statusCode;
            const retriable = status === 590 || status === 502 || status === 504 || status === 429;
            log.warning(`Attempt ${i}/${attempts} failed for ${label}: ${status || err.code || err.message}`);
            if (i === attempts || !retriable) break;
            await sleep(500 * i + Math.random() * 500);
        }
    }
    throw lastErr;
};

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

        const MAX_PRODUCTS = Number.isFinite(+maxProducts) && +maxProducts > 0
            ? Math.max(1, +maxProducts)
            : Number.MAX_SAFE_INTEGER;
        const MAX_PAGES = Number.isFinite(+maxPages) ? Math.max(1, +maxPages) : 999;

        log.info('Starting IKEA Product Scraper', { country, language, category, maxProducts, collectDetails });

        const toAbs = (href, base = `https://www.ikea.com/${country}/${language}/`) => {
            try { return new URL(href, base).href; } catch { return null; }
        };

        const initial = startUrls.length
            ? startUrls.map((u) => (typeof u === 'string' ? u : u.url))
            : [`https://www.ikea.com/${country}/${language}/new/${category}/`];

        const proxyConf = proxyConfiguration
            ? await Actor.createProxyConfiguration({ ...proxyConfiguration })
            : undefined;

        let saved = 0;
        const seenProducts = new Set();
        const detailRequests = [];

        const userAgent = pickUserAgent();
        const defaultHeaders = {
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            'Accept-Language': buildAcceptLanguage(language, country),
            'Accept-Encoding': 'gzip, deflate, br',
            Connection: 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none',
            'User-Agent': userAgent,
        };

        const resolveSikSearch = () => {
            if (!startUrls.length) {
                const special = SPECIAL_CATEGORY_MAP[category];
                if (special) return { input: special, type: 'SPECIAL' };
                if (category) return { input: category, type: 'CATEGORY' };
                return null;
            }

            const first = typeof startUrls[0] === 'string' ? startUrls[0] : startUrls[0]?.url;
            if (!first) return null;

            try {
                const url = new URL(first);
                const parts = url.pathname.split('/').filter(Boolean);
                const lastSegment = parts[parts.length - 1];

                if (parts.includes('new')) {
                    const special = SPECIAL_CATEGORY_MAP[lastSegment] || SPECIAL_CATEGORY_MAP[category];
                    if (special) return { input: special, type: 'SPECIAL' };
                }

                if (parts.includes('cat') && lastSegment) {
                    return { input: lastSegment, type: 'CATEGORY' };
                }
            } catch (err) {
                log.debug(`Failed to parse start URL for SIK API: ${err.message}`);
            }
            return null;
        };

        const mapSikProduct = (product) => {
            const productId = String(product.itemNo || product.itemNoGlobal || product.id || product.productNumber || '').trim();
            if (!productId || seenProducts.has(productId)) return null;
            seenProducts.add(productId);

            const nameParts = [product.name, product.typeName].filter(Boolean);
            const name = nameParts.length ? nameParts.join(' ').trim() : product.name;

            const price = product.salesPrice?.numeral ?? product.priceNumeral ?? null;
            const currency = product.salesPrice?.currencyCode || product.currencyCode || null;

            const availabilityText = Array.isArray(product.availability) && product.availability.length
                ? product.availability.join(', ')
                : 'Check availability';

            const image = product.mainImageUrl
                || product.allProductImage?.find((img) => img.url)?.url
                || null;

            return {
                productId,
                name: name || product.productName || null,
                price,
                currency,
                image,
                url: product.pipUrl ? toAbs(product.pipUrl) : null,
                rating: product.ratingValue ?? product.averageRating ?? null,
                reviewCount: product.ratingCount ?? product.numberOfReviews ?? null,
                availability: availabilityText,
                category: category || null,
            };
        };

        const tryEmbeddedJson = async (url) => {
            try {
                log.info('Attempting JSON-LD extraction from HTML...');
                const response = await fetchWithRetry({
                    url,
                    responseType: 'text',
                    headers: defaultHeaders,
                    timeout: { request: 30000 },
                    retry: { limit: 0 },
                }, { attempts: 3, label: 'JSON-LD fetch', proxyConf });

                const html = response.body;
                const jsonLdMatches = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi);
                if (jsonLdMatches) {
                    for (const match of jsonLdMatches) {
                        try {
                            const jsonStr = match.replace(/<script[^>]*>/, '').replace(/<\/script>/, '');
                            const data = JSON.parse(jsonStr);
                            if (data['@type'] === 'ItemList' && data.itemListElement) {
                                log.info(`✓ Found ${data.itemListElement.length} products in JSON-LD`);
                                return { products: data.itemListElement, html };
                            }

                            if (data['@type'] === 'Product'
                                || (Array.isArray(data['@type']) && data['@type'].includes('Product'))) {
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
        };

        const extractProductsFromHtml = ($) => {
            log.info('Extracting products from HTML DOM...');
            const products = [];
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
                    log.info(`✓ Found ${elements.length} products using selector: ${selector}`);
                    productElements = elements;
                    break;
                }
            }

            if (productElements.length === 0) {
                return [];
            }

            for (const elem of productElements) {
                try {
                    const $elem = $(elem);
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

                    const productId = productUrl.match(/\/p\/[^/]+-(\d+)\/?/)?.[1];
                    if (!productId || seenProducts.has(productId)) continue;
                    seenProducts.add(productId);

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

                    if (!name && $link) {
                        name = $link.attr('aria-label')?.replace(/^New\s+/i, '').trim();
                    }

                    const priceText = $elem.text();
                    const priceMatch = priceText.replace(/,/g, '').match(/(\d+(?:\.\d{1,2})?)/);
                    const price = priceMatch ? parseFloat(priceMatch[1]) : null;

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

                    const ratingText = $elem.text();
                    const ratingMatch = ratingText.match(/([\d.]+)\s*(?:out of 5|\/\s*5)/i);
                    const rating = ratingMatch ? parseFloat(ratingMatch[1]) : null;

                    const reviewMatch = ratingText.match(/(\d+)\s*(?:reviews?|review)/i);
                    const reviewCount = reviewMatch ? parseInt(reviewMatch[1], 10) : null;

                    const product = {
                        productId,
                        name,
                        price,
                        currency: null,
                        image,
                        url: productUrl,
                        rating,
                        reviewCount,
                        availability: 'Available',
                    };

                    if (product.name && product.price) {
                        products.push(product);
                    }
                } catch (err) {
                    log.debug(`Failed to extract product: ${err.message}`);
                }
            }

            return products;
        };

        const extractProductDetails = async (url, $) => {
            try {
                const data = {};

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

                data.productId = url.match(/\/p\/[^/]+-(\d+)\/?/)?.[1] || null;

                const bodyText = $('body').text();
                const priceMatch = bodyText.replace(/,/g, '').match(/Price\s*\p{Sc}?\s*(\d+(?:\.\d{1,2})?)/u);
                data.price = priceMatch ? parseFloat(priceMatch[1]) : null;

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

                const measureMatch = bodyText.match(/(?:W|Width|H|Height|D|Depth).*?(?:cm|mm|in)/i);
                if (measureMatch) {
                    data.measurements = measureMatch[0].trim();
                }

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
                            if (src.includes('products')) {
                                images.push(src);
                            }
                        }
                    });
                    if (images.length > 0) break;
                }
                data.images = images.length ? images : null;

                const ratingMatch = bodyText.match(/([\d.]+)\s*out of 5/i);
                data.rating = ratingMatch ? parseFloat(ratingMatch[1]) : null;

                const reviewMatch = bodyText.match(/(\d+)\s*(?:review|reviews)/i);
                data.reviewCount = reviewMatch ? parseInt(reviewMatch[1], 10) : null;

                const features = [];
                $('li, span, p').each((_, el) => {
                    const text = $(el).text().trim();
                    if (text && text.length > 10 && text.length < 200 && !text.match(/^\d+/)) {
                        if (!features.includes(text) && features.length < 10) {
                            features.push(text);
                        }
                    }
                });

                const cleanedFeatures = features
                    .filter((f) => f.length > 10 && !/Add to|Select|Choose/i.test(f))
                    .slice(0, 5);

                data.features = cleanedFeatures.length ? cleanedFeatures : null;

                const typeMatch = bodyText.match(/(?:Category|Type):\s*([^\n]+)/i);
                if (typeMatch) {
                    data.type = typeMatch[1].trim();
                }

                const availMatch = bodyText.match(/(?:Stock|Available|Availability):\s*([^\n]+)/i);
                data.availability = availMatch ? availMatch[1].trim() : 'Check availability';

                return data;
            } catch (err) {
                log.error(`Failed to extract details from ${url}: ${err.message}`);
                return null;
            }
        };

        const findNextPage = ($, currentUrl, pageNo) => {
            const nextSelectors = [
                'a[aria-label*="next" i]',
                'a[rel="next"]',
                'button[aria-label*="next" i]:not([disabled])',
                '[class*="pagination"] a[href*="page"]',
                '[data-testid*="next"]:not([disabled])',
                'a.pagination__option--next',
            ];

            for (const selector of nextSelectors) {
                const $next = $(selector).first();
                if ($next.length) {
                    const href = $next.attr('href');
                    const disabled = $next.attr('disabled') || $next.attr('aria-disabled') === 'true';
                    if (href && !disabled) {
                        return toAbs(href, currentUrl);
                    }
                }
            }

            const url = new URL(currentUrl);
            const nextPage = pageNo + 1;

            if (url.searchParams.has('page') || pageNo === 1) {
                url.searchParams.set('page', nextPage);
                return url.toString();
            }

            if (url.searchParams.has('offset')) {
                const offset = parseInt(url.searchParams.get('offset') || '0', 10);
                url.searchParams.set('offset', offset + 24);
                return url.toString();
            }

            if (pageNo === 1) {
                url.searchParams.set('page', '2');
                return url.toString();
            }

            return null;
        };

        const processJsonLdProduct = (product) => {
            const productId = product.id || product.productId || product.item?.sku || product.item?.productID;
            if (!productId || seenProducts.has(String(productId))) return null;
            seenProducts.add(String(productId));

            const price = product.offers?.price || product.price;
            const currency = product.offers?.priceCurrency || product.currency;

            return {
                productId: String(productId),
                name: product.name || product.item?.name || null,
                price: price ? parseFloat(String(price).replace(/,/g, '')) : null,
                currency: currency || null,
                image: Array.isArray(product.image) ? product.image[0] : product.image,
                url: product.url ? toAbs(product.url) : null,
                rating: product.aggregateRating?.ratingValue || null,
                reviewCount: product.aggregateRating?.reviewCount || null,
                availability: product.offers?.availability || 'Check availability',
                category: category || null,
            };
        };

        const fetchViaSik = async (searchConfig) => {
            const { input, type } = searchConfig;
            const base = `https://sik.search.blue.cdtapps.com/${country}/${language}`;
            let offset = 0;
            let page = 1;
            let total = Infinity;
            let count = 0;

            while (saved < MAX_PRODUCTS && offset < total && page <= MAX_PAGES) {
                const windowSize = Math.min(DEFAULT_PAGE_SIZE, MAX_PRODUCTS - saved, MAX_API_WINDOW);
                const body = {
                    searchParameters: { input, type },
                    components: [
                        {
                            component: 'PRIMARY_AREA',
                            types: { main: 'PRODUCT', breakouts: [] },
                            filterConfig: {},
                            window: { size: windowSize, offset },
                            columns: 4,
                        },
                    ],
                };
                const url = new URL(`${base}/search`);
                url.searchParams.set('c', SIK_CLIENT_ID);
                url.searchParams.set('v', SIK_VERSION);

                const response = await fetchWithRetry({
                    url: url.toString(),
                    method: 'POST',
                    headers: defaultHeaders,
                    responseType: 'json',
                    json: body,
                    timeout: { request: 30000 },
                }, { attempts: 3, label: 'SIK API', proxyConf });

                const primary = response.body?.results?.find((res) => res.component === 'PRIMARY_AREA');
                if (!primary) {
                    log.warning('SIK API responded without PRIMARY_AREA payload, falling back to HTML.');
                    break;
                }

                const items = primary.items?.filter((item) => item.type === 'PRODUCT' && item.product) ?? [];
                total = primary.metadata?.itemsPerType?.PRODUCT ?? primary.metadata?.max ?? total;

                if (!items.length) {
                    log.warning(`SIK API returned no products for batch offset ${offset}.`);
                    break;
                }

                for (const item of items) {
                    if (saved >= MAX_PRODUCTS) break;
                    const mapped = mapSikProduct(item.product);
                    if (!mapped) continue;

                    if (collectDetails && mapped.url) {
                        detailRequests.push({ url: mapped.url, userData: { baseData: mapped } });
                    } else {
                        await Dataset.pushData(mapped);
                        saved++;
                        log.info(`Saved product ${saved}/${MAX_PRODUCTS} from API: ${mapped.name}`);
                    }
                    count++;
                }

                offset += windowSize;
                page++;
            }

            return count;
        };

        const runDetailCrawler = async () => {
            if (!collectDetails || !detailRequests.length || saved >= MAX_PRODUCTS) return;

            const crawler = new CheerioCrawler({
                proxyConfiguration: proxyConf,
                maxRequestRetries: 2,
                useSessionPool: true,
                persistCookiesPerSession: true,
                maxConcurrency: 3,
                maxRequestsPerMinute: 60,
                requestHandlerTimeoutSecs: 90,
                preNavigationHooks: [
                    async (_, goToOptions) => {
                        await sleep(500 + Math.random() * 700);
                        goToOptions.headers = {
                            ...defaultHeaders,
                            'sec-ch-ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
                            'sec-ch-ua-mobile': '?0',
                            'sec-ch-ua-platform': '"Windows"',
                        };
                    },
                ],
                async requestHandler({ request, $, log: crawlerLog }) {
                    if (saved >= MAX_PRODUCTS) return;
                    try {
                        const baseData = request.userData?.baseData || {};
                        const details = await extractProductDetails(request.url, $);
                        const finalProduct = {
                            ...baseData,
                            ...details,
                            url: request.url,
                            category: category || baseData.category || null,
                            scrapedAt: new Date().toISOString(),
                        };

                        await Dataset.pushData(finalProduct);
                        saved++;
                        crawlerLog.info(`Saved detailed product ${saved}/${MAX_PRODUCTS}: ${finalProduct.name}`);
                    } catch (err) {
                        crawlerLog.error(`Detail request failed for ${request.url}: ${err.message}`);
                    }
                },
                failedRequestHandler({ request, session }, error) {
                    log.error(`Detail request ${request.url} failed: ${error.message}`);
                    if (session) session.retire();
                },
            });

            await crawler.run(detailRequests);
        };

        const runHtmlCrawler = async (startingUrls) => {
            if (!startingUrls.length || saved >= MAX_PRODUCTS) return;

            const crawler = new CheerioCrawler({
                proxyConfiguration: proxyConf,
                maxRequestRetries: 3,
                useSessionPool: true,
                persistCookiesPerSession: true,
                maxConcurrency: 4, // Balanced: speed + stealth
                minConcurrency: 2,
                maxRequestsPerMinute: 60, // Faster scraping
                requestHandlerTimeoutSecs: 120,
                sessionPoolOptions: {
                    maxPoolSize: 20,
                    sessionOptions: {
                        maxUsageCount: 10, // More efficient
                        maxErrorScore: 3, // More tolerant
                    },
                    persistStateKeyValueStoreId: 'ikea-sessions',
                },
                preNavigationHooks: [
                    async (_, goToOptions) => {
                        const delay = 300 + Math.random() * 500; // Faster delays
                        await sleep(delay);
                        goToOptions.headers = {
                            ...defaultHeaders,
                            'sec-ch-ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
                            'sec-ch-ua-mobile': '?0',
                            'sec-ch-ua-platform': '"Windows"',
                        };
                    },
                ],
                async requestHandler({ request, $, enqueueLinks, log: crawlerLog }) {
                    const label = request.userData?.label || 'LIST';
                    const pageNo = request.userData?.pageNo || 1;

                    if (label === 'LIST') {
                        let productsFound = [];

                        const { products: jsonProducts } = await tryEmbeddedJson(request.url);
                        if (jsonProducts && jsonProducts.length > 0) {
                            for (const jsonProduct of jsonProducts) {
                                if (saved >= MAX_PRODUCTS) break;
                                const product = processJsonLdProduct(jsonProduct);
                                if (product) productsFound.push(product);
                            }
                        }

                        if (productsFound.length === 0 && $) {
                            productsFound = extractProductsFromHtml($);
                        }

                        for (const product of productsFound) {
                            if (saved >= MAX_PRODUCTS) break;

                            if (collectDetails && product.url) {
                                await enqueueLinks({
                                    urls: [product.url],
                                    userData: { label: 'DETAIL', baseData: product },
                                });
                            } else {
                                await Dataset.pushData({ ...product, category: category || null });
                                saved++;
                                crawlerLog.info(`Saved product ${saved}/${MAX_PRODUCTS}: ${product.name}`);
                            }
                        }

                        if (saved < MAX_PRODUCTS && pageNo < MAX_PAGES && productsFound.length > 0) {
                            const nextUrl = findNextPage($, request.url, pageNo);
                            if (nextUrl && nextUrl !== request.url) {
                                await enqueueLinks({
                                    urls: [nextUrl],
                                    userData: { label: 'LIST', pageNo: pageNo + 1 },
                                });
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
                            crawlerLog.info(`Saved detailed product ${saved}/${MAX_PRODUCTS}: ${finalProduct.name}`);
                        } catch (err) {
                            crawlerLog.error(`Failed to process detail page ${request.url}: ${err.message}`);
                        }
                    }
                },
                async failedRequestHandler({ request, session }, error) {
                    const errorMsg = error.message || '';
                    log.error(`Request ${request.url} failed: ${errorMsg.substring(0, 100)}`);
                    
                    // Retire session on specific errors
                    if (session && (errorMsg.includes('403') || errorMsg.includes('590') || errorMsg.includes('UPSTREAM'))) {
                        session.retire();
                        log.warning('Session retired - will retry with new session');
                    }
                    
                    // Don't crash on proxy errors
                    if (errorMsg.includes('590') || errorMsg.includes('UPSTREAM502')) {
                        log.warning('Proxy error - continuing with remaining requests');
                    }
                },
            });

            await crawler.run(startingUrls.map((url) => ({ url, userData: { label: 'LIST', pageNo: 1 } })));
        };

        const sikSearchConfig = resolveSikSearch();
        let apiCount = 0;

        if (sikSearchConfig) {
            apiCount = await fetchViaSik(sikSearchConfig);
        }

        if (collectDetails && detailRequests.length) {
            await runDetailCrawler();
        }

        const shouldRunHtml = startUrls.length > 0 || !sikSearchConfig || apiCount === 0;
        if (shouldRunHtml && saved < MAX_PRODUCTS) {
            await runHtmlCrawler(initial);
        }

        log.info(`Scraping completed! Saved ${saved} products from IKEA ${country.toUpperCase()}`);
        if (saved === 0) {
            log.warning('WARNING: No products were saved. Check logs for details.');
        }
    } catch (error) {
        log.error(`Fatal error in main: ${error.message}`);
        log.exception(error);
        throw error;
    } finally {
        await Actor.exit();
    }
}

main().catch((err) => {
    log.error(`Unhandled error: ${err.message}`);
    log.exception(err);
    process.exit(1);
});
