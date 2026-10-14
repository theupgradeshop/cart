// Server-safe entry (`@upgradeshop/cart/checkout/server`): no 'use client', no React, no browser APIs.
// A Server Component (the product page) can call getCheckoutCapabilities from here.
export { getCheckoutCapabilities } from './capabilities';
export { buildCartDoorBody, buildFunnelDoorBody } from './bodies';
export { CheckoutError, checkoutErrorKey, isCheckoutError, CHECKOUT_ERROR_KEYS } from './errors';
export type {
  CheckoutTotals,
  CheckoutNext,
  CheckoutV2Response,
  CheckoutErrorKey,
  CheckoutCustomer,
  CartDoorItem,
  StartCartCheckoutInput,
  StartFunnelCheckoutInput,
  StartCheckoutInput,
  StartCheckoutResult,
  CheckoutCapabilities,
  OrderItemThin,
  OrderThin,
  OrderFull,
  ThankYouState,
  ThankYouResult,
} from './types';
