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
  useCart: () => useCart,
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
      const items = migrateCartStorage(raw);
      if (items.length > 0) {
        dispatch({ type: "LOAD_ITEMS", items });
        localStorage.setItem(storageKey, JSON.stringify(items));
      }
    } catch {
    }
    setHydrated(true);
  }, [storageKey]);
  (0, import_react.useEffect)(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(state.items));
    } catch {
    }
  }, [state.items, hydrated, storageKey]);
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
  const openCart = (0, import_react.useCallback)(() => dispatch({ type: "OPEN_CART" }), []);
  const closeCart = (0, import_react.useCallback)(() => dispatch({ type: "CLOSE_CART" }), []);
  const toggleCart = (0, import_react.useCallback)(() => dispatch({ type: "TOGGLE_CART" }), []);
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
var import_react3 = require("react");
var suggestionCache = /* @__PURE__ */ new Map();
var CACHE_TTL_MS2 = 6e4;
async function fetchSuggestions(apiBaseUrl, domain, productSlugs) {
  const slugParam = productSlugs.join(",");
  const cacheKey = `${apiBaseUrl}::${domain}::${slugParam}`;
  const cached = suggestionCache.get(cacheKey);
  const now = Date.now();
  if (cached && !cached.promise && now - cached.timestamp < CACHE_TTL_MS2) {
    return cached.data;
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
    const data = json.suggestions ?? [];
    suggestionCache.set(cacheKey, { data, timestamp: Date.now() });
    return data;
  }).finally(() => {
    const entry = suggestionCache.get(cacheKey);
    if (entry) suggestionCache.set(cacheKey, { ...entry, promise: void 0 });
  });
  suggestionCache.set(cacheKey, {
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
  const [isLoading, setIsLoading] = (0, import_react3.useState)(false);
  const [error, setError] = (0, import_react3.useState)(null);
  const productSlugs = Array.from(new Set(items.map((i) => i.slug))).sort();
  const slugKey = productSlugs.join(",");
  (0, import_react3.useEffect)(() => {
    let cancelled = false;
    if (productSlugs.length === 0) {
      setSuggestions([]);
      setError(null);
      return;
    }
    setIsLoading(true);
    fetchSuggestions(apiBaseUrl, domain, productSlugs).then((data) => {
      if (cancelled) return;
      setSuggestions(data);
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
    if (s.type === "bundle_upgrade" && s.sourceProductSlug) {
      removeItem(s.sourceProductSlug);
    }
    addItem(s.product.slug);
  }, [addItem, removeItem]);
  return { suggestions, isLoading, error, applySuggestion };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  CartProvider,
  useCart,
  useCartProducts,
  useCartSuggestions
});
