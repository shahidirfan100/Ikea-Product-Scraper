import { Actor, log } from 'apify';
import { Dataset, sleep } from 'crawlee';
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

const SIK_VERSION = '20250507';
const DEFAULT_PAGE_SIZE = 48;
const MAX_API_WINDOW = 480;

const pickUserAgent = () => {
    const agents = [
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
    ];
    return agents[Math.floor(Math.random() * agents.length)];
};

const buildAcceptLanguage = (language, country) => {
    const normalizedLang = (language || 'en').toLowerCase();
    const countryCode = (country || 'gb').toUpperCase();
    return `${normalizedLang}-${countryCode},${normalizedLang};q=0.9,en;q=0.8`;
};

const toAbs = (href, country = 'gb', language = 'en') => {
    if (!href) return null;
    try {
        return new URL(href, `https://www.ikea.com/${country}/${language}/`).href;
    } catch {
        return null;
    }
};

const toNumberOrNull = (value) => (Number.isFinite(+value) ? +value : null);

const toTrimmedStringOrNull = (value) => {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed || null;
};

const normalizeCategoryPath = (pathArray) => {
    if (!Array.isArray(pathArray) || !pathArray.length) return [];
    return pathArray
        .map((entry) => ({
            key: toTrimmedStringOrNull(entry?.key),
            name: toTrimmedStringOrNull(entry?.name),
        }))
        .filter((entry) => entry.key || entry.name);
};

const compactValue = (value) => {
    if (value === null || value === undefined) return undefined;

    if (Array.isArray(value)) {
        const cleaned = value
            .map((item) => compactValue(item))
            .filter((item) => item !== undefined);
        return cleaned.length ? cleaned : undefined;
    }

    if (typeof value === 'object') {
        const entries = Object.entries(value)
            .map(([key, nested]) => [key, compactValue(nested)])
            .filter(([, nested]) => nested !== undefined);

        if (!entries.length) return undefined;
        return Object.fromEntries(entries);
    }

    if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed || undefined;
    }

    return value;
};

const compactObject = (value) => compactValue(value) || {};

const normalizeImages = (images) => {
    if (!Array.isArray(images) || !images.length) return [];
    const normalized = images
        .map((image) => ({
            url: toTrimmedStringOrNull(image?.url),
            alt: toTrimmedStringOrNull(image?.altText),
            type: toTrimmedStringOrNull(image?.type),
        }))
        .filter((image) => image.url);

    const seenUrl = new Set();
    const seenTypeAlt = new Set();
    const deduped = [];

    for (const image of normalized) {
        if (seenUrl.has(image.url)) continue;

        const typeAltKey = `${image.type || ''}|${image.alt || ''}`;
        if (image.type && image.alt && seenTypeAlt.has(typeAltKey)) continue;

        seenUrl.add(image.url);
        if (image.type && image.alt) seenTypeAlt.add(typeAltKey);
        deduped.push(image);
    }

    return deduped;
};

const normalizeVariants = (variants, { country, language }) => {
    if (!Array.isArray(variants) || !variants.length) return [];

    return variants
        .map((variant) => {
            const variantSalesPrice = variant.salesPrice || {};
            return compactObject({
                id: toTrimmedStringOrNull(variant.id),
                itemNo: toTrimmedStringOrNull(variant.itemNo),
                itemNoGlobal: toTrimmedStringOrNull(variant.itemNoGlobal),
                name: toTrimmedStringOrNull(variant.name),
                typeName: toTrimmedStringOrNull(variant.typeName),
                itemType: toTrimmedStringOrNull(variant.itemType),
                url: toAbs(variant.pipUrl, country, language),
                image: toTrimmedStringOrNull(variant.mainImageUrl) || toTrimmedStringOrNull(variant.imageUrl),
                imageAlt: toTrimmedStringOrNull(variant.mainImageAlt) || toTrimmedStringOrNull(variant.imageAlt),
                contextualImageUrl: toTrimmedStringOrNull(variant.contextualImageUrl),
                rating: toNumberOrNull(variant.ratingValue),
                reviewCount: toNumberOrNull(variant.ratingCount),
                onlineSellable: typeof variant.onlineSellable === 'boolean' ? variant.onlineSellable : undefined,
                lastChance: typeof variant.lastChance === 'boolean' ? variant.lastChance : undefined,
                price: toNumberOrNull(variantSalesPrice.numeral),
                currency: toTrimmedStringOrNull(variantSalesPrice.currencyCode),
                priceText: toTrimmedStringOrNull(variantSalesPrice.priceText),
                validDesignText: toTrimmedStringOrNull(variant.validDesignText),
                images: normalizeImages(variant.allProductImage),
            });
        })
        .filter((variant) => Object.keys(variant).length > 0);
};

