'use client';
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var index_exports = {};
__export(index_exports, {
  CartProvider: () => CartProvider,
  derivePresetState: () => derivePresetState,
  fixedQuote: () => fixedQuote,
  next: () => next,
  presetOwned: () => presetOwned,
  presetSelection: () => presetSelection,
  quote: () => quote,
  quoteOne: () => quoteOne,
  quotePreset: () => quotePreset,
  resolveCheckoutSelection: () => resolveCheckoutSelection,
  sameSet: () => sameSet,
  toComposedBundleCheckoutFragment: () => toComposedBundleCheckoutFragment,
  useBundleOffer: () => useBundleOffer,
  useCart: () => useCart,
  useCartBundlePrice: () => useCartBundlePrice,
  useCartPrerequisites: () => useCartPrerequisites,
  useCartProducts: () => useCartProducts,
  useCartSuggestions: () => useCartSuggestions
});
module.exports = __toCommonJS(index_exports);

// src/cart-context.tsx
var import_react = require("react");

// src/cart-reducer.ts
function itemKey(slug, variantId) {
  return variantId ? `${slug}::${variantId}` : slug;
}
var initialCartState = { items: [], composedBundle: null, isOpen: false };
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
      return { ...state, items: [], composedBundle: null };
    case "SET_COMPOSED_BUNDLE":
      return { ...state, composedBundle: action.composedBundle };
    case "CLEAR_COMPOSED_BUNDLE":
      return { ...state, composedBundle: null };
    case "LOAD_COMPOSED_BUNDLE":
      return { ...state, composedBundle: action.composedBundle };
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
function isValidComposition(value) {
  if (typeof value !== "object" || value === null) return false;
  const composition = value;
  if (typeof composition.bundleSlug !== "string") return false;
  if (!Array.isArray(composition.includedItems)) return false;
  return composition.includedItems.every(
    (item) => typeof item === "object" && item !== null && typeof item.slug === "string" && typeof item.quantity === "number"
  );
}
function isValidComposedBundle(value) {
  if (typeof value !== "object" || value === null) return false;
  const bundle = value;
  if (bundle.kind !== "composed-course-bundle") return false;
  if (typeof bundle.ruleId !== "string") return false;
  if (typeof bundle.title !== "string") return false;
  if (!Array.isArray(bundle.courseIds)) return false;
  return bundle.courseIds.every((id) => typeof id === "string");
}
function migrateItemsArray(parsed) {
  if (parsed.length === 0) return [];
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
      if (isValidComposition(item.composition)) result.composition = item.composition;
      return result;
    });
  }
  return [];
}
function migrateCartStorage(raw) {
  if (!raw) return { items: [], composedBundle: null };
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { items: [], composedBundle: null };
  }
  if (!Array.isArray(parsed) && typeof parsed === "object" && parsed !== null && Array.isArray(parsed.items)) {
    const envelope = parsed;
    const items = migrateItemsArray(envelope.items);
    const composedBundle = isValidComposedBundle(envelope.composedBundle) ? envelope.composedBundle : null;
    return { items, composedBundle };
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return { items: [], composedBundle: null };
  return { items: migrateItemsArray(parsed), composedBundle: null };
}

