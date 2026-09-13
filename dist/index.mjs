'use client';

// src/cart-context.tsx
import {
  createContext,
  useContext,
  useReducer,
  useEffect,
  useState,
  useCallback
} from "react";

// src/cart-reducer.ts
function itemKey(slug, variantId) {
  return variantId ? `${slug}::${variantId}` : slug;
}
var initialCartState = { items: [], isOpen: false };
function cartReducer(state, action) {
  switch (action.type) {
    case "ADD_ITEM": {
      const key = itemKey(action.slug, action.variantId);
      const existing = state.items.find((i) => itemKey(i.slug, i.variantId) === key);
      if (existing) {
        return {
          ...state,
          items: state.items.map(
            (i) => itemKey(i.slug, i.variantId) === key ? { ...i, quantity: i.quantity + action.quantity } : i
          )
        };
      }
      return {
        ...state,
        items: [
          ...state.items,
          { slug: action.slug, quantity: action.quantity, ...action.variantId ? { variantId: action.variantId } : {} }
        ]
      };
    }
    case "REMOVE_ITEM": {
      const key = itemKey(action.slug, action.variantId);
      return { ...state, items: state.items.filter((i) => itemKey(i.slug, i.variantId) !== key) };
    }
    case "UPDATE_QUANTITY": {
      const key = itemKey(action.slug, action.variantId);
      if (action.quantity <= 0) {
        return { ...state, items: state.items.filter((i) => itemKey(i.slug, i.variantId) !== key) };
      }
      return {
        ...state,
        items: state.items.map(
          (i) => itemKey(i.slug, i.variantId) === key ? { ...i, quantity: action.quantity } : i
        )
      };
    }
    case "CLEAR_CART":
      return { ...state, items: [] };
    case "OPEN_CART":
      return { ...state, isOpen: true };
    case "CLOSE_CART":
      return { ...state, isOpen: false };
    case "TOGGLE_CART":
      return { ...state, isOpen: !state.isOpen };
    case "LOAD_ITEMS":
      return { ...state, items: action.items };
    default:
      return state;
  }
}

// src/migrate-storage.ts
function migrateCartStorage(raw) {
  if (!raw) return [];
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return [];
  const first = parsed[0];
  if (first.product && typeof first.product.slug === "string") {
    return parsed.filter((item) => {
      const product = item.product;
      return typeof product?.slug === "string" && typeof item.quantity === "number" && item.quantity > 0;
    }).map((item) => {
      const product = item.product;
      const result = {
        slug: product.slug,
        quantity: item.quantity
      };
      if (typeof product.variantId === "string") result.variantId = product.variantId;
      return result;
    });
  }
  if (typeof first.slug === "string" && typeof first.price === "number") {
    return parsed.filter((item) => typeof item.slug === "string" && typeof item.quantity === "number" && item.quantity > 0).map((item) => ({ slug: item.slug, quantity: item.quantity }));
  }
  if (typeof first.slug === "string" && typeof first.quantity === "number") {
    return parsed.filter((item) => typeof item.slug === "string" && typeof item.quantity === "number" && item.quantity > 0).map((item) => {
      const result = { slug: item.slug, quantity: item.quantity };
      if (typeof item.variantId === "string") result.variantId = item.variantId;
      return result;
    });
  }
  return [];
}

