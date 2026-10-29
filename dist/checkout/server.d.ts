/**
 * Types of the headless checkout (`@upgradeshop/cart/checkout`).
 *
 * The wire shapes follow the template-checkout contract (customer-websites-6f52, units U1/U2):
 * a v2 mode ("contract": 2) of the two cart doors, and the public order GET. The package
 * carries no visitor words: every error is a stable key the site renders in its own words.
 */
interface CheckoutTotals {
    subtotal: number;
    discount: number;
    shipping: number;
    total: number;
    currency: string;
}
/** `display: "redirect"` (optional, only that value): the dashboard asks for a full-page redirect instead of the pay pop-up. */
type CheckoutNext = {
    kind: 'none';
} | {
    kind: 'pay';
    url: string;
    display?: 'redirect';
};
/** 200 body of both doors in v2 (closed shape). */
interface CheckoutV2Response {
    orderId: string;
    orderNumber: string;
    totals: CheckoutTotals;
    ownershipToken: string;
    next: CheckoutNext;
    /** Funnel door only: the funnel's next step, for the site's thank-you page. Never a payment return. */
    funnelNextUrl?: string | null;
}
/** Stable keys the site maps to its own words. The package never renders them. */
type CheckoutErrorKey = 'generic' | 'invalid_request' | 'order_not_found' | 'module_disabled' | 'gateway_not_configured' | 'unsupported_provider' | 'prerequisite_missing' | 'cohort_unavailable' | 'cohort_dates_unavailable' | 'cohort_identity_registered' | 'coupon_limit_reached' | 'coupon_invalid'
/** DC13: the new code cannot be combined with the codes already applied (the error also carries `couponCode`, `conflictsWith`, `coupons`). */
 | 'coupon_not_combinable'
/** DC13: more codes than one order may carry (5). */
 | 'too_many_coupons' | 'product_unavailable' | 'subscription_unavailable' | 'invalid_return_url' | 'payment_unavailable' | 'upsell_unavailable' | 'installments_unavailable'
/** A physical order without a usable shipping address (dashboard follow-up, not yet emitted). */
 | 'shipping_address_required'
/** HTTP 429 from the door. */
 | 'rate_limited'
/** The request never got an answer (offline, DNS, CORS). */
 | 'network';
