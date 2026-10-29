import { buildCartDoorBody, buildFunnelDoorBody } from './bodies';
import { CheckoutError, checkoutErrorKey } from './errors';
import type { CheckoutCouponRefusal } from './errors';
import { storeOwnershipToken } from './storage';
import { parseV2Response } from './validate';
import type { StartCheckoutInput, StartCheckoutResult } from './types';

const COUPON_KEYS: ReadonlySet<string> = new Set(['coupon_not_combinable', 'too_many_coupons', 'coupon_invalid', 'coupon_limit_reached']);

/** The coupon facts of a refusal body (codes and numbers only; the server's sentence is never carried). */
function couponRefusal(json: unknown): CheckoutCouponRefusal {
  const b = json && typeof json === 'object' ? (json as Record<string, unknown>) : {};
  const out: CheckoutCouponRefusal = {};
  if (typeof b.couponCode === 'string') out.couponCode = b.couponCode;
  if (Array.isArray(b.conflictsWith)) out.conflictsWith = b.conflictsWith.filter((c): c is string => typeof c === 'string');
  if (Array.isArray(b.coupons)) {
    out.coupons = b.coupons
      .filter((c): c is { code: string; discount: number } => !!c && typeof c.code === 'string' && typeof c.discount === 'number' && Number.isFinite(c.discount))
      .map((c) => ({ code: c.code, discount: c.discount }));
  }
  return out;
}

/** Inserts `orderId` before any #fragment. */
function thankYouUrl(thankYouPath: string, orderId: string): string {
  const hash = thankYouPath.indexOf('#');
  const path = hash === -1 ? thankYouPath : thankYouPath.slice(0, hash);
  const frag = hash === -1 ? '' : thankYouPath.slice(hash);
  const sep = path.includes('?') ? '&' : '?';
  return `${path}${sep}orderId=${encodeURIComponent(orderId)}${frag}`;
}

/**
 * Starts a checkout on either door. A paid order stores the ownership token (sessionStorage, keyed
 * by orderId) and navigates to the pay URL; a free order stores it too and goes to the site's
 * thank-you route. Throws CheckoutError with a stable key on any failure; a 200 body that is not
 * the closed v2 shape (or carries an unsafe URL) is a generic failure: no token stored, no navigation.
 */
export async function startCheckout(input: StartCheckoutInput): Promise<StartCheckoutResult> {
  const base = input.apiBaseUrl.replace(/\/+$/, '');
  const url = input.door === 'cart' ? `${base}/api/public/checkout` : `${base}/api/public/funnels/checkout`;
  const body = input.door === 'cart' ? buildCartDoorBody(input) : buildFunnelDoorBody(input);

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new CheckoutError('network', 0);
  }

  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    /* non-JSON body */
  }

  if (!res.ok) {
    const b = json && typeof json === 'object' ? (json as { code?: unknown; items?: unknown }) : {};
    const key = checkoutErrorKey(res.status, b.code);
    const items =
      key === 'product_unavailable' && Array.isArray(b.items) && b.items.every((i) => typeof i === 'string')
        ? (b.items as string[])
        : undefined;
    throw new CheckoutError(key, res.status, items, COUPON_KEYS.has(key) ? couponRefusal(json) : undefined);
  }
  const parsed = parseV2Response(json);
  if (!parsed) throw new CheckoutError('generic', res.status);
  const order = parsed;

  storeOwnershipToken(order.orderId, order.ownershipToken);

  const result: StartCheckoutResult = {
    orderId: order.orderId,
    orderNumber: order.orderNumber,
    totals: order.totals,
    next: order.next,
    ...(order.funnelNextUrl !== undefined ? { funnelNextUrl: order.funnelNextUrl } : {}),
  };

  const navigate = input.navigate ?? ((u: string) => window.location.assign(u));
  navigate(order.next.kind === 'pay' ? order.next.url : thankYouUrl(input.thankYouPath, order.orderId));
  return result;
}