const normalizeVariations = (variations) => {
    if (!Array.isArray(variations) || !variations.length) return [];

    return variations
        .map((variation) => compactObject({
            id: toTrimmedStringOrNull(variation.id),
            name: toTrimmedStringOrNull(variation.name),
            count: toNumberOrNull(variation.count),
            values: Array.isArray(variation.values)
                ? variation.values
                    .map((value) => compactObject({
                        name: toTrimmedStringOrNull(value.name),
                        products: Array.isArray(value.products)
                            ? [...new Set(value.products.map((productId) => toTrimmedStringOrNull(productId)).filter(Boolean))]
                            : [],
                    }))
                    .filter((value) => Object.keys(value).length > 0)
                : [],
        }))
        .filter((variation) => Object.keys(variation).length > 0);
};

const fetchWithRetry = async (options, { attempts = 3, label = 'request', proxyConf } = {}) => {
    let lastError;

    for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
            const finalOptions = { ...options };
            if (proxyConf) finalOptions.proxyUrl = await proxyConf.newUrl();
            return await gotScraping(finalOptions);
        } catch (error) {
            lastError = error;
            const status = error.response?.statusCode;
            const retriable = [429, 500, 502, 503, 504, 590].includes(status);
            log.warning(`Attempt ${attempt}/${attempts} failed for ${label}: ${status || error.code || error.message}`);
            if (attempt === attempts || !retriable) break;
            await sleep(500 * attempt + Math.random() * 700);
        }
    }

    throw lastError;
};

const mapProduct = (product, { country, language, mode, input }) => {
    const productId = String(product.itemNo || product.itemNoGlobal || product.id || product.productNumber || '').trim();
    if (!productId) return null;

    const nameParts = [product.name, product.typeName].filter(Boolean);
    const name = nameParts.length ? nameParts.join(' ').trim() : product.name || product.productName || null;

    const images = normalizeImages(product.allProductImage);

    const image = product.mainImageUrl
        || images[0]?.url
        || null;

    const availability = Array.isArray(product.availability) && product.availability.length
        ? product.availability.join(', ')
        : product.buyable ? 'Buyable' : 'Check availability';

    const categoryPath = normalizeCategoryPath(product.categoryPath);
    const salesPrice = product.salesPrice || {};
    const discount = salesPrice.discount || {};
    const businessStructure = product.businessStructure || {};
    const gprDescription = product.gprDescription || {};
    const quickFacts = Array.isArray(product.quickFacts)
        ? [...new Set(product.quickFacts.map((fact) => toTrimmedStringOrNull(fact)).filter(Boolean))]
        : [];
    const colors = Array.isArray(product.colors)
        ? [...new Map(
            product.colors
                .map((color) => ({
                    key: toTrimmedStringOrNull(color?.key),
                    name: toTrimmedStringOrNull(color?.name),
                }))
                .filter((color) => color.key || color.name)
                .map((color) => [`${color.key || ''}|${color.name || ''}`, color]),
        ).values()]
        : [];
    const normalizedVariants = normalizeVariants(gprDescription.variants, { country, language });
    const normalizedVariations = normalizeVariations(gprDescription.variations);

    return compactObject({
        productId,
        globalProductId: toTrimmedStringOrNull(product.itemNoGlobal),
        internalId: toTrimmedStringOrNull(product.id),
        name,
        typeName: toTrimmedStringOrNull(product.typeName),
        itemType: toTrimmedStringOrNull(product.itemType),
        filterClass: toTrimmedStringOrNull(product.filterClass),
        price: toNumberOrNull(salesPrice.numeral ?? product.priceNumeral),
        currency: toTrimmedStringOrNull(salesPrice.currencyCode || product.currencyCode),
        priceText: toTrimmedStringOrNull(salesPrice.priceText),
        hasDiscount: !!salesPrice.discount,
        discountTag: toTrimmedStringOrNull(discount.tag),
        discountTagText: toTrimmedStringOrNull(discount.tagText),
        isBreathTakingPrice: !!salesPrice.isBreathTaking,
        image,
        mainImageAlt: toTrimmedStringOrNull(product.mainImageAlt),
        images,
        contextualImageUrl: toTrimmedStringOrNull(product.contextualImageUrl),
        contextualImageAlt: toTrimmedStringOrNull(product.contextualImageAlt),
        url: toAbs(product.pipUrl, country, language),
        rating: toNumberOrNull(product.ratingValue ?? product.averageRating),
        reviewCount: toNumberOrNull(product.ratingCount ?? product.numberOfReviews),
        availability,
        onlineSellable: !!product.onlineSellable,
        lastChance: !!product.lastChance,
        tag: toTrimmedStringOrNull(product.tag),
        tagText: toTrimmedStringOrNull(product.tagText),
        validDesignText: toTrimmedStringOrNull(product.validDesignText),
        itemMeasureReferenceText: toTrimmedStringOrNull(product.itemMeasureReferenceText),
        quickFacts,
        colors,
        categoryPath,
        categoryPathText: categoryPath.map((entry) => entry.name).filter(Boolean).join(' > ') || null,
        badge: toTrimmedStringOrNull(product.badge),
        variantsCount: toNumberOrNull(gprDescription.numberOfVariants) ?? normalizedVariants.length,
        variants: normalizedVariants,
        variations: normalizedVariations,
        homeFurnishingBusinessNo: toTrimmedStringOrNull(businessStructure.homeFurnishingBusinessNo),
        homeFurnishingBusinessName: toTrimmedStringOrNull(businessStructure.homeFurnishingBusinessName),
        productAreaNo: toTrimmedStringOrNull(businessStructure.productAreaNo),
        productAreaName: toTrimmedStringOrNull(businessStructure.productAreaName),
        productRangeAreaNo: toTrimmedStringOrNull(businessStructure.productRangeAreaNo),
        productRangeAreaName: toTrimmedStringOrNull(businessStructure.productRangeAreaName),
        productType: toTrimmedStringOrNull(product.optimizelyAttributes?.PRODUCT_TYPE),
        categoryOrQuery: input,
        sourceType: mode,
        scrapedAt: new Date().toISOString(),
    });
};

