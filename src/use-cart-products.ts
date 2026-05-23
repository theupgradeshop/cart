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
    .then((json: { products?: unknown[] }) => json.products ?? [])
    .finally(() => {
      const entry = productCache.get(cacheKey);
      if (entry) productCache.set(cacheKey, { ...entry, promise: undefined });
    });

  productCache.set(cacheKey, {
    data: cached?.data ?? [],
    timestamp: cached?.timestamp ?? 0,
    promise,
  });

  const data = await promise;
  productCache.set(cacheKey, { data, timestamp: Date.now() });
  return data;
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
    if (items.length === 0) {
      setProducts([]);
      setError(null);
      return;
    }

    setIsLoading(true);

    fetchProductCatalog(apiBaseUrl, domain)
      .then(allProducts => {
        const liveMap = new Map(
          (allProducts as Array<{ slug: string }>).map(p => [p.slug, p])
        );

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
            quantity: item.quantity,
            variantId: item.variantId,
          };
        });

        setProducts(merged);
        setError(null);
      })
      .catch(err => {
        setError(err instanceof Error ? err : new Error(String(err)));
        setProducts([]);
      })
      .finally(() => setIsLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slugKey, apiBaseUrl, domain]);

  return { products, isLoading, error };
}
