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

/**
 * The cart's single composed-course-bundle line (courses-bundles storefront spec, U3).
 * At most ONE of these exists in a cart at a time -- setting a new one replaces the
 * previous, matching checkout's own contract, which accepts one `composedBundle`
 * (`{ courseIds }`) per order. Kept OUT of the `items` array on purpose: `items` holds
 * only ordinary product lines (`{ slug, quantity, ... }`), and every existing consumer of
 * `items` (use-cart-products, use-cart-prerequisites, use-cart-suggestions, the reducer's
 * slug/variantId keying) assumes exactly that shape -- folding a differently-shaped line
 * into the same array would silently break each of them for a slug-less entry. This is
 * "a sibling type", per the spec's own phrasing, not an extension of `CartItem`.
 */
export interface ComposedCourseBundleCartItem {
  kind: 'composed-course-bundle';
  ruleId: string;
  courseIds: string[];
  title: string;
}

export interface CartContextValue {
  items: CartItem[];
  composedBundle: ComposedCourseBundleCartItem | null;
  isOpen: boolean;
  itemCount: number;          // Always available — computed from localStorage, no API call needed
  addItem: (slug: string, quantity?: number, variantId?: string) => void;
  removeItem: (slug: string, variantId?: string) => void;
  updateQuantity: (slug: string, quantity: number, variantId?: string) => void;
  clearCart: () => void;
  /** Replaces any existing composed-bundle line -- a cart holds at most one. */
  setComposedBundle: (bundle: ComposedCourseBundleCartItem) => void;
  clearComposedBundle: () => void;
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
  | { type: 'LOAD_ITEMS'; items: CartItem[] }
  | { type: 'SET_COMPOSED_BUNDLE'; composedBundle: ComposedCourseBundleCartItem }
  | { type: 'CLEAR_COMPOSED_BUNDLE' }
  | { type: 'LOAD_COMPOSED_BUNDLE'; composedBundle: ComposedCourseBundleCartItem | null };

export interface CartState {
  items: CartItem[];
  composedBundle: ComposedCourseBundleCartItem | null;
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
