import { RefObject } from 'react';

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
type CheckoutErrorKey = 'generic' | 'invalid_request' | 'order_not_found' | 'module_disabled' | 'gateway_not_configured' | 'unsupported_provider' | 'prerequisite_missing' | 'cohort_unavailable' | 'cohort_dates_unavailable' | 'cohort_identity_registered' | 'coupon_limit_reached' | 'coupon_invalid' | 'product_unavailable' | 'subscription_unavailable' | 'invalid_return_url' | 'payment_unavailable' | 'upsell_unavailable' | 'installments_unavailable'
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
    couponCode?: string;
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
}

/**
 * Starts a checkout on either door. A paid order stores the ownership token (sessionStorage, keyed
 * by orderId) and navigates to the pay URL; a free order stores it too and goes to the site's
 * thank-you route. Throws CheckoutError with a stable key on any failure; a 200 body that is not
 * the closed v2 shape (or carries an unsafe URL) is a generic failure: no token stored, no navigation.
 */
declare function startCheckout(input: StartCheckoutInput): Promise<StartCheckoutResult>;

declare const POLL_INTERVAL_MS = 4000;
/** 12 requests per visit, inside the orders route's 30 per 15 minutes (a reload adds up to 12 more). */
declare const POLL_MAX_REQUESTS = 12;
/**
 * `financialStatus` values after which the order will not change by itself.
 * `partially_paid` is deliberately NOT terminal: it only comes from manual payments, never from a
 * template checkout, and if it ever shows up the page keeps polling and ends in `not_received`.
 */
declare const TERMINAL_FINANCIAL_STATUSES: readonly string[];
interface GetOrderForThankYouOptions {
    domain: string;
    /** Dashboard base URL. Required: nothing is assumed on the money path. */
    apiBaseUrl: string;
    /** Called after each non-terminal answer, so the page can keep showing "confirming". */
    onUpdate?: (order: OrderThin | OrderFull) => void;
    /** Called once when a terminal PAID status is seen: the site clears its cart (and pending coupon) here. */
    onPaid?: (order: OrderThin | OrderFull) => void;
    /** Stops polling (component unmount). An aborted run never clears the token, never calls onPaid and never returns a terminal state. */
    signal?: AbortSignal;
    /** Keep the ownership token after a terminal status (the pay pop-up navigates to the thank-you page, which still needs it). Default false. */
    keepToken?: boolean;
}
/**
 * Reads the order for the thank-you page. With a stored ownership token the full shape comes back;
 * without one (another tab or device) the thin shape (number, items, total, status). While the status
 * is not terminal it polls every 4 s, at most 12 requests. The token is sent as `Authorization: Bearer`. A 429 is non-terminal and ends polling in
 * `not_received`. The token is cleared only after a terminal status. `onPaid` fires only on `paid`.
 */
declare function getOrderForThankYou(orderId: string, opts: GetOrderForThankYouOptions): Promise<ThankYouResult>;

interface UseThankYouOrderOptions {
    domain: string;
    /** Dashboard base URL. Required: nothing is assumed on the money path. */
    apiBaseUrl: string;
    /** Fires once on a terminal PAID status: clear the cart and the pending coupon here. */
    onPaid?: (order: OrderThin | OrderFull) => void;
}
type UseThankYouOrderResult = {
    status: 'confirming';
    order: OrderThin | OrderFull | null;
} | ({
    status: 'done';
} & ThankYouResult);
/** Drives the thank-you page: `confirming` while polling, then `done` with one of the states. */
declare function useThankYouOrder(orderId: string | null, opts: UseThankYouOrderOptions): UseThankYouOrderResult;

/** The optional signal the dashboard pay page may post to its parent. Anything else is ignored. */
interface PayFrameMessage {
    type: 'tus-payment';
    status: 'paid' | 'cancelled';
    orderId: string;
}
interface UsePayFrameOptions {
    orderId: string;
    /** `next.url` of the checkout answer: the dashboard pay page shown in the iframe. */
    payUrl: string;
    /** Absolute URL of the site's thank-you page (same value passed to startCheckout). May carry its own query. */
    successUrl: string;
    /** Absolute URL of the site's checkout (same value passed to startCheckout). */
    cancelUrl: string;
    domain: string;
    /** Dashboard base URL (same as getOrderForThankYou). */
    apiBaseUrl: string;
    /** The pop-up is shown. Nothing runs while false. */
    open: boolean;
    /** The visitor reached the cancel URL (or the pay page said cancelled): the component closes the pop-up and leaves the cart alone. */
    onCancelled?: () => void;
    /** close() was called. */
    onClose?: () => void;
    /** Test seam / custom navigation of the TOP window. Defaults to `window.location.assign`. */
    navigateTop?: (url: string) => void;
}
interface UsePayFrameResult {
    /** Attach to the iframe: `ref={frameRef}`. */
    frameRef: RefObject<HTMLIFrameElement>;
    /** Call from the iframe's `onLoad`. Same-origin success / cancel URLs are detected; a cross-origin frame is ignored. */
    onFrameLoad: () => void;
    /** Stops polling and the message listener, then calls onClose. Close = Back: nothing else changes. */
    close: () => void;
}
/**
 * Behaviour of the payment pop-up (no visuals, no visitor words). The component renders the iframe
 * (`src={payUrl}`, `ref={frameRef}`, `onLoad={onFrameLoad}`) and a Back button calling `close()`.
 * While `open`:
 *  1. on each iframe load, a same-origin frame at the success page with this orderId navigates the TOP
 *     window to it; at the cancel page it calls onCancelled (a cross-origin read throws and is ignored);
 *  2. the order is polled with getOrderForThankYou (ownership token, 4 s, at most 12 requests, then it
 *     stops by itself); `paid` navigates the top window to `successUrl?orderId=`. The token is kept
 *     because the thank-you page still needs it;
 *  3. a `message` event is accepted only from the pay page's origin, shape
 *     `{type:"tus-payment", status, orderId}` for this orderId: paid navigates, cancelled calls onCancelled.
 * Everything stops on close, on a first outcome and on unmount.
 */
