// Checkout-contract fixtures. The checkout answers come from RECORDINGS of the real dashboard (./recorded-u1.ts);
// anything not recorded is marked "typed" below. The order GET shapes (orderThin/orderFull) are TYPED FROM SPEC, no recording yet.
import type { CheckoutV2Response, OrderFull, OrderThin } from '../types';
import {
  payRedirectGatewayA,
  freeResponse,
  funnelPayRecorded,
  errorCouponInvalid,
  errorProductUnavailable,
  errorInvalidReturnUrl,
  errorPaymentUnavailable,
} from './recorded-u1';

/** The ownership token placeholder the recordings carry. */
export const OWNERSHIP_TOKEN = payRedirectGatewayA.ownershipToken;
export const ORDER_ID = payRedirectGatewayA.orderId;

/** Recorded: a paid order (cart door) with a redirect to the pay page. */
export const payResponse: CheckoutV2Response = payRedirectGatewayA;
/** Recorded: a free order (cart door), next.kind "none". */
export const noneResponse: CheckoutV2Response = freeResponse;
/** Recorded: the funnels door (funnelNextUrl null). */
export const funnelPayResponse: CheckoutV2Response = funnelPayRecorded;
type ErrBody = { error: string; code?: string; items?: string[] };

/** One error body per code U1 v2 can answer, with its HTTP status. `recorded` false = typed from the spec. */
export const errorBodies: Array<{ status: number; body: ErrBody; key: string; recorded: boolean }> = [
  // recorded
  { ...errorCouponInvalid, key: 'coupon_invalid', recorded: true },
  { ...errorProductUnavailable, key: 'product_unavailable', recorded: true },
  { ...errorInvalidReturnUrl, key: 'invalid_return_url', recorded: true },
  { ...errorPaymentUnavailable, key: 'payment_unavailable', recorded: true },
  // typed from the spec (no recording)
  { status: 400, body: { error: 'x', code: 'invalid_request' }, key: 'invalid_request', recorded: false },
  { status: 400, body: { error: 'x', code: 'prerequisite_missing' }, key: 'prerequisite_missing', recorded: false },
  { status: 400, body: { error: 'x', code: 'cohort_unavailable' }, key: 'cohort_unavailable', recorded: false },
  { status: 400, body: { error: 'x', code: 'cohort_dates_unavailable' }, key: 'cohort_dates_unavailable', recorded: false },
  { status: 400, body: { error: 'x', code: 'cohort_identity_registered' }, key: 'cohort_identity_registered', recorded: false },
  { status: 400, body: { error: 'x', code: 'coupon_limit_reached' }, key: 'coupon_limit_reached', recorded: false },
  { status: 404, body: { error: 'x', code: 'order_not_found' }, key: 'order_not_found', recorded: false },
  { status: 400, body: { error: 'x', code: 'module_disabled' }, key: 'module_disabled', recorded: false },
  { status: 502, body: { error: 'x', code: 'gateway_not_configured' }, key: 'gateway_not_configured', recorded: false },
  { status: 500, body: { error: 'x', code: 'unsupported_provider' }, key: 'unsupported_provider', recorded: false },
  { status: 500, body: { error: 'x', code: 'generic' }, key: 'generic', recorded: false },
  { status: 400, body: { error: 'x', code: 'subscription_unavailable' }, key: 'subscription_unavailable', recorded: false },
  { status: 400, body: { error: 'x', code: 'upsell_unavailable' }, key: 'upsell_unavailable', recorded: false },
  { status: 400, body: { error: 'x', code: 'installments_unavailable' }, key: 'installments_unavailable', recorded: false },
  { status: 400, body: { error: 'x', code: 'shipping_address_required' }, key: 'shipping_address_required', recorded: false },
  { status: 429, body: { error: 'Too many requests' }, key: 'rate_limited', recorded: false },
  { status: 400, body: { error: 'Domain is required' }, key: 'generic', recorded: false },
];

const item = {
  id: 'oi-1',
  productId: 'p-1',
  productName: 'Product',
  productSlug: 'product',
  quantity: 1,
  price: 100,
  total: 100,
  isDigital: true,
  productType: 'digital',
  fulfillmentStatus: 'unfulfilled',
};

function thin(financialStatus: string): OrderThin {
  return {
    orderId: ORDER_ID,
    orderNumber: 'O-10001',
    financialStatus,
    fulfillmentStatus: 'unfulfilled',
    subtotal: 100,
    total: 100,
    currency: 'ILS',
    items: [item],
    paidAt: financialStatus === 'paid' ? '2026-10-14T19:00:00.000Z' : null,
    createdAt: '2026-10-14T18:59:00.000Z',
  };
}

function full(financialStatus: string): OrderFull {
  return {
    ...thin(financialStatus),
    customerEmail: 'a@example.test',
    customerName: 'A B',
    customerPhone: null,
    items: [{ ...item, downloadUrl: null, downloadUrls: null, downloadExpiresAt: null }],
  };
}

export const orderThin = thin;
export const orderFull = full;