// src/cart-context.tsx
import { jsx } from "react/jsx-runtime";
var CartConfigContext = createContext({
  apiBaseUrl: "https://app.upgradeshop.ai"
});
var CartContext = createContext(null);
function CartProvider({
  children,
  storageKey,
  apiBaseUrl = "https://app.upgradeshop.ai"
}) {
  const [state, dispatch] = useReducer(cartReducer, initialCartState);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      const items = migrateCartStorage(raw);
      if (items.length > 0) {
        dispatch({ type: "LOAD_ITEMS", items });
        localStorage.setItem(storageKey, JSON.stringify(items));
      }
    } catch {
    }
    setHydrated(true);
  }, [storageKey]);
  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(state.items));
    } catch {
    }
  }, [state.items, hydrated, storageKey]);
  const addItem = useCallback((slug, quantity = 1, variantId) => {
    dispatch({ type: "ADD_ITEM", slug, quantity, variantId });
  }, []);
  const removeItem = useCallback((slug, variantId) => {
    dispatch({ type: "REMOVE_ITEM", slug, variantId });
  }, []);
  const updateQuantity = useCallback((slug, quantity, variantId) => {
    dispatch({ type: "UPDATE_QUANTITY", slug, quantity, variantId });
  }, []);
  const clearCart = useCallback(() => {
    dispatch({ type: "CLEAR_CART" });
    try {
      localStorage.removeItem(storageKey);
    } catch {
    }
  }, [storageKey]);
  const openCart = useCallback(() => dispatch({ type: "OPEN_CART" }), []);
  const closeCart = useCallback(() => dispatch({ type: "CLOSE_CART" }), []);
  const toggleCart = useCallback(() => dispatch({ type: "TOGGLE_CART" }), []);
  const itemCount = state.items.reduce((sum, i) => sum + i.quantity, 0);
  const value = {
    items: state.items,
    isOpen: state.isOpen,
    itemCount,
    addItem,
    removeItem,
    updateQuantity,
    clearCart,
    openCart,
    closeCart,
    toggleCart
  };
  return /* @__PURE__ */ jsx(CartConfigContext.Provider, { value: { apiBaseUrl }, children: /* @__PURE__ */ jsx(CartContext.Provider, { value, children }) });
}
function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used inside <CartProvider>");
  return ctx;
}

