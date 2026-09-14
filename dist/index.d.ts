import * as react_jsx_runtime from 'react/jsx-runtime';
import { ReactNode } from 'react';

/**
 * A cart line's bundle composition. Optional and additive — absent on every line an
 * account that never touches bundles ever creates, and on every line stored before this
 * field existed (see migrate-storage.ts).
 *
 * `includedItems` carries a quantity per item rather than bare membership: a bundle item's
 * quantity in `product_bundle_items` can be greater than one, so `includedItemSlugs: string[]`
 * cannot represent it.
 */
interface CartItemComposition {
    bundleSlug: string;
    includedItems: Array<{
        slug: string;
        quantity: number;
    }>;
}
/** Stored in localStorage — identity only, no price snapshot */
interface CartItem {
    slug: string;
    quantity: number;
    variantId?: string;
    composition?: CartItemComposition;
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

/** Shape of a successful `POST /api/public/store/bundle-rules/price` response. */
interface CartBundlePriceResult {
    totalMinor: number;
    discountMinor: number;
    appliedRuleId: string | null;
    appliedRuleName: string | null;
    basis: unknown;
    suppressionReason: string | null;
}
type CartBundlePriceEntry = {
    status: 'not-composed';
} | {
    status: 'unpriceable';
    reason: string;
} | {
    status: 'not-loaded';
} | {
    status: 'priced';
    result: CartBundlePriceResult;
};
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
declare function useCartBundlePrice(domain: string): {
    priceFor: (slug: string, variantId?: string) => CartBundlePriceEntry;
    isLoading: boolean;
    error: Error | null;
};

export { type CartBundlePriceEntry, type CartBundlePriceResult, type CartContextValue, type CartItem, type CartProduct, CartProvider, type CartSuggestion, type CartSuggestionProduct, type CartSuggestionType, type CartSuggestionsResponse, type MissingPrerequisite, type PrerequisiteProduct, type ProductVariant, useCart, useCartBundlePrice, useCartPrerequisites, useCartProducts, useCartSuggestions };
