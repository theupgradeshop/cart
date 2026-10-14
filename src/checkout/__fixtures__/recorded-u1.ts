// RECORDED, not typed: bodies and statuses copied from real staging answers of the dashboard's checkout contract.
// Values neutralised, shapes recorded: domains, product slugs, order ids and order numbers are placeholders; field names, nesting, types and statuses are as recorded.
// Placeholders (<ownershipToken>, <payToken>, buyer@example.com) come from the recording.
// Fixtures are named by role. Never put a gateway or provider name in this file or in a file name.
import type { CheckoutV2Response } from '../types';

export const RECORDED_FROM = 'dashboard c746c11b6';

/** recorded from staging, dashboard c746c11b6, cart-pay-<gateway>.json; request: POST /api/public/checkout */
export const payRedirectGatewayARequest = {
  contract: 2,
  domain: 'shop-a.example.com',
  customer: {
    email: 'buyer@example.com',
    firstName: 'Test',
    lastName: 'Buyer',
    phone: '+10000000000'
  },
  items: [
    {
      productSlug: 'product-a',
      quantity: 1
    }
  ],
  language: 'en',
  successUrl: 'https://shop-a.example.com/thank-you',
  cancelUrl: 'https://shop-a.example.com/checkout'
};
/** recorded from staging, dashboard c746c11b6, response of the same recording, status 200 */
export const payRedirectGatewayA: CheckoutV2Response = {
  orderId: '00000000-0000-4000-a000-000000000001',
  orderNumber: 'O-10001',
  totals: {
    subtotal: 85,
    discount: 0,
    shipping: 0,
    total: 85,
    currency: 'ILS'
  },
  ownershipToken: '<ownershipToken>',
  next: {
    kind: 'pay',
    url: 'https://app.example.com/pay/order/00000000-0000-4000-a000-000000000001?p=<payToken>'
  }
};

/** recorded from staging, dashboard c746c11b6, cart-pay-<gateway>.json; request: POST /api/public/checkout */
export const payRedirectGatewayBRequest = {
  contract: 2,
  domain: 'shop-c.example.com',
  customer: {
    email: 'buyer@example.com',
    firstName: 'Test',
    lastName: 'Buyer',
    phone: '+10000000000'
  },
  items: [
    {
      productSlug: 'product-b',
      quantity: 1
    }
  ],
  language: 'en',
  successUrl: 'https://shop-c.example.com/thank-you',
  cancelUrl: 'https://shop-c.example.com/checkout'
};
/** recorded from staging, dashboard c746c11b6, response of the same recording, status 200 */
export const payRedirectGatewayB: CheckoutV2Response = {
  orderId: '00000000-0000-4000-a000-000000000002',
  orderNumber: 'O-10002',
  totals: {
    subtotal: 20,
    discount: 0,
    shipping: 0,
    total: 20,
    currency: 'USD'
  },
  ownershipToken: '<ownershipToken>',
  next: {
    kind: 'pay',
    url: 'https://app.example.com/pay/order/00000000-0000-4000-a000-000000000002?p=<payToken>'
  }
};

/** recorded from staging, dashboard c746c11b6, cart-free.json; request: POST /api/public/checkout */
export const freeResponseRequest = {
  contract: 2,
  domain: 'shop-a.example.com',
  customer: {
    email: 'buyer@example.com',
    firstName: 'Test',
    lastName: 'Buyer',
    phone: '+10000000000'
  },
  items: [
    {
      productSlug: 'product-free',
      quantity: 1
    }
  ],
  language: 'en',
  successUrl: 'https://shop-a.example.com/thank-you',
  cancelUrl: 'https://shop-a.example.com/checkout'
};
/** recorded from staging, dashboard c746c11b6, response of the same recording, status 200 */
export const freeResponse: CheckoutV2Response = {
  orderId: '00000000-0000-4000-a000-000000000003',
  orderNumber: 'O-10003',
  totals: {
    subtotal: 0,
    discount: 0,
    shipping: 0,
    total: 0,
    currency: 'ILS'
  },
  ownershipToken: '<ownershipToken>',
  next: {
    kind: 'none'
  }
};

