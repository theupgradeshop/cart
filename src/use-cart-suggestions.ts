import { useContext, useEffect, useState, useCallback } from 'react';
import { CartSuggestion } from './types';
import { CartContext, CartConfigContext } from './cart-context';

interface CacheEntry {
  data: CartSuggestion[];
  timestamp: number;
  promise?: Promise<CartSuggestion[]>;
}

/**
 * Module-scoped cache — keyed by "apiBaseUrl::domain::slugKey".
 * Survives React StrictMode double-mount and cart drawer open/close cycles.
 * In-flight deduplication prevents duplicate simultaneous requests.
 */
const suggestionCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60_000;

async function fetchSuggestions(
  apiBaseUrl: string,
  domain: string,
  productSlugs: string[]
): Promise<CartSuggestion[]> {
  const slugParam = productSlugs.join(',');
  const cacheKey = `${apiBaseUrl}::${domain}::${slugParam}`;
  const cached = suggestionCache.get(cacheKey);
  const now = Date.now();

  if (cached && !cached.promise && now - cached.timestamp < CACHE_TTL_MS) {
    return cached.data;
  }

  // In-flight deduplication
  if (cached?.promise) {
    return cached.promise;
  }

  const promise = fetch(
    `${apiBaseUrl}/api/public/cart/suggestions?domain=${encodeURIComponent(domain)}&productSlugs=${encodeURIComponent(slugParam)}`
  )
    .then(res => {
      if (!res.ok) throw new Error(`Cart suggestions API ${res.status}`);
      return res.json();
    })
    .then((json: { suggestions?: CartSuggestion[] }) => {
      const data = json.suggestions ?? [];
      // Write data BEFORE .finally clears the promise
      suggestionCache.set(cacheKey, { data, timestamp: Date.now() });
      return data;
    })
    .finally(() => {
      const entry = suggestionCache.get(cacheKey);
      if (entry) suggestionCache.set(cacheKey, { ...entry, promise: undefined });
    });

  suggestionCache.set(cacheKey, {
    data: cached?.data ?? [],
    timestamp: cached?.timestamp ?? 0,
    promise,
  });

  return promise;
}

export function useCartSuggestions(domain: string): {
  suggestions: CartSuggestion[];
  isLoading: boolean;
  error: Error | null;
  applySuggestion: (s: CartSuggestion) => void;
} {
  const cartCtx = useContext(CartContext);
  const config = useContext(CartConfigContext);

  if (!cartCtx) throw new Error('useCartSuggestions must be used inside <CartProvider>');

  const { items, addItem, removeItem } = cartCtx;
  const { apiBaseUrl } = config;

  const [suggestions, setSuggestions] = useState<CartSuggestion[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Deduped, sorted slug list — re-fetch only when cart item set changes
  const productSlugs = Array.from(new Set(items.map(i => i.slug))).sort();
  const slugKey = productSlugs.join(',');

  useEffect(() => {
    let cancelled = false;

    if (productSlugs.length === 0) {
      setSuggestions([]);
      setError(null);
      return;
    }

    setIsLoading(true);

    fetchSuggestions(apiBaseUrl, domain, productSlugs)
      .then(data => {
        if (cancelled) return;
        setSuggestions(data);
        setError(null);
      })
      .catch(err => {
        if (cancelled) return;
        setError(err instanceof Error ? err : new Error(String(err)));
        setSuggestions([]);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slugKey, apiBaseUrl, domain]);

  const applySuggestion = useCallback((s: CartSuggestion) => {
    if (s.type === 'bundle_upgrade' && s.sourceProductSlug) {
      removeItem(s.sourceProductSlug);
    }
    addItem(s.product.slug);
  }, [addItem, removeItem]);

  return { suggestions, isLoading, error, applySuggestion };
}
