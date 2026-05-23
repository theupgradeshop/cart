'use client';

import {
  createContext,
  useContext,
  useReducer,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from 'react';
import { CartContextValue, CartConfig, CartState } from './types';
import { cartReducer, initialCartState } from './cart-reducer';
import { migrateCartStorage } from './migrate-storage';

// Internal context — exported so useCartProducts can read apiBaseUrl
export const CartConfigContext = createContext<CartConfig>({
  apiBaseUrl: 'https://app.upgradeshop.ai',
});

export const CartContext = createContext<CartContextValue | null>(null);

interface CartProviderProps {
  children: ReactNode;
  storageKey: string;
  /**
   * Dashboard API base URL.
   * Defaults to 'https://app.upgradeshop.ai'.
   * Pass process.env.NEXT_PUBLIC_PLATFORM_URL so staging hits staging API.
   */
  apiBaseUrl?: string;
}

export function CartProvider({
  children,
  storageKey,
  apiBaseUrl = 'https://app.upgradeshop.ai',
}: CartProviderProps) {
  const [state, dispatch] = useReducer(cartReducer, initialCartState);
  const [hydrated, setHydrated] = useState(false);

  // On mount: migrate + load from localStorage (SSR-safe — runs after hydration)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      const items = migrateCartStorage(raw);
      if (items.length > 0) {
        dispatch({ type: 'LOAD_ITEMS', items });
        // Re-save in new format (overwrites old format)
        localStorage.setItem(storageKey, JSON.stringify(items));
      }
    } catch {
      // localStorage unavailable (SSR, private mode) — proceed with empty cart
    }
    setHydrated(true);
  }, [storageKey]);

  // Persist to localStorage on items change (after hydration only)
  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(state.items));
    } catch {
      // ignore
    }
  }, [state.items, hydrated, storageKey]);

  const addItem = useCallback((slug: string, quantity = 1, variantId?: string) => {
    dispatch({ type: 'ADD_ITEM', slug, quantity, variantId });
  }, []);

  const removeItem = useCallback((slug: string, variantId?: string) => {
    dispatch({ type: 'REMOVE_ITEM', slug, variantId });
  }, []);

  const updateQuantity = useCallback((slug: string, quantity: number, variantId?: string) => {
    dispatch({ type: 'UPDATE_QUANTITY', slug, quantity, variantId });
  }, []);

  const clearCart = useCallback(() => {
    dispatch({ type: 'CLEAR_CART' });
    try { localStorage.removeItem(storageKey); } catch { /* ignore */ }
  }, [storageKey]);

  const openCart = useCallback(() => dispatch({ type: 'OPEN_CART' }), []);
  const closeCart = useCallback(() => dispatch({ type: 'CLOSE_CART' }), []);
  const toggleCart = useCallback(() => dispatch({ type: 'TOGGLE_CART' }), []);

  const itemCount = state.items.reduce((sum, i) => sum + i.quantity, 0);

  const value: CartContextValue = {
    items: state.items,
    isOpen: state.isOpen,
    itemCount,
    addItem,
    removeItem,
    updateQuantity,
    clearCart,
    openCart,
    closeCart,
    toggleCart,
  };

  return (
    <CartConfigContext.Provider value={{ apiBaseUrl }}>
      <CartContext.Provider value={value}>
        {children}
      </CartContext.Provider>
    </CartConfigContext.Provider>
  );
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used inside <CartProvider>');
  return ctx;
}