declare function usePayFrame(opts: UsePayFrameOptions): UsePayFrameResult;
/**
 * For a page that may be rendered inside the pop-up frame (the cancel page): when framed by a
 * same-origin top window, loads this page in the top window instead. No-op when not framed, when the
 * top is cross-origin, or when anything throws.
 */
declare function breakOutOfFrame(): void;

interface LinkCouponLine {
    slug: string;
    quantity?: number;
    /** The price the checkout charges for this line. */
    price: number;
}
interface UseLinkCouponOptions {
    domain: string;
    /** Dashboard base URL. Required: nothing is assumed on the money path. */
    apiBaseUrl: string;
    lines: LinkCouponLine[];
    subtotal: number;
    /** False until the lines and prices are final (cart loaded, prices fetched). */
    ready: boolean;
    /** A coupon is already applied. */
    appliedCode: string;
    /** The visitor has typed into the coupon box: never overridden. */
    hasTypedText: boolean;
    /** True while the form is still being filled in; false once submitted: never applied after submit. */
    collecting: boolean;
    /** The site's `readPendingCoupon` (template `lib/coupon-link.ts`). */
    readPending: () => {
        code: string;
    } | null;
    /** Called with the code the dashboard returned and the discount amount, only for a valid coupon. */
    onApply: (applied: {
        code: string;
        discountAmount: number;
    }) => void;
}
/**
 * The link-coupon recipe (template CLAUDE.md "Coupon in a link"): read the pending code, validate it
 * with the normal coupon call, apply it only if valid, never over an applied coupon or typed text,
 * never after submit. The pending code is NOT cleared here: a cancel-return (or the gateway's Back)
 * must re-apply it. The site clears it on remove, on a successful manual apply and on a paid
 * thank-you (`onPaid`). The pending code is untrusted input; only the code the dashboard returns
 * reaches `onApply`.
 */
declare function useLinkCoupon(o: UseLinkCouponOptions): void;

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
declare class CheckoutError extends Error {
    readonly [BRAND] = true;
    readonly key: CheckoutErrorKey;
    readonly status: number;
    /** `product_unavailable` only: the slugs of the failing products, so the cart can mark the line. */
    readonly items?: string[];
    constructor(key: CheckoutErrorKey, status: number, items?: string[]);
}
/** Maps an error body `{ code }` and the HTTP status to a stable key. Unknown codes are `generic`. */
declare function checkoutErrorKey(status: number, code: unknown): CheckoutErrorKey;

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
    shipping_address: Record<string, unknown> | undefined;
    utms: Record<string, string> | undefined;
    session_id: string | undefined;
    visitor_id: string | undefined;
    successUrl: string;
    cancelUrl: string;
};

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

export { CHECKOUT_ERROR_KEYS, type CartDoorItem, type CheckoutCapabilities, type CheckoutCustomer, CheckoutError, type CheckoutErrorKey, type CheckoutNext, type CheckoutTotals, type CheckoutV2Response, type GetOrderForThankYouOptions, type InstallmentRule, type LinkCouponLine, type OrderFull, type OrderItemThin, type OrderThin, POLL_INTERVAL_MS, POLL_MAX_REQUESTS, type PayFrameMessage, type StartCartCheckoutInput, type StartCheckoutInput, type StartCheckoutResult, type StartFunnelCheckoutInput, TERMINAL_FINANCIAL_STATUSES, type ThankYouResult, type ThankYouState, type UseLinkCouponOptions, type UsePayFrameOptions, type UsePayFrameResult, type UseThankYouOrderOptions, type UseThankYouOrderResult, breakOutOfFrame, buildCartDoorBody, buildFunnelDoorBody, checkoutErrorKey, getOrderForThankYou, isCheckoutError, maxInstallmentsFor, startCheckout, useLinkCoupon, usePayFrame, useThankYouOrder };
