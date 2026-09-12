import { useContext, useEffect, useRef, useState } from 'react';
import { CartContext, CartConfigContext } from './cart-context';

export interface PrerequisiteProduct {
  id: string;
  name: string;
  slug: string;
  price: number;
  images: unknown;
}

export interface MissingPrerequisite {
  product: PrerequisiteProduct;
  prerequisite: PrerequisiteProduct;
}

interface CacheEntry {
  data: MissingPrerequisite[];
  timestamp: number;
  promise?: Promise<MissingPrerequisite[]>;
}

/**
 * Module-scoped cache — keyed by "apiBaseUrl::domain::slugKey::buyerEmail".
 * Survives React StrictMode double-mount and cart drawer open/close cycles.
 * In-flight deduplication prevents duplicate simultaneous requests.
 * Same shape as useCartProducts / useCartSuggestions.
 */
const prerequisiteCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60_000;

async function fetchPrerequisites(
  apiBaseUrl: string,
  domain: string,
  productSlugs: string[],
  buyerEmail?: string
): Promise<MissingPrerequisite[]> {
  const slugParam = productSlugs.join(',');
  const cacheKey = `${apiBaseUrl}::${domain}::${slugParam}::${buyerEmail ?? ''}`;
  const cached = prerequisiteCache.get(cacheKey);
  const now = Date.now();

  if (cached && !cached.promise && now - cached.timestamp < CACHE_TTL_MS) {
    return cached.data;
  }

  // In-flight deduplication
  if (cached?.promise) {
    return cached.promise;
  }

  const promise = fetch(`${apiBaseUrl}/api/public/cart/prerequisites`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      domain,
      productSlugs,
      ...(buyerEmail ? { buyerEmail } : {}),
    }),
  })
    .then(res => {
      if (!res.ok) throw new Error(`Cart prerequisites API ${res.status}`);
      return res.json();
    })
    .then((json: { missing?: MissingPrerequisite[] }) => {
      const data = json.missing ?? [];
      // Write data BEFORE .finally clears the promise
      prerequisiteCache.set(cacheKey, { data, timestamp: Date.now() });
      return data;
    })
    .finally(() => {
      const entry = prerequisiteCache.get(cacheKey);
      if (entry) prerequisiteCache.set(cacheKey, { ...entry, promise: undefined });
    });

  prerequisiteCache.set(cacheKey, {
    data: cached?.data ?? [],
    timestamp: cached?.timestamp ?? 0,
    promise,
  });

  return promise;
}

export function useCartPrerequisites(
  domain: string,
  buyerEmail?: string
): {
  missing: MissingPrerequisite[];
  autoAdded: MissingPrerequisite[];
  isLoading: boolean;
  error: Error | null;
} {
  const cartCtx = useContext(CartContext);
  const config = useContext(CartConfigContext);

  if (!cartCtx) throw new Error('useCartPrerequisites must be used inside <CartProvider>');

  const { items, addItem } = cartCtx;
  const { apiBaseUrl } = config;

  const [missing, setMissing] = useState<MissingPrerequisite[]>([]);
  const [autoAdded, setAutoAdded] = useState<MissingPrerequisite[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // ── The loop guard ────────────────────────────────────────────────────
  // Auto-adding a prerequisite changes `items`, which is exactly the input
  // this hook re-fetches on — the add can re-trigger the effect that
  // performed it. This ref tracks every prerequisite slug already added
  // during THIS mounted instance, so a given slug is never auto-added
  // twice no matter how many times it keeps showing up in `missing`.
  // Deliberately NOT relying on the server stopping reporting it as missing
  // after the add (a correctness argument about the endpoint, not a local
  // guarantee) — this must hold even against a server that keeps answering
  // the same "missing" payload regardless of cart contents. A ref (not
  // state) so checking it never itself triggers a re-render/re-fetch.
  const autoAddedSlugsRef = useRef<Set<string>>(new Set());

  // Stable dependency: sorted unique slug list — re-fetch only when the set
  // of distinct slugs in the cart changes, not on every quantity change.
  const productSlugs = Array.from(new Set(items.map(i => i.slug))).sort();
  const slugKey = productSlugs.join(',');

  useEffect(() => {
    let cancelled = false;

    if (productSlugs.length === 0) {
      setMissing([]);
      setAutoAdded([]);
      setError(null);
      return;
    }

    setIsLoading(true);

    fetchPrerequisites(apiBaseUrl, domain, productSlugs, buyerEmail)
      .then(data => {
        if (cancelled) return;
        setMissing(data);
        setError(null);

        const toAdd = data.filter(
          entry => !autoAddedSlugsRef.current.has(entry.prerequisite.slug)
        );
        if (toAdd.length > 0) {
          toAdd.forEach(entry => {
            autoAddedSlugsRef.current.add(entry.prerequisite.slug);
            addItem(entry.prerequisite.slug, 1);
          });
          setAutoAdded(prev => [...prev, ...toAdd]);
        }
      })
      .catch(err => {
        if (cancelled) return;
        // Fail open, deliberately: the platform's own checkout performs the
        // authoritative check (POST /api/public/checkout's capability
        // gate), so failing open here risks at worst the rejection the
        // buyer would have gotten anyway. Failing closed would put a hard
        // blocker in front of a purchase, which the owning spec forbids
        // outright — see wiki/cross-cutting/customer-site-parent-addon-gate.md.
        setError(err instanceof Error ? err : new Error(String(err)));
        setMissing([]);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slugKey, apiBaseUrl, domain, buyerEmail]);

  return { missing, autoAdded, isLoading, error };
}
