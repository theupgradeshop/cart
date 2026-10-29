import { useContext, useEffect, useState } from 'react';
import { CartProduct } from './types';
import { CartContext, CartConfigContext } from './cart-context';

interface CacheEntry {
  data: unknown[];
  timestamp: number;
  promise?: Promise<unknown[]>;
}

/**
 * Module-scoped cache — keyed by "apiBaseUrl::domain".
 * Survives React StrictMode double-mount and cart drawer open/close cycles.
 * In-flight deduplication prevents duplicate simultaneous requests.
 */
const productCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60_000;

interface SingleProductCacheEntry {
  data: unknown | null;
  timestamp: number;
  promise?: Promise<unknown | null>;
}

/**
 * Module-scoped cache for per-slug fallback fetches — keyed by
 * "apiBaseUrl::domain::slug". Separate from productCache (the catalog cache)
 * since these hit a different endpoint and cache a single product or null.
 */
const singleProductCache = new Map<string, SingleProductCacheEntry>();

async function fetchProductCatalog(apiBaseUrl: string, domain: string): Promise<unknown[]> {
  const cacheKey = `${apiBaseUrl}::${domain}`;
  const cached = productCache.get(cacheKey);
  const now = Date.now();

  if (cached && !cached.promise && now - cached.timestamp < CACHE_TTL_MS) {
    return cached.data;
  }

  // In-flight deduplication
  if (cached?.promise) {
    return cached.promise;
  }

  const promise = fetch(`${apiBaseUrl}/api/public/products?domain=${encodeURIComponent(domain)}`)
    .then(res => {
      if (!res.ok) throw new Error(`Products API ${res.status}`);
      return res.json();
    })
    .then((json: { products?: unknown[] }) => {
      const data = json.products ?? [];
      // Write data BEFORE .finally clears the promise
      productCache.set(cacheKey, { data, timestamp: Date.now() });
      return data;
    })
    .finally(() => {
      const entry = productCache.get(cacheKey);
      if (entry) productCache.set(cacheKey, { ...entry, promise: undefined });
    });

  productCache.set(cacheKey, {
    data: cached?.data ?? [],
    timestamp: cached?.timestamp ?? 0,
    promise,
  });

  return promise;
}

/**
 * Fallback lookup for a cart item's slug that isn't in the shop catalog
 * (`GET /api/public/products`) — most commonly a product with
 * `hide_from_shop: true`, which is deliberately excluded from that endpoint
 * (it means "off the shop grid", not "unpurchasable"). The single-product
 * endpoint has no such filter, so a slug missing from the catalog can still
 * be priced correctly by fetching it directly.
 *
 * Never throws — a failed or 404 lookup resolves to `null` so the caller can
 * degrade to the pre-existing "unavailable" cart-line behavior.
 */
async function fetchProductBySlug(
  apiBaseUrl: string,
  domain: string,
  slug: string
): Promise<unknown | null> {
  const cacheKey = `${apiBaseUrl}::${domain}::${slug}`;
  const cached = singleProductCache.get(cacheKey);
  const now = Date.now();

  if (cached && !cached.promise && now - cached.timestamp < CACHE_TTL_MS) {
    return cached.data;
  }

  if (cached?.promise) {
    return cached.promise;
  }

  const promise = fetch(
    `${apiBaseUrl}/api/public/products/${encodeURIComponent(slug)}?domain=${encodeURIComponent(domain)}`
  )
    .then(res => {
      if (!res.ok) return null;
      return res.json();
    })
    .then((json: { product?: unknown } | null) => {
      const data = json?.product ?? null;
      singleProductCache.set(cacheKey, { data, timestamp: Date.now() });
      return data;
    })
    .catch(() => {
      singleProductCache.set(cacheKey, { data: null, timestamp: Date.now() });
      return null;
    })
    .finally(() => {
      const entry = singleProductCache.get(cacheKey);
      if (entry) singleProductCache.set(cacheKey, { ...entry, promise: undefined });
    });

  singleProductCache.set(cacheKey, {
    data: cached?.data ?? null,
    timestamp: cached?.timestamp ?? 0,
    promise,
  });

  return promise;
}

export function useCartProducts(domain: string): {
  products: CartProduct[];
  isLoading: boolean;
  error: Error | null;
} {
  const cartCtx = useContext(CartContext);
  const config = useContext(CartConfigContext);

  if (!cartCtx) throw new Error('useCartProducts must be used inside <CartProvider>');

  const { items } = cartCtx;
  const { apiBaseUrl } = config;

  const [products, setProducts] = useState<CartProduct[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Stable dependency: sorted slug list — re-fetch only when cart item set changes
  const slugKey = items.map(i => `${i.slug}${i.variantId ?? ''}`).sort().join(',');

  useEffect(() => {
    let cancelled = false;

    if (items.length === 0) {
      setProducts([]);
      setError(null);
      return;
    }

    setIsLoading(true);

    fetchProductCatalog(apiBaseUrl, domain)
      .then(async allProducts => {
        if (cancelled) return;
        const liveMap = new Map(
          (allProducts as Array<{ slug: string }>).map(p => [p.slug, p])
        );

        // Fallback: any cart item slug missing from the shop catalog (e.g. a
        // `hide_from_shop` product, present but off the shop grid) is looked
        // up individually via the single-product endpoint, which has no such
        // filter.
        const missingSlugs = [...new Set(
          items.map(i => i.slug).filter(slug => !liveMap.has(slug))
        )];

        if (missingSlugs.length > 0) {
          const fallbackResults = await Promise.all(
            missingSlugs.map(slug => fetchProductBySlug(apiBaseUrl, domain, slug))
          );
          fallbackResults.forEach((product, i) => {
            if (product) liveMap.set(missingSlugs[i], product as { slug: string });
          });
        }

        if (cancelled) return;

        const merged: CartProduct[] = items.map(item => {
          const live = liveMap.get(item.slug) as Record<string, unknown> | undefined;

          if (!live) {
            return {
              slug: item.slug,
              name: item.slug,
              price: 0,
              salePrice: null,
              images: [],
              status: 'unavailable' as const,
              quantity: item.quantity,
              variantId: item.variantId,
            };
          }

          return {
            slug: live.slug as string,
            name: live.name as string,
            price: live.price as number,
            salePrice: (live.salePrice as number | null) ?? null,
            images: (live.images as CartProduct['images']) ?? [],
            status: 'active' as const,
            variants: live.variants as CartProduct['variants'],
            // The catalog list returns snake_case names, the single-product fallback camelCase; one shape out.
            product_type: ((live.product_type ?? live.productType) as string | null | undefined) ?? null,
            contains_physical_product: (live.contains_physical_product ?? live.containsPhysicalProduct) === true,
            quantity: item.quantity,
            variantId: item.variantId,
          };
        });

        setProducts(merged);
        setError(null);
      })
      .catch(err => {
        if (cancelled) return;
        setError(err instanceof Error ? err : new Error(String(err)));
        setProducts([]);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slugKey, apiBaseUrl, domain]);

  return { products, isLoading, error };
}
