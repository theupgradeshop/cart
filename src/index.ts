// Public API — only these are accessible to consumers
export { CartProvider, useCart } from './cart-context';
export { useCartProducts } from './use-cart-products';
export { useCartSuggestions } from './use-cart-suggestions';
export { useCartPrerequisites } from './use-cart-prerequisites';
export type { MissingPrerequisite, PrerequisiteProduct } from './use-cart-prerequisites';
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
