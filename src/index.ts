// Public API — only these are accessible to consumers
export { CartProvider, useCart } from './cart-context';
export { useCartProducts } from './use-cart-products';
export type {
  CartItem,
  CartProduct,
  CartContextValue,
  ProductVariant,
} from './types';
