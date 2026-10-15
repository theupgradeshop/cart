import type { CheckoutNext, CheckoutTotals, CheckoutV2Response } from './types';

function isFiniteNumber(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}

/** https, or http only for localhost (dev). Anything else, including javascript:, is refused. */
export function isSafeNavigationUrl(u: unknown): u is string {
  if (typeof u !== 'string' || !u) return false;
  try {
    const p = new URL(u);
    return p.protocol === 'https:' || (p.protocol === 'http:' && p.hostname === 'localhost');
  } catch {
    return false;
  }
}

/**
 * A site-relative path ("/x", same origin once resolved) or an http(s) URL. Whitespace and control
 * characters are refused anywhere: browsers strip tab/CR/LF, so "/\t/evil.test" would become "//evil.test".
 */
export function isSafeFunnelNextUrl(u: string): boolean {
  if (/[\u0000-\u0020\u007f]/.test(u)) return false;
  if (u.startsWith('/')) {
    try {
      return new URL(u, 'https://x.invalid').origin === 'https://x.invalid';
    } catch {
      return false;
    }
  }
  try {
    const p = new URL(u);
    return p.protocol === 'https:' || p.protocol === 'http:';
  } catch {
    return false;
  }
}

function parseTotals(t: unknown): CheckoutTotals | null {
  if (!t || typeof t !== 'object') return null;
  const r = t as Record<string, unknown>;
  if (
    !isFiniteNumber(r.subtotal) ||
    !isFiniteNumber(r.discount) ||
    !isFiniteNumber(r.shipping) ||
    !isFiniteNumber(r.total) ||
    r.total < 0 ||
    typeof r.currency !== 'string' ||
    !r.currency
  ) {
    return null;
  }
  return { subtotal: r.subtotal, discount: r.discount, shipping: r.shipping, total: r.total, currency: r.currency };
}

/**
 * Checks a v2 200 body and REBUILDS it with only the contract's fields (no server extras pass through).
 * Returns null for anything off-contract, which the caller treats as a generic failure.
 * An unsafe `funnelNextUrl` does not fail the checkout (the order already exists): it becomes null.
 */
export function parseV2Response(x: unknown): CheckoutV2Response | null {
  if (!x || typeof x !== 'object') return null;
  const r = x as Record<string, unknown>;
  if (typeof r.orderId !== 'string' || !r.orderId) return null;
  if (typeof r.orderNumber !== 'string') return null;
  if (typeof r.ownershipToken !== 'string' || !r.ownershipToken) return null;
  const totals = parseTotals(r.totals);
  if (!totals) return null;
  const n = r.next as Record<string, unknown> | null | undefined;
  if (!n || typeof n !== 'object') return null;
  let next: CheckoutNext;
  if (n.kind === 'pay') {
    if (!isSafeNavigationUrl(n.url)) return null;
    // Only "redirect" passes through; any other display value is dropped like every server extra (the order already exists, so it must not fail the checkout).
    next = n.display === 'redirect' ? { kind: 'pay', url: n.url, display: 'redirect' } : { kind: 'pay', url: n.url };
  } else if (n.kind === 'none') {
    next = { kind: 'none' };
  } else {
    return null;
  }
  const out: CheckoutV2Response = {
    orderId: r.orderId,
    orderNumber: r.orderNumber,
    totals,
    ownershipToken: r.ownershipToken,
    next,
  };
  if (r.funnelNextUrl !== undefined) {
    out.funnelNextUrl =
      typeof r.funnelNextUrl === 'string' && isSafeFunnelNextUrl(r.funnelNextUrl) ? r.funnelNextUrl : null;
  }
  return out;
}