interface CheckoutCustomer {
    email: string;
    firstName: string;
    lastName?: string;
    phone?: string;
    company?: string;
}
interface CartDoorItem {
    productSlug: string;
    quantity: number;
    variantId?: string;
    occurrenceId?: string;
    addonProductIds?: string[];
}
/** Fields both doors take. Every site value is a parameter: nothing here has a default. */
interface StartCheckoutShared {
    /** The site's domain, as the dashboard knows it (cart door only on the wire). */
    domain: string;
    /** Dashboard base URL (the site's NEXT_PUBLIC_PLATFORM_URL). Required: this is the money path, nothing is assumed. */
    apiBaseUrl: string;
    /** With several codes this is the FIRST applied code (a pre-DC13 dashboard applies only it). */
    couponCode?: string;
    /** DC13: every applied code, in applied order. Sent ONLY for 2 or more codes (one code keeps today's body); `couponCode` stays the first. */
    couponCodes?: string[];
    shippingAddress?: Record<string, unknown>;
    /**
     * Absolute https URL on the site's own origin. It must name the same page as `thankYouPath`:
     * a paid order lands on `successUrl?orderId=`, a free one on `thankYouPath?orderId=`.
     */
    successUrl: string;
    /** Absolute https URL on the site's own origin: the checkout with the cart intact. */
    cancelUrl: string;
    /** The site's thank-you route (same page as `successUrl`). Used when the order is free (`next.kind === "none"`). */
    thankYouPath: string;
    /** Test seam / custom navigation. Defaults to `window.location.assign`. */
    navigate?: (url: string) => void;
}
interface StartCartCheckoutInput extends StartCheckoutShared {
    door: 'cart';
    customer: CheckoutCustomer;
    items: CartDoorItem[];
    language?: string;
    marketingConsent?: boolean;
    /** Sent only when greater than 1. */
    selectedInstallments?: number;
}
interface StartFunnelCheckoutInput extends StartCheckoutShared {
    door: 'funnel';
    stepId: string;
    email: string;
    name?: string;
    phone?: string;
    utms?: Record<string, string>;
    sessionId?: string;
    visitorId?: string;
}
type StartCheckoutInput = StartCartCheckoutInput | StartFunnelCheckoutInput;
interface StartCheckoutResult {
    orderId: string;
    orderNumber: string;
    totals: CheckoutTotals;
    next: CheckoutNext;
    funnelNextUrl?: string | null;
}
/** One installment rule: from `minAmount` (inclusive, order total) up to `maxPayments` payments. */
interface InstallmentRule {
    minAmount: number;
    maxPayments: number;
}
interface CheckoutCapabilities {
    available: boolean;
    installmentsMax: number;
    /** Amount-based limits; getCheckoutCapabilities always returns it ([] when the store has none). Use `maxInstallmentsFor(total, capabilities)`. */
    installmentRules?: InstallmentRule[];
}
/** GET /api/public/orders/[orderId], the thin shape (no valid ownership token). */
interface OrderItemThin {
    id: string;
    productId: string | null;
    productName: string;
    productSlug: string | null;
    quantity: number;
    price: number;
    total: number;
    isDigital: boolean;
    productType: string | null;
    fulfillmentStatus: string | null;
}
interface OrderThin {
    orderId: string;
    orderNumber: string;
    financialStatus: string;
    fulfillmentStatus: string | null;
    subtotal: number;
    total: number;
    currency: string;
    items: OrderItemThin[];
    paidAt: string | null;
    createdAt: string | null;
    /** Stable payment state code from the dashboard while the order is pending (e.g. "confirming", "delayed"); absent or null otherwise. */
    paymentState?: string | null;
    /** The buyer sentence for `paymentState`, translated by the dashboard (plain text). Show it as text, never as HTML. Null when `paymentState` is. */
    paymentMessage?: string | null;
}
/** The full shape (valid ownership token): PII and download links. */
interface OrderFull extends Omit<OrderThin, 'items'> {
    customerEmail: string | null;
    customerName: string | null;
    customerPhone: string | null;
    items: Array<OrderItemThin & {
        downloadUrl: string | null;
        downloadUrls: string[] | null;
        downloadExpiresAt: string | null;
    }>;
}
type ThankYouState = 
/** financialStatus "paid". */
'paid'
/** financialStatus "failed" or "cancelled". */
 | 'declined'
/** financialStatus "refunded". */
 | 'refunded'
/** Polling ended while still pending (cap reached, or a 429): "we have not received your payment yet". */
 | 'not_received'
/** The order does not exist for this domain. */
 | 'not_found';
interface ThankYouResult {
    state: ThankYouState;
    order: OrderThin | OrderFull | null;
    /** True when the full shape (ownership token accepted) came back. */
    full: boolean;
    /** Requests made, for the 12-request cap. */
    requests: number;
    /** From the latest response, present only when the dashboard sent a non-null `paymentState` (a pending order that polling gave up on, or a terminal `declined` answer). */
    paymentState?: string;
    /** The dashboard's buyer sentence for `paymentState` (plain text), present only with it and only when non-empty. */
    paymentMessage?: string;
}

/**
 * `GET /api/public/checkout-settings` -> `payments{available, installmentsMax, installmentRules}`.
 * Any failure (or an older dashboard without `payments`) reads as not available, so a visitor
 * never sees a buy button that cannot work. A request that hangs past `timeoutMs` (default 5000) reads the same way. Safe to call from a Server Component.
 */
declare function getCheckoutCapabilities(domain: string, apiBaseUrl: string, timeoutMs?: number): Promise<CheckoutCapabilities>;
/**
 * The most payments a visitor may choose, mirroring the dashboard's own resolution at the gateway level.
 * `total` is the post-coupon, post-shipping order total in major units; it is rounded (Math.round) as the
 * checkout door does. No rules: `installmentsMax`. With rules: the rule with the HIGHEST `minAmount` that the
 * total reaches decides (ties keep the original array order, first wins), with NO cap by `installmentsMax`;
 * no rule reached, or a total that is not finite, gives 1. Per-product limits are not known to the site, so it never offers more than this
 * gateway-level number. Pure and server-safe.
 */
