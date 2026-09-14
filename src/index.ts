// Public API — only these are accessible to consumers
export { CartProvider, useCart } from './cart-context';
export { useCartProducts } from './use-cart-products';
export { useCartSuggestions } from './use-cart-suggestions';
export { useCartPrerequisites } from './use-cart-prerequisites';
export type { MissingPrerequisite, PrerequisiteProduct } from './use-cart-prerequisites';
export { useCartBundlePrice } from './use-cart-bundle-price';
export type { CartBundlePriceResult, CartBundlePriceEntry } from './use-cart-bundle-price';
export type {
  CartItem,
  CartProduct,
  CartContextValue,
  ProductVariant,
  CartSuggestion,
  CartSuggestionProduct,
  CartSuggestionType,
  CartSuggestionsResponse,
} from './types';
