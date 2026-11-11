import { useContext, useEffect, useState } from 'react';
import { CartContext, CartConfigContext } from './cart-context';
import { itemKey } from './cart-reducer';
import { CartItemComposition } from './types';

/** Shape of a successful `POST /api/public/store/bundle-rules/price` response. */
export interface CartBundlePriceResult {
  totalMinor: number;
  discountMinor: number;
  appliedRuleId: string | null;
  appliedRuleName: string | null;
  basis: unknown;
  suppressionReason: string | null;
}

export type CartBundlePriceEntry =
  | { status: 'not-composed' }
  | { status: 'not-loaded' }
  | { status: 'priced'; result: CartBundlePriceResult };

interface CacheEntry {
  data?: CartBundlePriceResult;
  timestamp: number;
  promise?: Promise<CartBundlePriceResult>;
}

/**
 * Module-scoped cache — keyed by "apiBaseUrl::domain::bundleSlug::sortedIncludedItems".
 * Same shape as useCartPrerequisites / useCartSuggestions: survives StrictMode double-mount
 * and cart drawer open/close, in-flight requests are deduplicated, one TTL. `data` is
 * `undefined` until the first success — a failed attempt never populates it, so the entry's
 * `timestamp` stays 0 and the next call always looks stale and retries (deliberately never
 * caching a failure).
 */
const bundlePriceCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60_000;

// Content key for a composition — sorted so two compositions with the same items in a
// different order share a cache entry, and so two DIFFERENT compositions (different bundle,
// different items, or different quantities) never collide.
function compositionKey(bundleSlug: string, includedItems: CartItemComposition['includedItems']): string {
  const itemsPart = includedItems
    .map(i => `${i.slug}:${i.quantity}`)
    .sort()
    .join(',');
  return `${bundleSlug}::${itemsPart}`;
}

async function fetchBundlePrice(
  apiBaseUrl: string,
  domain: string,
  composition: CartItemComposition
): Promise<CartBundlePriceResult> {
  const cacheKey = `${apiBaseUrl}::${domain}::${compositionKey(composition.bundleSlug, composition.includedItems)}`;
  const cached = bundlePriceCache.get(cacheKey);
  const now = Date.now();

  if (cached?.data && !cached.promise && now - cached.timestamp < CACHE_TTL_MS) {
    return cached.data;
  }

  // In-flight deduplication
  if (cached?.promise) {
    return cached.promise;
  }

  const items = composition.includedItems.map(i => ({ productSlug: i.slug, quantity: i.quantity }));

  const promise = fetch(`${apiBaseUrl}/api/public/store/bundle-rules/price`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ domain, items }),
  })
    .then(res => {
      if (!res.ok) throw new Error(`Bundle price API ${res.status}`);
      return res.json();
    })
    .then((json: Partial<CartBundlePriceResult>) => {
      const data: CartBundlePriceResult = {
        totalMinor: json.totalMinor ?? 0,
        discountMinor: json.discountMinor ?? 0,
        appliedRuleId: json.appliedRuleId ?? null,
        appliedRuleName: json.appliedRuleName ?? null,
        basis: json.basis ?? null,
        suppressionReason: json.suppressionReason ?? null,
      };
      // Write data BEFORE .finally clears the promise
      bundlePriceCache.set(cacheKey, { data, timestamp: Date.now() });
      return data;
    })
    .finally(() => {
      const entry = bundlePriceCache.get(cacheKey);
      if (entry) bundlePriceCache.set(cacheKey, { ...entry, promise: undefined });
    });

  bundlePriceCache.set(cacheKey, {
    data: cached?.data,
    timestamp: cached?.timestamp ?? 0,
    promise,
  });

  return promise;
}