declare function maxInstallmentsFor(total: number, capabilities: Pick<CheckoutCapabilities, 'installmentsMax'> & {
    installmentRules?: InstallmentRule[];
}): number;

/** POST body for the cart door (`/api/public/checkout`, contract 2). */
declare function buildCartDoorBody(input: StartCartCheckoutInput): {
    contract: number;
    domain: string;
    customer: {
        email: string;
        firstName: string;
        lastName?: string;
        phone?: string;
        company?: string;
    };
    items: {
        productSlug: string;
        quantity: number;
        variantId?: string;
        occurrenceId?: string;
        addonProductIds?: string[];
    }[];
    couponCode: string | undefined;
    couponCodes: string[] | undefined;
    language: string | undefined;
    marketingConsent: boolean | undefined;
    shipping_address: Record<string, unknown> | undefined;
    selectedInstallments: number | undefined;
    successUrl: string;
    cancelUrl: string;
};
/** POST body for the funnels door (`/api/public/funnels/checkout`, contract 2). */
declare function buildFunnelDoorBody(input: StartFunnelCheckoutInput): {
    contract: number;
    stepId: string;
    email: string;
    name: string | undefined;
    phone: string | undefined;
    couponCode: string | undefined;
    couponCodes: string[] | undefined;
    shipping_address: Record<string, unknown> | undefined;
    utms: Record<string, string> | undefined;
    session_id: string | undefined;
    visitor_id: string | undefined;
    successUrl: string;
    cancelUrl: string;
};

/** Every key a site must have a sentence for. */
declare const CHECKOUT_ERROR_KEYS: readonly CheckoutErrorKey[];
/**
 * A failed checkout. `key` is stable and is the only thing the site should branch on.
 * The server's own message text is deliberately not carried: it can name internals,
 * and the visitor's words belong to the site.
 */
declare const BRAND: unique symbol;
/**
 * True for a CheckoutError from ANY entry of this package. The client and server entries each
 * bundle their own copy of the class, so `instanceof` can disagree across them; this does not.
 */
declare function isCheckoutError(e: unknown): e is CheckoutError;
interface CheckoutCouponRefusal {
    couponCode?: string;
    conflictsWith?: string[];
    coupons?: Array<{
        code: string;
        discount: number;
    }>;
}
declare class CheckoutError extends Error {
    readonly [BRAND] = true;
    readonly key: CheckoutErrorKey;
    readonly status: number;
    /** `product_unavailable` only: the slugs of the failing products, so the cart can mark the line. */
    readonly items?: string[];
    /** Coupon refusals (`coupon_not_combinable`, `too_many_coupons`, `coupon_invalid`, `coupon_limit_reached`): the code the server refused. */
    readonly couponCode?: string;
    /** Coupon refusals: the applied codes the refused one clashes with. */
    readonly conflictsWith?: string[];
    /** Coupon refusals: the codes the server kept applied (typed before the refused one), with their shares. Never the server's sentence. */
    readonly coupons?: Array<{
        code: string;
        discount: number;
    }>;
    constructor(key: CheckoutErrorKey, status: number, items?: string[], coupon?: CheckoutCouponRefusal);
}
/** Maps an error body `{ code }` and the HTTP status to a stable key. Unknown codes are `generic`. */
declare function checkoutErrorKey(status: number, code: unknown): CheckoutErrorKey;

export { CHECKOUT_ERROR_KEYS, type CartDoorItem, type CheckoutCapabilities, type CheckoutCustomer, CheckoutError, type CheckoutErrorKey, type CheckoutNext, type CheckoutTotals, type CheckoutV2Response, type InstallmentRule, type OrderFull, type OrderItemThin, type OrderThin, type StartCartCheckoutInput, type StartCheckoutInput, type StartCheckoutResult, type StartFunnelCheckoutInput, type ThankYouResult, type ThankYouState, buildCartDoorBody, buildFunnelDoorBody, checkoutErrorKey, getCheckoutCapabilities, isCheckoutError, maxInstallmentsFor };
