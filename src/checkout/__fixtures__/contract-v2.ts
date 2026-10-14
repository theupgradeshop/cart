// TYPED FROM SPEC (template-checkout SPEC rev4, U1/U2); replace with a recording of a real U1 v2 response before U4's end-to-end run.
import type { CheckoutV2Response, OrderFull, OrderThin } from '../types';

export const ORDER_ID = '3f1c2b7e-6a41-4d2a-9c1e-0a5b7d9e1f42';

const totals = { subtotal: 100, discount: 0, shipping: 0, total: 100, currency: 'ILS' };

export const payResponse: CheckoutV2Response = {
  orderId: ORDER_ID,
  orderNumber: 'O-10001',
  totals,
  ownershipToken: 'own.tok.en',
  next: { kind: 'pay', url: `https://app.example.test/pay/order/${ORDER_ID}?p=pay.tok.en` },
};

export const noneResponse: CheckoutV2Response = {
  orderId: ORDER_ID,
  orderNumber: 'O-10002',
  totals: { ...totals, subtotal: 0, total: 0 },
  ownershipToken: 'own.tok.en',
  next: { kind: 'none' },
};

export const funnelPayResponse: CheckoutV2Response = { ...payResponse, funnelNextUrl: '/f/next-step' };

/** One error body per code U1 v2 can answer, with its HTTP status. */
export const errorBodies: Array<{ status: number; body: { error: string; code?: string; items?: string[] }; key: string }> = [
  { status: 400, body: { error: 'x', code: 'invalid_request' }, key: 'invalid_request' },
  { status: 400, body: { error: 'x', code: 'prerequisite_missing' }, key: 'prerequisite_missing' },
  { status: 400, body: { error: 'x', code: 'cohort_unavailable' }, key: 'cohort_unavailable' },
  { status: 400, body: { error: 'x', code: 'cohort_dates_unavailable' }, key: 'cohort_dates_unavailable' },
  { status: 400, body: { error: 'x', code: 'cohort_identity_registered' }, key: 'cohort_identity_registered' },
  { status: 400, body: { error: 'x', code: 'coupon_limit_reached' }, key: 'coupon_limit_reached' },
  { status: 404, body: { error: 'x', code: 'order_not_found' }, key: 'order_not_found' },
  { status: 400, body: { error: 'x', code: 'module_disabled' }, key: 'module_disabled' },
  { status: 502, body: { error: 'x', code: 'gateway_not_configured' }, key: 'gateway_not_configured' },
  { status: 500, body: { error: 'x', code: 'unsupported_provider' }, key: 'unsupported_provider' },
  { status: 500, body: { error: 'x', code: 'generic' }, key: 'generic' },
  { status: 400, body: { error: 'x', code: 'coupon_invalid' }, key: 'coupon_invalid' },
  { status: 400, body: { error: 'x', code: 'product_unavailable', items: ['p'] }, key: 'product_unavailable' },
  { status: 400, body: { error: 'x', code: 'subscription_unavailable' }, key: 'subscription_unavailable' },
  { status: 400, body: { error: 'x', code: 'invalid_return_url' }, key: 'invalid_return_url' },
  { status: 503, body: { error: 'x', code: 'payment_unavailable' }, key: 'payment_unavailable' },
  { status: 400, body: { error: 'x', code: 'upsell_unavailable' }, key: 'upsell_unavailable' },
  { status: 400, body: { error: 'x', code: 'installments_unavailable' }, key: 'installments_unavailable' },
  { status: 429, body: { error: 'Too many requests' }, key: 'rate_limited' },
  { status: 400, body: { error: 'Domain is required' }, key: 'generic' },
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
