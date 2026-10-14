import type { CheckoutErrorKey } from './types';

const KNOWN: ReadonlySet<string> = new Set<CheckoutErrorKey>([
  'generic',
  'invalid_request',
  'order_not_found',
  'module_disabled',
  'gateway_not_configured',
  'unsupported_provider',
  'prerequisite_missing',
  'cohort_unavailable',
  'cohort_dates_unavailable',
  'cohort_identity_registered',
  'coupon_limit_reached',
  'coupon_invalid',
  'product_unavailable',
  'subscription_unavailable',
  'invalid_return_url',
  'payment_unavailable',
  'upsell_unavailable',
  'installments_unavailable',
]);

/** Every key a site must have a sentence for. */
export const CHECKOUT_ERROR_KEYS: readonly CheckoutErrorKey[] = [...(KNOWN as Set<CheckoutErrorKey>), 'rate_limited', 'network'];

/**
 * A failed checkout. `key` is stable and is the only thing the site should branch on.
 * The server's own message text is deliberately not carried: it can name internals,
 * and the visitor's words belong to the site.
 */
const BRAND = Symbol.for('upgradeshop.checkout.error');

/**
 * True for a CheckoutError from ANY entry of this package. The client and server entries each
 * bundle their own copy of the class, so `instanceof` can disagree across them; this does not.
 */
export function isCheckoutError(e: unknown): e is CheckoutError {
  return typeof e === 'object' && e !== null && (e as Record<symbol, unknown>)[BRAND] === true;
}

export class CheckoutError extends Error {
  readonly [BRAND] = true;
  readonly key: CheckoutErrorKey;
  readonly status: number;
  /** `product_unavailable` only: the slugs of the failing products, so the cart can mark the line. */
  readonly items?: string[];

  constructor(key: CheckoutErrorKey, status: number, items?: string[]) {
    super(key);
    if (items) this.items = items;
    this.name = 'CheckoutError';
    this.key = key;
    this.status = status;
  }
}

/** Maps an error body `{ code }` and the HTTP status to a stable key. Unknown codes are `generic`. */
export function checkoutErrorKey(status: number, code: unknown): CheckoutErrorKey {
  if (status === 429) return 'rate_limited';
  if (typeof code === 'string' && KNOWN.has(code)) return code as CheckoutErrorKey;
  return 'generic';
}