/**
 * Fetches a server-computed price for every cart line carrying a `composition` (an edited
 * bundle line — see `CartItemComposition` in `src/types.ts`), from
 * `POST /api/public/store/bundle-rules/price`.
 *
 * A cart with no composed line issues NO request at all — this is deliberate, not an
 * optimization: an account that never touches bundles must not acquire a network call on
 * every cart render. Read-only: never calls `addItem` or `removeItem`.
 *
 * `priceFor(slug, variantId?)` looks up a line's price by its cart identity (the same
 * `slug`+`variantId` key `cart-reducer.ts` uses):
 * - `{ status: 'not-composed' }` — the line has no `composition`, or doesn't exist.
 * - `{ status: 'not-loaded' }` — the request hasn't resolved yet (or the
 *   last attempt failed — fail-open, so a failure looks the same as "still pending" and never
 *   renders a stale or partial figure).
 * - `{ status: 'priced', result }` — a server-computed price is available.
 */
export function useCartBundlePrice(domain: string): {
  priceFor: (slug: string, variantId?: string) => CartBundlePriceEntry;
  isLoading: boolean;
  error: Error | null;
} {
  const cartCtx = useContext(CartContext);
  const config = useContext(CartConfigContext);

  if (!cartCtx) throw new Error('useCartBundlePrice must be used inside <CartProvider>');

  const { items } = cartCtx;
  const { apiBaseUrl } = config;

  // Every line carrying a composition is priced; each included item's quantity travels in
  // the request (`items: [{ productSlug, quantity }]`), and the server's evaluator multiplies it.
  const priceableLines = items.filter(i => i.composition);

  const [results, setResults] = useState<Map<string, CartBundlePriceResult>>(new Map());
  const [loadingKeys, setLoadingKeys] = useState<Set<string>>(new Set());
  const [error, setError] = useState<Error | null>(null);

  // Stable dependency: the distinct set of priceable composition contents in the cart —
  // re-fetch only when that set changes, not on every render.
  const compKey = priceableLines
    .map(i => compositionKey(i.composition!.bundleSlug, i.composition!.includedItems))
    .sort()
    .join('|');

  useEffect(() => {
    let cancelled = false;

    if (priceableLines.length === 0) {
      setLoadingKeys(new Set());
      return;
    }

    // De-dupe by CONTENT: two lines sharing identical composition content resolve from one
    // request, same convention as useCartPrerequisites's slug-set dedup.
    const byContent = new Map<string, CartItemComposition>();
    for (const item of priceableLines) {
      const key = compositionKey(item.composition!.bundleSlug, item.composition!.includedItems);
      if (!byContent.has(key)) byContent.set(key, item.composition!);
    }

    setLoadingKeys(new Set(byContent.keys()));

    for (const [key, composition] of byContent) {
      fetchBundlePrice(apiBaseUrl, domain, composition)
        .then(data => {
          if (cancelled) return;
          setResults(prev => {
            const next = new Map(prev);
            next.set(key, data);
            return next;
          });
          setError(null);
        })
        .catch(err => {
          if (cancelled) return;
          // Fail open, deliberately, same register as useCartPrerequisites: a non-ok
          // response, a throw, or an unparseable body must never block anything — it just
          // means no price is shown for this composition (see 'not-loaded' above).
          setError(err instanceof Error ? err : new Error(String(err)));
        })
        .finally(() => {
          if (cancelled) return;
          setLoadingKeys(prev => {
            const next = new Set(prev);
            next.delete(key);
            return next;
          });
        });
    }

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compKey, apiBaseUrl, domain]);

  const priceFor = (slug: string, variantId?: string): CartBundlePriceEntry => {
    const key = itemKey(slug, variantId);
    const line = items.find(i => itemKey(i.slug, i.variantId) === key);
    if (!line?.composition) return { status: 'not-composed' };
    const contentKey = compositionKey(line.composition.bundleSlug, line.composition.includedItems);
    const result = results.get(contentKey);
    if (result) return { status: 'priced', result };
    return { status: 'not-loaded' };
  };

  return { priceFor, isLoading: loadingKeys.size > 0, error };
}
