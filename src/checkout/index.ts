// Client entry (`@upgradeshop/cart/checkout`, 'use client'): startCheckout, the thank-you reader and the hooks.
// Behaviour only, no visual components, no visitor words. Errors, body builders and types are re-exported; getCheckoutCapabilities is not (see ./server).
export { startCheckout } from './start-checkout';
export {
  getOrderForThankYou,
  POLL_INTERVAL_MS,
  POLL_MAX_REQUESTS,
  TERMINAL_FINANCIAL_STATUSES,
} from './thank-you';
export type { GetOrderForThankYouOptions } from './thank-you';
export { useThankYouOrder } from './use-thank-you-order';
export type { UseThankYouOrderOptions, UseThankYouOrderResult } from './use-thank-you-order';
export { useLinkCoupon } from './use-link-coupon';
export type { UseLinkCouponOptions, LinkCouponLine } from './use-link-coupon';
// usePayFrame / breakOutOfFrame live ONLY in ./pay-frame so a site can load the pay pop-up lazily.
// Errors and types only. getCheckoutCapabilities lives ONLY in ./server so an editor auto-import
// can never pull a 'use client' function into a Server Component.
export { CheckoutError, checkoutErrorKey, isCheckoutError, CHECKOUT_ERROR_KEYS } from './errors';
export { buildCartDoorBody, buildFunnelDoorBody } from './bodies';
export { buildCouponValidateBody, parseCouponValidation, MAX_COUPON_CODES } from './coupon-validation';
export type { CouponValidation } from './coupon-validation';
export { maxInstallmentsFor } from './capabilities';
export type {
  CheckoutTotals,
  CheckoutNext,
  CheckoutV2Response,
  CheckoutErrorKey,
  AppliedCoupon,
  CheckoutCustomer,
  CartDoorItem,
  StartCartCheckoutInput,
  StartFunnelCheckoutInput,
  StartCheckoutInput,
  StartCheckoutResult,
  CheckoutCapabilities,
  InstallmentRule,
  OrderItemThin,
  OrderThin,
  OrderFull,
  ThankYouState,
  ThankYouResult,
} from './types';
