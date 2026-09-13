import * as react_jsx_runtime from 'react/jsx-runtime';
import { ReactNode } from 'react';

/** Stored in localStorage — identity only, no price snapshot */
interface CartItem {
    slug: string;
    quantity: number;
    variantId?: string;
}
interface ProductVariant {
    id: string;
    title: string;
    price: number | null;
    salePrice: number | null;
    sku: string;
    stockQuantity: number;
    imageUrl: string;
}
/** Live product data merged with cart quantity — derived from API, never localStorage */
interface CartProduct {
    slug: string;
    name: string;
    price: number;
    salePrice: number | null;
    images: {
        url: string;
        alt: string;
    }[];
    status: 'active' | 'unavailable';
    variants?: ProductVariant[];
    quantity: number;
    variantId?: string;
}
interface CartContextValue {
    items: CartItem[];
    isOpen: boolean;
    itemCount: number;
    addItem: (slug: string, quantity?: number, variantId?: string) => void;
    removeItem: (slug: string, variantId?: string) => void;
    updateQuantity: (slug: string, quantity: number, variantId?: string) => void;
    clearCart: () => void;
    openCart: () => void;
    closeCart: () => void;
    toggleCart: () => void;
}
interface CartSuggestionProduct {
    id: string;
    slug: string;
    name: string;
    price: number;
    salePrice: number | null;
    image: string | null;
}
type CartSuggestionType = 'bundle_upgrade' | 'upsell' | 'cross_sell' | 'fallback';
interface CartSuggestion {
    type: CartSuggestionType;
    product: CartSuggestionProduct;
    sourceProductSlug?: string;
    bundleItemSlugs?: string[];
    savingsAmount?: number;
    savingsPercent?: number;
}
interface CartSuggestionsResponse {
    style: string;
    suggestions: CartSuggestion[];
}

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
declare function CartProvider({ children, storageKey, apiBaseUrl, }: CartProviderProps): react_jsx_runtime.JSX.Element;
declare function useCart(): CartContextValue;

declare function useCartProducts(domain: string): {
    products: CartProduct[];
    isLoading: boolean;
    error: Error | null;
};

declare function useCartSuggestions(domain: string): {
    suggestions: CartSuggestion[];
    suggestionsStyle: string;
    isLoading: boolean;
    error: Error | null;
    applySuggestion: (s: CartSuggestion) => void;
};

interface PrerequisiteProduct {
    id: string;
    name: string;
    slug: string;
    price: number;
    images: unknown;
}
interface MissingPrerequisite {
    product: PrerequisiteProduct;
    prerequisite: PrerequisiteProduct;
}
declare function useCartPrerequisites(domain: string, buyerEmail?: string): {
    missing: MissingPrerequisite[];
    autoAdded: MissingPrerequisite[];
    dependencies: MissingPrerequisite[];
    dependentsOf: (slug: string) => PrerequisiteProduct[];
    isLoading: boolean;
    error: Error | null;
};

export { type CartContextValue, type CartItem, type CartProduct, CartProvider, type CartSuggestion, type CartSuggestionProduct, type CartSuggestionType, type CartSuggestionsResponse, type MissingPrerequisite, type PrerequisiteProduct, type ProductVariant, useCart, useCartPrerequisites, useCartProducts, useCartSuggestions };
