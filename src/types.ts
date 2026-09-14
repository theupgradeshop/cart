/**
 * A cart line's bundle composition. Optional and additive — absent on every line an
 * account that never touches bundles ever creates, and on every line stored before this
 * field existed (see migrate-storage.ts).
 *
 * `includedItems` carries a quantity per item rather than bare membership: a bundle item's
 * quantity in `product_bundle_items` can be greater than one, so `includedItemSlugs: string[]`
 * cannot represent it.
 */
export interface CartItemComposition {
  bundleSlug: string;
  includedItems: Array<{ slug: string; quantity: number }>;
}

/** Stored in localStorage — identity only, no price snapshot */
export interface CartItem {
  slug: string;       // Product slug — must be treated as immutable in the dashboard
  quantity: number;
  variantId?: string; // Required for variant products — see addItem() contract
  composition?: CartItemComposition; // Present only for an edited bundle line — see CartItemComposition
}

export interface ProductVariant {
  id: string;
  title: string;
  price: number | null;
  salePrice: number | null;
  sku: string;
  stockQuantity: number;
  imageUrl: string;
}

/** Live product data merged with cart quantity — derived from API, never localStorage */
export interface CartProduct {
  slug: string;
  name: string;
  price: number;              // Current live price
  salePrice: number | null;
  images: { url: string; alt: string }[];
  status: 'active' | 'unavailable'; // 'unavailable' = deleted/inactive in catalog
  variants?: ProductVariant[];
  quantity: number;           // Merged from CartItem
  variantId?: string;         // Merged from CartItem
}

export interface CartContextValue {
  items: CartItem[];
  isOpen: boolean;
  itemCount: number;          // Always available — computed from localStorage, no API call needed
  addItem: (slug: string, quantity?: number, variantId?: string) => void;
  removeItem: (slug: string, variantId?: string) => void;
  updateQuantity: (slug: string, quantity: number, variantId?: string) => void;
  clearCart: () => void;
  openCart: () => void;
  closeCart: () => void;
  toggleCart: () => void;
}

export type CartAction =
  | { type: 'ADD_ITEM'; slug: string; quantity: number; variantId?: string }
  | { type: 'REMOVE_ITEM'; slug: string; variantId?: string }
  | { type: 'UPDATE_QUANTITY'; slug: string; quantity: number; variantId?: string }
  | { type: 'CLEAR_CART' }
  | { type: 'OPEN_CART' }
  | { type: 'CLOSE_CART' }
  | { type: 'TOGGLE_CART' }
  | { type: 'LOAD_ITEMS'; items: CartItem[] };

export interface CartState {
  items: CartItem[];
  isOpen: boolean;
}

/** Internal config passed through CartConfigContext — not part of public API */
export interface CartConfig {
  apiBaseUrl: string;
}

export interface CartSuggestionProduct {
  id: string;
  slug: string;
  name: string;
  price: number;
  salePrice: number | null;
  image: string | null;
}

export type CartSuggestionType = 'bundle_upgrade' | 'upsell' | 'cross_sell' | 'fallback';

export interface CartSuggestion {
  type: CartSuggestionType;
  product: CartSuggestionProduct;
  sourceProductSlug?: string;
  bundleItemSlugs?: string[];
  savingsAmount?: number;
  savingsPercent?: number;
}

export interface CartSuggestionsResponse {
  style: string;
  suggestions: CartSuggestion[];
}
