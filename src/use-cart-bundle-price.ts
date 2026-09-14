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

// The evaluator this endpoint runs on (`src/lib/store/bundle-rule-evaluator.ts` in the
// dashboard) is quantity-blind: `ChosenItem` is `{ id, listPriceMinor, owned }` — the word
// `quantity` does not appear in that file, and the price route builds one `ChosenItem` per
// product row regardless of how many units a composition asks for. A `CartItemComposition`
// CAN carry an included item with `quantity > 1`. Sending such a composition to this
// endpoint prices it as though every item were a single unit — a total LOWER than what the
// buyer will actually be charged. This hook refuses to request or display a price for that
// composition until the evaluator is quantity-aware (tracked separately in
// cowork/backlog/commerce-payments.md). Do not remove this refusal without fixing the
// evaluator first.
const UNPRICEABLE_REASON =
  'The bundle-rules price evaluator has no quantity field (ChosenItem is { id, listPriceMinor, ' +
  'owned }) — every chosen item prices as a single unit. A composition with an included item ' +
  'quantity greater than 1 would silently under-price if requested as-is, so no price is ' +
  'requested or shown for it until the evaluator becomes quantity-aware.';

export type CartBundlePriceEntry =
  | { status: 'not-composed' }
  | { status: 'unpriceable'; reason: string }
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

function hasQuantityAboveOne(includedItems: CartItemComposition['includedItems']): boolean {
  return includedItems.some(i => i.quantity > 1);
}

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

  const productSlugs = composition.includedItems.map(i => i.slug);

  const promise = fetch(`${apiBaseUrl}/api/public/store/bundle-rules/price`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ domain, productSlugs }),
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
 * - `{ status: 'unpriceable', reason }` — the composition has an included item with
 *   `quantity > 1`; see the evaluator limitation above. No request was made for it.
 * - `{ status: 'not-loaded' }` — priceable, but the request hasn't resolved yet (or the
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

  // Only lines whose composition is priceable ever enter the fetch path — an item with
  // quantity > 1 anywhere in it is excluded here, before any request is built, per the
  // refusal above.
  const priceableLines = items.filter(
    i => i.composition && !hasQuantityAboveOne(i.composition.includedItems)
  );

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
    if (hasQuantityAboveOne(line.composition.includedItems)) {
      return { status: 'unpriceable', reason: UNPRICEABLE_REASON };
    }
    const contentKey = compositionKey(line.composition.bundleSlug, line.composition.includedItems);
    const result = results.get(contentKey);
    if (result) return { status: 'priced', result };
    return { status: 'not-loaded' };
  };

  return { priceFor, isLoading: loadingKeys.size > 0, error };
}
