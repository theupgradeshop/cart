// Public API — only these are accessible to consumers
export { CartProvider, useCart } from './cart-context';
export { useCartProducts } from './use-cart-products';
export { useCartSuggestions } from './use-cart-suggestions';
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