const buildSearchConfig = ({ startUrls, category, country, language }) => {
    const firstRaw = startUrls?.[0];
    const firstUrl = typeof firstRaw === 'string' ? firstRaw : firstRaw?.url;

    if (firstUrl) {
        try {
            const parsed = new URL(firstUrl);
            const parts = parsed.pathname.split('/').filter(Boolean);
            const q = parsed.searchParams.get('q')?.trim();

            if (parts.includes('search') && q) {
                return {
                    mode: 'QUERY',
                    input: q,
                    clientId: 'sr',
                    referer: firstUrl,
                };
            }

            if (parts.includes('new')) {
                const last = parts[parts.length - 1];
                const special = SPECIAL_CATEGORY_MAP[last] || SPECIAL_CATEGORY_MAP[category];
                if (special) {
                    return {
                        mode: 'SPECIAL',
                        input: special,
                        clientId: 'listaf',
                        referer: firstUrl,
                    };
                }
            }

            if (parts.includes('cat')) {
                const last = parts[parts.length - 1];
                if (last) {
                    return {
                        mode: 'CATEGORY',
                        input: last,
                        clientId: 'listaf',
                        referer: firstUrl,
                    };
                }
            }
        } catch (error) {
            log.warning(`Failed to parse start URL: ${error.message}`);
        }
    }

    if (category && SPECIAL_CATEGORY_MAP[category]) {
        return {
            mode: 'SPECIAL',
            input: SPECIAL_CATEGORY_MAP[category],
            clientId: 'listaf',
            referer: `https://www.ikea.com/${country}/${language}/new/${category}/`,
        };
    }

    if (category) {
        return {
            mode: 'QUERY',
            input: category,
            clientId: 'sr',
            referer: `https://www.ikea.com/${country}/${language}/search/?q=${encodeURIComponent(category)}`,
        };
    }

    return {
        mode: 'SPECIAL',
        input: SPECIAL_CATEGORY_MAP['new-products'],
        clientId: 'listaf',
        referer: `https://www.ikea.com/${country}/${language}/new/new-products/`,
    };
};