// src/cart-context.tsx
var import_jsx_runtime = require("react/jsx-runtime");
var CartConfigContext = (0, import_react.createContext)({
  apiBaseUrl: "https://app.upgradeshop.ai"
});
var CartContext = (0, import_react.createContext)(null);
function CartProvider({
  children,
  storageKey,
  apiBaseUrl = "https://app.upgradeshop.ai"
}) {
  const [state, dispatch] = (0, import_react.useReducer)(cartReducer, initialCartState);
  const [hydrated, setHydrated] = (0, import_react.useState)(false);
  (0, import_react.useEffect)(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      const { items, composedBundle } = migrateCartStorage(raw);
      if (items.length > 0) {
        dispatch({ type: "LOAD_ITEMS", items });
      }
      if (composedBundle) {
        dispatch({ type: "LOAD_COMPOSED_BUNDLE", composedBundle });
      }
      if (items.length > 0 || composedBundle) {
        localStorage.setItem(storageKey, JSON.stringify({ items, composedBundle }));
      }
    } catch {
    }
    setHydrated(true);
  }, [storageKey]);
  (0, import_react.useEffect)(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify({ items: state.items, composedBundle: state.composedBundle }));
    } catch {
    }
  }, [state.items, state.composedBundle, hydrated, storageKey]);
  const addItem = (0, import_react.useCallback)((slug, quantity = 1, variantId) => {
    dispatch({ type: "ADD_ITEM", slug, quantity, variantId });
  }, []);
  const removeItem = (0, import_react.useCallback)((slug, variantId) => {
    dispatch({ type: "REMOVE_ITEM", slug, variantId });
  }, []);
  const updateQuantity = (0, import_react.useCallback)((slug, quantity, variantId) => {
    dispatch({ type: "UPDATE_QUANTITY", slug, quantity, variantId });
  }, []);
  const clearCart = (0, import_react.useCallback)(() => {
    dispatch({ type: "CLEAR_CART" });
    try {
      localStorage.removeItem(storageKey);
    } catch {
    }
  }, [storageKey]);
  const setComposedBundle = (0, import_react.useCallback)((bundle) => {
    dispatch({ type: "SET_COMPOSED_BUNDLE", composedBundle: bundle });
  }, []);
  const clearComposedBundle = (0, import_react.useCallback)(() => {
    dispatch({ type: "CLEAR_COMPOSED_BUNDLE" });
  }, []);
  const openCart = (0, import_react.useCallback)(() => dispatch({ type: "OPEN_CART" }), []);
  const closeCart = (0, import_react.useCallback)(() => dispatch({ type: "CLOSE_CART" }), []);
  const toggleCart = (0, import_react.useCallback)(() => dispatch({ type: "TOGGLE_CART" }), []);
  const itemCount = state.items.reduce((sum, i) => sum + i.quantity, 0);
  const value = {
    items: state.items,
    composedBundle: state.composedBundle,
    isOpen: state.isOpen,
    itemCount,
    addItem,
    removeItem,
    updateQuantity,
    clearCart,
    setComposedBundle,
    clearComposedBundle,
    openCart,
    closeCart,
    toggleCart
  };
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(CartConfigContext.Provider, { value: { apiBaseUrl }, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(CartContext.Provider, { value, children }) });
}
function useCart() {
  const ctx = (0, import_react.useContext)(CartContext);
  if (!ctx) throw new Error("useCart must be used inside <CartProvider>");
  return ctx;
}