// src/use-cart-products.ts
import { useContext as useContext2, useEffect as useEffect2, useState as useState2 } from "react";
var productCache = /* @__PURE__ */ new Map();
var CACHE_TTL_MS = 6e4;
async function fetchProductCatalog(apiBaseUrl, domain) {
  const cacheKey = `${apiBaseUrl}::${domain}`;
  const cached = productCache.get(cacheKey);
  const now = Date.now();
  if (cached && !cached.promise && now - cached.timestamp < CACHE_TTL_MS) {
    return cached.data;
  }
  if (cached?.promise) {
    return cached.promise;
  }
  const promise = fetch(`${apiBaseUrl}/api/public/products?domain=${encodeURIComponent(domain)}`).then((res) => {
    if (!res.ok) throw new Error(`Products API ${res.status}`);
    return res.json();
  }).then((json) => {
    const data = json.products ?? [];
    productCache.set(cacheKey, { data, timestamp: Date.now() });
    return data;
  }).finally(() => {
    const entry = productCache.get(cacheKey);
    if (entry) productCache.set(cacheKey, { ...entry, promise: void 0 });
  });
  productCache.set(cacheKey, {
    data: cached?.data ?? [],
    timestamp: cached?.timestamp ?? 0,
    promise
  });
  return promise;
}
function useCartProducts(domain) {
  const cartCtx = useContext2(CartContext);
  const config = useContext2(CartConfigContext);
  if (!cartCtx) throw new Error("useCartProducts must be used inside <CartProvider>");
  const { items } = cartCtx;
  const { apiBaseUrl } = config;
  const [products, setProducts] = useState2([]);
  const [isLoading, setIsLoading] = useState2(false);
  const [error, setError] = useState2(null);
  const slugKey = items.map((i) => `${i.slug}${i.variantId ?? ""}`).sort().join(",");
  useEffect2(() => {
    let cancelled = false;
    if (items.length === 0) {
      setProducts([]);
      setError(null);
      return;
    }
    setIsLoading(true);
    fetchProductCatalog(apiBaseUrl, domain).then((allProducts) => {
      if (cancelled) return;
      const liveMap = new Map(
        allProducts.map((p) => [p.slug, p])
      );
      const merged = items.map((item) => {
        const live = liveMap.get(item.slug);
        if (!live) {
          return {
            slug: item.slug,
            name: item.slug,
            price: 0,
            salePrice: null,
            images: [],
            status: "unavailable",
            quantity: item.quantity,
            variantId: item.variantId
          };
        }
        return {
          slug: live.slug,
          name: live.name,
          price: live.price,
          salePrice: live.salePrice ?? null,
          images: live.images ?? [],
          status: "active",
          variants: live.variants,
          quantity: item.quantity,
          variantId: item.variantId
        };
      });
      setProducts(merged);
      setError(null);
    }).catch((err) => {
      if (cancelled) return;
      setError(err instanceof Error ? err : new Error(String(err)));
      setProducts([]);
    }).finally(() => {
      if (!cancelled) setIsLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [slugKey, apiBaseUrl, domain]);
  return { products, isLoading, error };
}

// src/use-cart-suggestions.ts
import { useContext as useContext3, useEffect as useEffect3, useState as useState3, useCallback as useCallback2 } from "react";
var suggestionCache = /* @__PURE__ */ new Map();
var CACHE_TTL_MS2 = 6e4;
async function fetchSuggestions(apiBaseUrl, domain, productSlugs) {
  const slugParam = productSlugs.join(",");
  const cacheKey = `${apiBaseUrl}::${domain}::${slugParam}`;
  const cached = suggestionCache.get(cacheKey);
  const now = Date.now();
  if (cached && !cached.promise && now - cached.timestamp < CACHE_TTL_MS2) {
    return { style: cached.style, suggestions: cached.data };
  }
  if (cached?.promise) {
    return cached.promise;
  }
  const promise = fetch(
    `${apiBaseUrl}/api/public/cart/suggestions?domain=${encodeURIComponent(domain)}&productSlugs=${encodeURIComponent(slugParam)}`
  ).then((res) => {
    if (!res.ok) throw new Error(`Cart suggestions API ${res.status}`);
    return res.json();
  }).then((json) => {
    const style = json.style ?? "sidebar";
    const suggestions = json.suggestions ?? [];
    suggestionCache.set(cacheKey, { style, data: suggestions, timestamp: Date.now() });
    return { style, suggestions };
  }).finally(() => {
    const entry = suggestionCache.get(cacheKey);
    if (entry) suggestionCache.set(cacheKey, { ...entry, promise: void 0 });
  });
  suggestionCache.set(cacheKey, {
    style: cached?.style ?? "sidebar",
    data: cached?.data ?? [],
    timestamp: cached?.timestamp ?? 0,
    promise
  });
  return promise;
}
function useCartSuggestions(domain) {
  const cartCtx = useContext3(CartContext);
  const config = useContext3(CartConfigContext);
  if (!cartCtx) throw new Error("useCartSuggestions must be used inside <CartProvider>");
  const { items, addItem, removeItem } = cartCtx;
  const { apiBaseUrl } = config;
  const [suggestions, setSuggestions] = useState3([]);
  const [suggestionsStyle, setSuggestionsStyle] = useState3("sidebar");
  const [isLoading, setIsLoading] = useState3(false);
  const [error, setError] = useState3(null);
  const productSlugs = Array.from(new Set(items.map((i) => i.slug))).sort();
  const slugKey = productSlugs.join(",");
  useEffect3(() => {
    let cancelled = false;
    if (productSlugs.length === 0) {
      setSuggestions([]);
      setSuggestionsStyle("sidebar");
      setError(null);
      return;
    }
    setIsLoading(true);
    fetchSuggestions(apiBaseUrl, domain, productSlugs).then(({ style, suggestions: data }) => {
      if (cancelled) return;
      setSuggestions(data);
      setSuggestionsStyle(style);
      setError(null);
    }).catch((err) => {
      if (cancelled) return;
      setError(err instanceof Error ? err : new Error(String(err)));
      setSuggestions([]);
    }).finally(() => {
      if (!cancelled) setIsLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [slugKey, apiBaseUrl, domain]);
  const applySuggestion = useCallback2((s) => {
    if (s.type === "bundle_upgrade") {
      const toRemove = s.bundleItemSlugs?.length ? s.bundleItemSlugs : s.sourceProductSlug ? [s.sourceProductSlug] : [];
      toRemove.forEach((slug) => removeItem(slug));
    }
    addItem(s.product.slug);
  }, [addItem, removeItem]);
  return { suggestions, suggestionsStyle, isLoading, error, applySuggestion };
}

// src/use-cart-prerequisites.ts
import { useContext as useContext4, useEffect as useEffect4, useRef, useState as useState4 } from "react";
var prerequisiteCache = /* @__PURE__ */ new Map();
var CACHE_TTL_MS3 = 6e4;
async function fetchPrerequisites(apiBaseUrl, domain, productSlugs, buyerEmail) {
  const slugParam = productSlugs.join(",");
  const cacheKey = `${apiBaseUrl}::${domain}::${slugParam}::${buyerEmail ?? ""}`;
  const cached = prerequisiteCache.get(cacheKey);
  const now = Date.now();
  if (cached && !cached.promise && now - cached.timestamp < CACHE_TTL_MS3) {
    return cached.data;
  }
  if (cached?.promise) {
    return cached.promise;
  }
  const promise = fetch(`${apiBaseUrl}/api/public/cart/prerequisites`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      domain,
      productSlugs,
      ...buyerEmail ? { buyerEmail } : {}
    })
  }).then((res) => {
    if (!res.ok) throw new Error(`Cart prerequisites API ${res.status}`);
    return res.json();
  }).then((json) => {
    const data = {
      missing: json.missing ?? [],
      dependencies: json.dependencies ?? []
    };
    prerequisiteCache.set(cacheKey, { data, timestamp: Date.now() });
    return data;
  }).finally(() => {
    const entry = prerequisiteCache.get(cacheKey);
    if (entry) prerequisiteCache.set(cacheKey, { ...entry, promise: void 0 });
  });
  prerequisiteCache.set(cacheKey, {
    data: cached?.data ?? { missing: [], dependencies: [] },
    timestamp: cached?.timestamp ?? 0,
    promise
  });
  return promise;
}
function useCartPrerequisites(domain, buyerEmail) {
  const cartCtx = useContext4(CartContext);
  const config = useContext4(CartConfigContext);
  if (!cartCtx) throw new Error("useCartPrerequisites must be used inside <CartProvider>");
  const { items, addItem } = cartCtx;
  const { apiBaseUrl } = config;
  const [missing, setMissing] = useState4([]);
  const [autoAdded, setAutoAdded] = useState4([]);
  const [dependencies, setDependencies] = useState4([]);
  const [isLoading, setIsLoading] = useState4(false);
  const [error, setError] = useState4(null);
  const autoAddedSlugsRef = useRef(/* @__PURE__ */ new Set());
  const productSlugs = Array.from(new Set(items.map((i) => i.slug))).sort();
  const slugKey = productSlugs.join(",");
  useEffect4(() => {
    let cancelled = false;
    if (productSlugs.length === 0) {
      setMissing([]);
      setAutoAdded([]);
      setDependencies([]);
      setError(null);
      return;
    }
    setIsLoading(true);
    fetchPrerequisites(apiBaseUrl, domain, productSlugs, buyerEmail).then(({ missing: data, dependencies: deps }) => {
      if (cancelled) return;
      setMissing(data);
      setDependencies(deps);
      setError(null);
      const toAdd = data.filter(
        (entry) => !autoAddedSlugsRef.current.has(entry.prerequisite.slug)
      );
      if (toAdd.length > 0) {
        toAdd.forEach((entry) => {
          autoAddedSlugsRef.current.add(entry.prerequisite.slug);
          addItem(entry.prerequisite.slug, 1);
        });
        setAutoAdded((prev) => [...prev, ...toAdd]);
      }
    }).catch((err) => {
      if (cancelled) return;
      setError(err instanceof Error ? err : new Error(String(err)));
      setMissing([]);
      setDependencies([]);
    }).finally(() => {
      if (!cancelled) setIsLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [slugKey, apiBaseUrl, domain, buyerEmail]);
  return { missing, autoAdded, dependencies, isLoading, error };
}
export {
  CartProvider,
  useCart,
  useCartPrerequisites,
  useCartProducts,
  useCartSuggestions
};