const runApiOnlyScrape = async ({
    country,
    language,
    maxProducts,
    maxPages,
    proxyConf,
    searchConfig,
}) => {
    const host = `https://sik.search.blue.cdtapps.com/${country}/${language}/search`;
    const apiUrl = `${host}?c=${encodeURIComponent(searchConfig.clientId)}&v=${SIK_VERSION}`;
    const userAgent = pickUserAgent();

    const headers = {
        Accept: 'application/json, text/plain, */*',
        'Accept-Encoding': 'gzip, deflate, br',
        'Accept-Language': buildAcceptLanguage(language, country),
        'Content-Type': 'application/json',
        Origin: 'https://www.ikea.com',
        Referer: searchConfig.referer,
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'cross-site',
        'User-Agent': userAgent,
    };

    const seenProductIds = new Set();
    let saved = 0;
    let page = 0;
    let offset = 0;
    let totalProducts = Number.MAX_SAFE_INTEGER;

    while (saved < maxProducts && page < maxPages && offset < totalProducts) {
        const size = Math.min(DEFAULT_PAGE_SIZE, maxProducts - saved, MAX_API_WINDOW);

        const payload = {
            searchParameters: {
                input: searchConfig.input,
                type: searchConfig.mode,
            },
            components: [
                {
                    component: 'PRIMARY_AREA',
                    types: { main: 'PRODUCT', breakouts: [] },
                    filterConfig: {},
                    window: { size, offset },
                    columns: 4,
                },
            ],
        };

        const response = await fetchWithRetry(
            {
                url: apiUrl,
                method: 'POST',
                headers,
                responseType: 'json',
                json: payload,
                timeout: { request: 45000 },
                retry: { limit: 0 },
                throwHttpErrors: true,
            },
            { attempts: 3, label: `SIK API page ${page + 1}`, proxyConf },
        );

        const primary = response.body?.results?.find((result) => result?.component === 'PRIMARY_AREA');
        const productItems = primary?.items?.filter((item) => item?.type === 'PRODUCT' && item?.product) || [];
        totalProducts = primary?.metadata?.itemsPerType?.PRODUCT
            ?? primary?.metadata?.max
            ?? totalProducts;

        if (!productItems.length) {
            log.warning(`No products returned at offset ${offset}; ending pagination.`);
            break;
        }

        for (const item of productItems) {
            if (saved >= maxProducts) break;
            const mapped = mapProduct(item.product, {
                country,
                language,
                mode: searchConfig.mode,
                input: searchConfig.input,
            });
            if (!mapped) continue;
            if (seenProductIds.has(mapped.productId)) continue;

            seenProductIds.add(mapped.productId);
            await Dataset.pushData(mapped);
            saved++;
        }

        page++;
        offset += productItems.length;

        log.info('Fetched API page', {
            page,
            fetched: productItems.length,
            offset,
            totalProducts,
            saved,
            maxProducts,
        });

        if (productItems.length < size) {
            log.info('Reached end of available API items for current query/category.');
            break;
        }
    }

    return { saved, page, mode: searchConfig.mode, input: searchConfig.input, apiUrl };
};

await Actor.init();

try {
    const input = (await Actor.getInput()) || {};
    const {
        startUrls = [],
        country = 'gb',
        language = 'en',
        category = 'new-products',
        maxProducts = 20,
        maxPages = 2,
        proxyConfiguration,
    } = input;

    const normalizedMaxProducts = Number.isFinite(+maxProducts) && +maxProducts > 0
        ? Math.max(1, +maxProducts)
        : Number.MAX_SAFE_INTEGER;
    const normalizedMaxPages = Number.isFinite(+maxPages) && +maxPages > 0
        ? Math.max(1, +maxPages)
        : 1;

    const proxyConf = proxyConfiguration
        ? await Actor.createProxyConfiguration({ ...proxyConfiguration })
        : undefined;

    const searchConfig = buildSearchConfig({
        startUrls,
        category,
        country,
        language,
    });

    log.info('Starting IKEA API-first scraper', {
        country,
        language,
        mode: searchConfig.mode,
        input: searchConfig.input,
        maxProducts: normalizedMaxProducts,
        maxPages: normalizedMaxPages,
    });

    const result = await runApiOnlyScrape({
        country,
        language,
        maxProducts: normalizedMaxProducts,
        maxPages: normalizedMaxPages,
        proxyConf,
        searchConfig,
    });

    log.info('Scraping finished', result);

    if (result.saved === 0) {
        log.warning('No products saved. Try different query/category or country/language settings.');
    }
} catch (error) {
    log.error(`Fatal error: ${error.message}`);
    log.exception(error);
    throw error;
} finally {
    await Actor.exit();
}