/** recorded from staging, dashboard c746c11b6, funnels-pay.json; request: POST /api/public/funnels/checkout */
export const funnelPayRecordedRequest = {
  contract: 2,
  stepId: '00000000-0000-4000-a000-000000000004',
  email: 'buyer@example.com',
  name: 'Test Buyer',
  phone: '+10000000000',
  successUrl: 'https://shop-a.example.com/thank-you',
  cancelUrl: 'https://shop-a.example.com/checkout'
};
/** recorded from staging, dashboard c746c11b6, response of the same recording, status 200 */
export const funnelPayRecorded: CheckoutV2Response = {
  orderId: '00000000-0000-4000-a000-000000000005',
  orderNumber: 'O-10001',
  totals: {
    subtotal: 85,
    discount: 0,
    shipping: 0,
    total: 85,
    currency: 'ILS'
  },
  ownershipToken: '<ownershipToken>',
  next: {
    kind: 'pay',
    url: 'https://app.example.com/pay/order/00000000-0000-4000-a000-000000000005?p=<payToken>'
  },
  funnelNextUrl: null
};

export interface RecordedError { status: number; body: { error: string; code: string; items?: string[] }; request: Record<string, unknown> }

/** recorded from staging, dashboard c746c11b6, error-coupon_invalid.json */
export const errorCouponInvalid: RecordedError = { status: 400, body: {
  error: 'קוד קופון לא תקין',
  code: 'coupon_invalid'
}, request: {
  contract: 2,
  domain: 'shop-b.example.com',
  customer: {
    email: 'buyer@example.com',
    firstName: 'Test',
    lastName: 'Buyer',
    phone: '+10000000000'
  },
  items: [
    {
      productSlug: 'product-c',
      quantity: 1
    }
  ],
  language: 'en',
  successUrl: 'https://shop-b.example.com/thank-you',
  cancelUrl: 'https://shop-b.example.com/checkout',
  couponCode: 'NOSUCHCODE9'
} };

/** recorded from staging, dashboard c746c11b6, error-product_unavailable.json */
export const errorProductUnavailable: RecordedError = { status: 400, body: {
  error: 'Products not found or inactive',
  code: 'product_unavailable',
  items: [
    'product-missing'
  ]
}, request: {
  contract: 2,
  domain: 'shop-b.example.com',
  customer: {
    email: 'buyer@example.com',
    firstName: 'Test',
    lastName: 'Buyer',
    phone: '+10000000000'
  },
  items: [
    {
      productSlug: 'product-missing',
      quantity: 1
    }
  ],
  language: 'en',
  successUrl: 'https://shop-b.example.com/thank-you',
  cancelUrl: 'https://shop-b.example.com/checkout'
} };

/** recorded from staging, dashboard c746c11b6, error-invalid_return_url.json */
export const errorInvalidReturnUrl: RecordedError = { status: 400, body: {
  error: "successUrl and cancelUrl must be absolute https URLs on this store's own site",
  code: 'invalid_return_url'
}, request: {
  contract: 2,
  domain: 'shop-b.example.com',
  customer: {
    email: 'buyer@example.com',
    firstName: 'Test',
    lastName: 'Buyer',
    phone: '+10000000000'
  },
  items: [
    {
      productSlug: 'product-c',
      quantity: 1
    }
  ],
  language: 'en',
  successUrl: 'https://evil.example.org/x',
  cancelUrl: 'https://shop-b.example.com/checkout'
} };

/** recorded from staging, dashboard c746c11b6, the payment_unavailable recording */
export const errorPaymentUnavailable: RecordedError = { status: 503, body: {
  error: 'Payment processing is not enabled for this store',
  code: 'payment_unavailable'
}, request: {
  contract: 2,
  domain: 'shop-b.example.com',
  customer: {
    email: 'buyer@example.com',
    firstName: 'Test',
    lastName: 'Buyer',
    phone: '+10000000000'
  },
  items: [
    {
      productSlug: 'product-c',
      quantity: 1
    }
  ],
  language: 'en',
  successUrl: 'https://shop-b.example.com/thank-you',
  cancelUrl: 'https://shop-b.example.com/checkout'
} };

/** Recorded checkout-settings answers keep only the `payments` object (the recording dropped the rest). */
/** recorded from staging, dashboard c746c11b6, checkout-settings-<gateway>.json; GET /api/public/checkout-settings */
export const settingsPayable = { payments: {
  available: true,
  installmentsMax: 1,
  installmentRules: []
} };

/** recorded from staging, dashboard c746c11b6, checkout-settings-<gateway>.json; GET /api/public/checkout-settings */
export const settingsNotAvailable = { payments: {
  available: false,
  installmentsMax: 1,
  installmentRules: []
} };

/** recorded from staging, dashboard c746c11b6, checkout-settings-<gateway>.json; GET /api/public/checkout-settings */
export const settingsPayableAlt = { payments: {
  available: true,
  installmentsMax: 1,
  installmentRules: []
} };