// src/use-cart-products.ts
var import_react2 = require("react");
var productCache = /* @__PURE__ */ new Map();
var CACHE_TTL_MS = 6e4;
var singleProductCache = /* @__PURE__ */ new Map();
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
async function fetchProductBySlug(apiBaseUrl, domain, slug) {
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
  ).then((res) => {
    if (!res.ok) return null;
    return res.json();
  }).then((json) => {
    const data = json?.product ?? null;
    singleProductCache.set(cacheKey, { data, timestamp: Date.now() });
    return data;
  }).catch(() => {
    singleProductCache.set(cacheKey, { data: null, timestamp: Date.now() });
    return null;
  }).finally(() => {
    const entry = singleProductCache.get(cacheKey);
    if (entry) singleProductCache.set(cacheKey, { ...entry, promise: void 0 });
  });
  singleProductCache.set(cacheKey, {
    data: cached?.data ?? null,
    timestamp: cached?.timestamp ?? 0,
    promise
  });
  return promise;
}
function useCartProducts(domain) {
  const cartCtx = (0, import_react2.useContext)(CartContext);
  const config = (0, import_react2.useContext)(CartConfigContext);
  if (!cartCtx) throw new Error("useCartProducts must be used inside <CartProvider>");
  const { items } = cartCtx;
  const { apiBaseUrl } = config;
  const [products, setProducts] = (0, import_react2.useState)([]);
  const [isLoading, setIsLoading] = (0, import_react2.useState)(false);
  const [error, setError] = (0, import_react2.useState)(null);
  const slugKey = items.map((i) => `${i.slug}${i.variantId ?? ""}`).sort().join(",");
  (0, import_react2.useEffect)(() => {
    let cancelled = false;
    if (items.length === 0) {
      setProducts([]);
      setError(null);
      return;
    }
    setIsLoading(true);
    fetchProductCatalog(apiBaseUrl, domain).then(async (allProducts) => {
      if (cancelled) return;
      const liveMap = new Map(
        allProducts.map((p) => [p.slug, p])
      );
      const missingSlugs = [...new Set(
        items.map((i) => i.slug).filter((slug) => !liveMap.has(slug))
      )];
      if (missingSlugs.length > 0) {
        const fallbackResults = await Promise.all(
          missingSlugs.map((slug) => fetchProductBySlug(apiBaseUrl, domain, slug))
        );
        fallbackResults.forEach((product, i) => {
          if (product) liveMap.set(missingSlugs[i], product);
        });
      }
      if (cancelled) return;
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
          // The catalog list returns snake_case names, the single-product fallback camelCase; one shape out.
          product_type: live.product_type ?? live.productType ?? null,
          contains_physical_product: (live.contains_physical_product ?? live.containsPhysicalProduct) === true,
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
var import_react3 = require("react");
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
  const cartCtx = (0, import_react3.useContext)(CartContext);
  const config = (0, import_react3.useContext)(CartConfigContext);
  if (!cartCtx) throw new Error("useCartSuggestions must be used inside <CartProvider>");
  const { items, addItem, removeItem } = cartCtx;
  const { apiBaseUrl } = config;
  const [suggestions, setSuggestions] = (0, import_react3.useState)([]);
  const [suggestionsStyle, setSuggestionsStyle] = (0, import_react3.useState)("sidebar");
  const [isLoading, setIsLoading] = (0, import_react3.useState)(false);
  const [error, setError] = (0, import_react3.useState)(null);
  const productSlugs = Array.from(new Set(items.map((i) => i.slug))).sort();
  const slugKey = productSlugs.join(",");
  (0, import_react3.useEffect)(() => {
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
  const applySuggestion = (0, import_react3.useCallback)((s) => {
    if (s.type === "bundle_upgrade") {
      const toRemove = s.bundleItemSlugs?.length ? s.bundleItemSlugs : s.sourceProductSlug ? [s.sourceProductSlug] : [];
      toRemove.forEach((slug) => removeItem(slug));
    }
    addItem(s.product.slug);
  }, [addItem, removeItem]);
  return { suggestions, suggestionsStyle, isLoading, error, applySuggestion };
}

// src/use-cart-prerequisites.ts
var import_react4 = require("react");
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
  const cartCtx = (0, import_react4.useContext)(CartContext);
  const config = (0, import_react4.useContext)(CartConfigContext);
  if (!cartCtx) throw new Error("useCartPrerequisites must be used inside <CartProvider>");
  const { items, addItem } = cartCtx;
  const { apiBaseUrl } = config;
  const [missing, setMissing] = (0, import_react4.useState)([]);
  const [autoAdded, setAutoAdded] = (0, import_react4.useState)([]);
  const [dependencies, setDependencies] = (0, import_react4.useState)([]);
  const [isLoading, setIsLoading] = (0, import_react4.useState)(false);
  const [error, setError] = (0, import_react4.useState)(null);
  const autoAddedSlugsRef = (0, import_react4.useRef)(/* @__PURE__ */ new Set());
  const productSlugs = Array.from(new Set(items.map((i) => i.slug))).sort();
  const slugKey = productSlugs.join(",");
  (0, import_react4.useEffect)(() => {
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
  const dependentsOf = (0, import_react4.useCallback)(
    (slug) => {
      const seenIds = /* @__PURE__ */ new Set();
      const dependents = [];
      for (const entry of dependencies) {
        if (entry.prerequisite.slug !== slug) continue;
        if (seenIds.has(entry.product.id)) continue;
        seenIds.add(entry.product.id);
        dependents.push(entry.product);
      }
      return dependents;
    },
    [dependencies]
  );
  return { missing, autoAdded, dependencies, dependentsOf, isLoading, error };
}

// src/use-cart-bundle-price.ts
var import_react5 = require("react");
var UNPRICEABLE_REASON = "The bundle-rules price evaluator has no quantity field (ChosenItem is { id, listPriceMinor, owned }) \u2014 every chosen item prices as a single unit. A composition with an included item quantity greater than 1 would silently under-price if requested as-is, so no price is requested or shown for it until the evaluator becomes quantity-aware.";
var bundlePriceCache = /* @__PURE__ */ new Map();
var CACHE_TTL_MS4 = 6e4;
function hasQuantityAboveOne(includedItems) {
  return includedItems.some((i) => i.quantity > 1);
}
function compositionKey(bundleSlug, includedItems) {
  const itemsPart = includedItems.map((i) => `${i.slug}:${i.quantity}`).sort().join(",");
  return `${bundleSlug}::${itemsPart}`;
}
async function fetchBundlePrice(apiBaseUrl, domain, composition) {
  const cacheKey = `${apiBaseUrl}::${domain}::${compositionKey(composition.bundleSlug, composition.includedItems)}`;
  const cached = bundlePriceCache.get(cacheKey);
  const now = Date.now();
  if (cached?.data && !cached.promise && now - cached.timestamp < CACHE_TTL_MS4) {
    return cached.data;
  }
  if (cached?.promise) {
    return cached.promise;
  }
  const productSlugs = composition.includedItems.map((i) => i.slug);
  const promise = fetch(`${apiBaseUrl}/api/public/store/bundle-rules/price`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ domain, productSlugs })
  }).then((res) => {
    if (!res.ok) throw new Error(`Bundle price API ${res.status}`);
    return res.json();
  }).then((json) => {
    const data = {
      totalMinor: json.totalMinor ?? 0,
      discountMinor: json.discountMinor ?? 0,
      appliedRuleId: json.appliedRuleId ?? null,
      appliedRuleName: json.appliedRuleName ?? null,
      basis: json.basis ?? null,
      suppressionReason: json.suppressionReason ?? null
    };
    bundlePriceCache.set(cacheKey, { data, timestamp: Date.now() });
    return data;
  }).finally(() => {
    const entry = bundlePriceCache.get(cacheKey);
    if (entry) bundlePriceCache.set(cacheKey, { ...entry, promise: void 0 });
  });
  bundlePriceCache.set(cacheKey, {
    data: cached?.data,
    timestamp: cached?.timestamp ?? 0,
    promise
  });
  return promise;
}
function useCartBundlePrice(domain) {
  const cartCtx = (0, import_react5.useContext)(CartContext);
  const config = (0, import_react5.useContext)(CartConfigContext);
  if (!cartCtx) throw new Error("useCartBundlePrice must be used inside <CartProvider>");
  const { items } = cartCtx;
  const { apiBaseUrl } = config;
  const priceableLines = items.filter(
    (i) => i.composition && !hasQuantityAboveOne(i.composition.includedItems)
  );
  const [results, setResults] = (0, import_react5.useState)(/* @__PURE__ */ new Map());
  const [loadingKeys, setLoadingKeys] = (0, import_react5.useState)(/* @__PURE__ */ new Set());
  const [error, setError] = (0, import_react5.useState)(null);
  const compKey = priceableLines.map((i) => compositionKey(i.composition.bundleSlug, i.composition.includedItems)).sort().join("|");
  (0, import_react5.useEffect)(() => {
    let cancelled = false;
    if (priceableLines.length === 0) {
      setLoadingKeys(/* @__PURE__ */ new Set());
      return;
    }
    const byContent = /* @__PURE__ */ new Map();
    for (const item of priceableLines) {
      const key = compositionKey(item.composition.bundleSlug, item.composition.includedItems);
      if (!byContent.has(key)) byContent.set(key, item.composition);
    }
    setLoadingKeys(new Set(byContent.keys()));
    for (const [key, composition] of byContent) {
      fetchBundlePrice(apiBaseUrl, domain, composition).then((data) => {
        if (cancelled) return;
        setResults((prev) => {
          const next2 = new Map(prev);
          next2.set(key, data);
          return next2;
        });
        setError(null);
      }).catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err : new Error(String(err)));
      }).finally(() => {
        if (cancelled) return;
        setLoadingKeys((prev) => {
          const next2 = new Set(prev);
          next2.delete(key);
          return next2;
        });
      });
    }
    return () => {
      cancelled = true;
    };
  }, [compKey, apiBaseUrl, domain]);
  const priceFor = (slug, variantId) => {
    const key = itemKey(slug, variantId);
    const line = items.find((i) => itemKey(i.slug, i.variantId) === key);
    if (!line?.composition) return { status: "not-composed" };
    if (hasQuantityAboveOne(line.composition.includedItems)) {
      return { status: "unpriceable", reason: UNPRICEABLE_REASON };
    }
    const contentKey = compositionKey(line.composition.bundleSlug, line.composition.includedItems);
    const result = results.get(contentKey);
    if (result) return { status: "priced", result };
    return { status: "not-loaded" };
  };
  return { priceFor, isLoading: loadingKeys.size > 0, error };
}

// src/composed-bundle.ts
function toComposedBundleCheckoutFragment(composedBundle) {
  if (!composedBundle) return void 0;
  return { composedBundle: { courseIds: composedBundle.courseIds } };
}

// src/bundle-engine.ts
function isEligible(offer, id) {
  return offer.eligible.includes(id);
}
function pickHighestTier(tiers, size) {
  let best = null;
  for (const tier of tiers) {
    if (tier.count <= size && (best === null || tier.count > best.count)) best = tier;
  }
  return best;
}
function pickExactTier(tiers, size) {
  return tiers.find((t) => t.count === size) ?? null;
}
function rawCandidate(offer, pickedIds, ownIds, coursesById) {
  const size = pickedIds.length + ownIds.length;
  if (size < offer.min || size > offer.max) return null;
  if (![...pickedIds, ...ownIds].every((id) => isEligible(offer, id))) return null;
  const fullMinor = pickedIds.reduce((sum, id) => sum + coursesById[id].listPriceMinor, 0);
  switch (offer.scheme) {
    case "tiered_by_count": {
      const tier = pickHighestTier(offer.tiers, size);
      const discountMinor = tier ? Math.round(fullMinor * tier.percentOff / 100) : 0;
      return {
        ruleId: offer.id,
        totalMinor: fullMinor - discountMinor,
        discountMinor,
        basis: { scheme: "tiered_by_count", tier }
      };
    }
    case "flat_percentage": {
      const discountMinor = Math.round(fullMinor * offer.percentOff / 100);
      return {
        ruleId: offer.id,
        totalMinor: fullMinor - discountMinor,
        discountMinor,
        basis: { scheme: "flat_percentage", percentOff: offer.percentOff }
      };
    }
    case "fixed_price_per_tier": {
      const tier = pickExactTier(offer.tiers, size);
      if (!tier) {
        const lo = offer.tiers.filter((t) => t.count < size).sort((a, b) => b.count - a.count)[0] ?? null;
        const hi = offer.tiers.filter((t) => t.count > size && t.count <= offer.max).sort((a, b) => a.count - b.count)[0] ?? null;
        return { lo, hi };
      }
      return {
        ruleId: offer.id,
        totalMinor: tier.fixedPriceMinor,
        discountMinor: fullMinor - tier.fixedPriceMinor,
        basis: { scheme: "fixed_price_per_tier", tier }
      };
    }
    case "per_course_contribution": {
      const perItemMinor = {};
      let totalMinor = 0;
      for (const id of pickedIds) {
        const price = offer.coursePricesMinor[id] ?? coursesById[id].listPriceMinor;
        perItemMinor[id] = price;
        totalMinor += price;
      }
      return {
        ruleId: offer.id,
        totalMinor,
        discountMinor: fullMinor - totalMinor,
        basis: { scheme: "per_course_contribution", perItemMinor }
      };
    }
  }
}
function isGap(x) {
  return x !== null && !("ruleId" in x);
}
function guard(winner, fullMinor) {
  if (winner === null) {
    return { totalMinor: fullMinor, discountMinor: 0, appliedRuleId: null, basis: null };
  }
  if (winner.totalMinor < 0 || winner.discountMinor <= 0) {
    return { totalMinor: fullMinor, discountMinor: 0, appliedRuleId: null, basis: null };
  }
  return {
    totalMinor: winner.totalMinor,
    discountMinor: winner.discountMinor,
    appliedRuleId: winner.ruleId,
    basis: winner.basis
  };
}
function quoteOne(offer, sel, owned, coursesById) {
  const own = owned.filter((id) => isEligible(offer, id));
  const picked = sel.filter((id) => isEligible(offer, id) && !own.includes(id));
  const count = picked.length + own.length;
  const fullMinor = picked.reduce((sum, id) => sum + coursesById[id].listPriceMinor, 0);
  const short = Math.max(0, offer.min - count);
  const atMax = count >= offer.max;
  const base = {
    count,
    own,
    picked,
    fullMinor,
    payMinor: fullMinor,
    offMinor: 0,
    pct: 0,
    valid: false,
    short,
    atMax,
    noSaving: false,
    basis: null,
    wonOfferId: null,
    gap: null
  };
  if (count < offer.min || count > offer.max) return base;
  const raw = rawCandidate(offer, picked, own, coursesById);
  if (isGap(raw)) return { ...base, gap: raw };
  const guarded = guard(raw, fullMinor);
  const noSaving = guarded.appliedRuleId === null;
  return {
    ...base,
    valid: true,
    basis: guarded.basis,
    noSaving,
    payMinor: guarded.totalMinor,
    offMinor: fullMinor - guarded.totalMinor,
    pct: fullMinor > 0 ? Math.round((fullMinor - guarded.totalMinor) / fullMinor * 100) : 0
  };
}
function quote(offer, alts, sel, owned, coursesById) {
  const own = owned.filter((id) => isEligible(offer, id));
  const picked = sel.filter((id) => isEligible(offer, id) && !own.includes(id));
  const count = picked.length + own.length;
  const fullMinor = picked.reduce((sum, id) => sum + coursesById[id].listPriceMinor, 0);
  const short = Math.max(0, offer.min - count);
  const atMax = count >= offer.max;
  const base = {
    count,
    own,
    picked,
    fullMinor,
    payMinor: fullMinor,
    offMinor: 0,
    pct: 0,
    valid: false,
    short,
    atMax,
    noSaving: false,
    basis: null,
    wonOfferId: null,
    gap: null
  };
  if (count < offer.min || count > offer.max) return base;
  const primaryRaw = rawCandidate(offer, picked, own, coursesById);
  if (isGap(primaryRaw)) return { ...base, gap: primaryRaw };
  const allSelected = [...picked, ...own];
  const candidates = [];
  if (primaryRaw !== null) candidates.push(primaryRaw);
  for (const alt of alts) {
    if (!allSelected.every((id) => isEligible(alt, id))) continue;
    const altRaw = rawCandidate(alt, picked, own, coursesById);
    if (altRaw !== null && !isGap(altRaw)) candidates.push(altRaw);
  }
  let winner = null;
  for (const candidate of candidates) {
    if (winner === null || candidate.totalMinor < winner.totalMinor || candidate.totalMinor === winner.totalMinor && candidate.ruleId < winner.ruleId) {
      winner = candidate;
    }
  }
  const guarded = guard(winner, fullMinor);
  const noSaving = guarded.appliedRuleId === null;
  const wonOfferId = guarded.appliedRuleId !== null && guarded.appliedRuleId !== offer.id ? guarded.appliedRuleId : null;
  return {
    ...base,
    valid: true,
    basis: guarded.basis,
    noSaving,
    payMinor: guarded.totalMinor,
    offMinor: fullMinor - guarded.totalMinor,
    pct: fullMinor > 0 ? Math.round((fullMinor - guarded.totalMinor) / fullMinor * 100) : 0,
    wonOfferId
  };
}
function next(offer, alts, q, sel, owned, coursesById) {
  if (!q.valid || q.atMax) return null;
  if (offer.scheme === "tiered_by_count") {
    const nx = offer.tiers.filter((t) => t.count > q.count && t.count <= offer.max).sort((a, b) => a.count - b.count)[0];
    if (!nx) return null;
    const add = nx.count - q.count;
    let mMinor = null;
    if (add === 1) {
      const rest = offer.eligible.filter((id) => !sel.includes(id) && !owned.includes(id));
      const costs = rest.map((id) => {
        const withId = quote(offer, alts, [...sel, id], owned, coursesById);
        return withId.payMinor - q.payMinor;
      });
      if (costs.length > 0) mMinor = Math.min(...costs);
    }
    return { kind: "tier", add, to: nx.percentOff, n: nx.count, mMinor };
  }
  if (offer.scheme === "fixed_price_per_tier") {
    const nx = offer.tiers.filter((t) => t.count > q.count && t.count <= offer.max).sort((a, b) => a.count - b.count)[0];
    if (!nx) return null;
    return { kind: "set", add: nx.count - q.count, n: nx.count, priceMinor: nx.fixedPriceMinor };
  }
  return null;
}
function fixedQuote(offer, coursesById) {
  const fullMinor = offer.ids.reduce((sum, id) => sum + coursesById[id].listPriceMinor, 0);
  const payMinor = Math.min(offer.priceMinor, fullMinor);
  const offMinor = fullMinor - payMinor;
  return {
    fixed: true,
    count: offer.ids.length,
    picked: offer.ids,
    fullMinor,
    payMinor,
    offMinor,
    pct: fullMinor > 0 ? Math.round(offMinor / fullMinor * 100) : 0,
    valid: true,
    noSaving: payMinor >= fullMinor
  };
}

// src/use-bundle-offer.ts
var import_react6 = require("react");

// src/bundle-presets.ts
function sameSet(a, b) {
  return a.length === b.length && a.every((x) => b.includes(x));
}
function presetSelection(preset, owned) {
  return preset.ids.filter((id) => !owned.includes(id));
}
function presetOwned(preset, owned) {
  return preset.swap ? owned : owned.filter((id) => preset.ids.includes(id));
}
function derivePresetState(params) {
  const { presets, preset, sel, owned } = params;
  const act = presets.find((p) => p.id === preset) ?? null;
  const locked = !!act && !act.swap;
  const pSel = act ? presetSelection(act, owned) : [];
  const mine = !!act && act.swap && !sameSet(sel, pSel);
  return { act, locked, pSel, mine };
}
function quotePreset(offer, alts, preset, owned, courses) {
  return quote(offer, alts, preset.ids, presetOwned(preset, owned), courses);
}
function resolveCheckoutSelection(params) {
  const { act, locked } = derivePresetState(params);
  if (act && locked) return act.ids;
  return [...params.quote.own, ...params.quote.picked];
}

// src/use-bundle-offer.ts
function useBundleOffer(url) {
  const [state, setState] = (0, import_react6.useState)({ status: "loading" });
  const [sel, setSelState] = (0, import_react6.useState)([]);
  const [preset, setPresetState] = (0, import_react6.useState)(null);
  const requestIdRef = (0, import_react6.useRef)(0);
  (0, import_react6.useEffect)(() => {
    let cancelled = false;
    const requestId = ++requestIdRef.current;
    setState({ status: "loading" });
    setSelState([]);
    setPresetState(null);
    fetch(url).then((res) => {
      if (!res.ok) throw new Error(`Bundle offer fetch failed: ${res.status}`);
      return res.json();
    }).then((json) => {
      if (cancelled || requestIdRef.current !== requestId) return;
      setState({ ...json, status: json.status });
    }).catch((err) => {
      if (cancelled || requestIdRef.current !== requestId) return;
      setState({ status: "error", error: err instanceof Error ? err : new Error(String(err)) });
    });
    return () => {
      cancelled = true;
    };
  }, [url]);
  const coursesById = (0, import_react6.useMemo)(() => {
    if (state.status !== "live" && state.status !== "draft" && state.status !== "gone") return {};
    const map = {};
    for (const c of state.courses) map[c.id] = c;
    return map;
  }, [state]);
  const offer = state.status === "live" || state.status === "draft" || state.status === "gone" ? state.offer : null;
  const alts = state.status === "live" || state.status === "draft" || state.status === "gone" ? state.alts : [];
  const owned = state.status === "live" || state.status === "draft" || state.status === "gone" ? state.owned : [];
  const currency = state.status === "live" || state.status === "draft" || state.status === "gone" ? state.currency : null;
  const isRuleOffer = offer !== null && offer.kind === "rule";
  const ruleOffer = isRuleOffer ? offer : null;
  const setSel = (0, import_react6.useCallback)(
    (nextSel) => {
      if (!ruleOffer) return;
      const capped = nextSel.length > ruleOffer.max ? [...owned.filter((id) => nextSel.includes(id)), ...nextSel.filter((id) => !owned.includes(id))].slice(
        0,
        ruleOffer.max
      ) : nextSel;
      setSelState(capped);
    },
    [ruleOffer, owned]
  );
  const toggle = (0, import_react6.useCallback)(
    (id) => {
      if (!ruleOffer) return;
      if (owned.includes(id)) return;
      setSelState((prev) => {
        if (prev.includes(id)) return prev.filter((x) => x !== id);
        const own = owned.filter((o) => ruleOffer.eligible.includes(o));
        const atMax = prev.length + own.length >= ruleOffer.max;
        if (atMax) return prev;
        return [...prev, id];
      });
    },
    [ruleOffer, owned]
  );
  const computedQuote = ruleOffer ? quote(ruleOffer, alts, sel, owned, coursesById) : null;
  const computedNext = ruleOffer && computedQuote ? next(ruleOffer, alts, computedQuote, sel, owned, coursesById) : null;
  const presets = ruleOffer?.presets ?? [];
  const derived = (0, import_react6.useMemo)(
    () => derivePresetState({ presets, preset, sel, owned }),
    [presets, preset, sel, owned]
  );
  const setPreset = (0, import_react6.useCallback)((id) => {
    setPresetState(id);
  }, []);
  const takePreset = (0, import_react6.useCallback)(
    (id) => {
      const p = presets.find((candidate) => candidate.id === id);
      if (!p) return;
      setPresetState(p.id);
      setSelState(p.swap ? p.ids.filter((cid) => !owned.includes(cid)) : []);
    },
    [presets, owned]
  );
  const buildOwn = (0, import_react6.useCallback)(() => {
    if (!derived.act) return;
    setPresetState(null);
    if (!derived.mine) setSelState([]);
  }, [derived.act, derived.mine]);
  const undoChanges = (0, import_react6.useCallback)(() => {
    if (!derived.mine) return;
    setSelState(derived.pSel);
  }, [derived.mine, derived.pSel]);
  return {
    status: state.status,
    currency,
    offer,
    courses: coursesById,
    alts,
    owned,
    sel,
    setSel,
    toggle,
    quote: computedQuote,
    next: computedNext,
    loading: state.status === "loading",
    error: state.status === "error" ? state.error : null,
    presets,
    preset,
    setPreset,
    takePreset,
    buildOwn,
    undoChanges
  };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  CartProvider,
  derivePresetState,
  fixedQuote,
  next,
  presetOwned,
  presetSelection,
  quote,
  quoteOne,
  quotePreset,
  resolveCheckoutSelection,
  sameSet,
  toComposedBundleCheckoutFragment,
  useBundleOffer,
  useCart,
  useCartBundlePrice,
  useCartPrerequisites,
  useCartProducts,
  useCartSuggestions
});
