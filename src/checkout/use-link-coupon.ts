import { useEffect, useRef } from 'react';

export interface LinkCouponLine {
  slug: string;
  quantity?: number;
  /** The price the checkout charges for this line. */
  price: number;
}

export interface UseLinkCouponOptions {
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
  readPending: () => { code: string } | null;
  /** Called with the code the dashboard returned and the discount amount, only for a valid coupon. */
  onApply: (applied: { code: string; discountAmount: number }) => void;
}

/**
 * The link-coupon recipe (template CLAUDE.md "Coupon in a link"): read the pending code, validate it
 * with the normal coupon call, apply it only if valid, never over an applied coupon or typed text,
 * never after submit. The pending code is NOT cleared here: a cancel-return (or the gateway's Back)
 * must re-apply it. The site clears it on remove, on a successful manual apply and on a paid
 * thank-you (`onPaid`). The pending code is untrusted input; only the code the dashboard returns
 * reaches `onApply`.
 */
export function useLinkCoupon(o: UseLinkCouponOptions): void {
  const tried = useRef('');
  const latest = useRef(o);
  latest.current = o;

  const sig = o.ready ? `${o.lines.map((l) => `${l.slug}:${l.quantity ?? 1}:${l.price}`).join('|')}#${o.subtotal}` : '';

  useEffect(() => {
    if (!sig || o.appliedCode || o.hasTypedText || !o.collecting) return;
    const pending = o.readPending();
    if (!pending) return;
    const attempt = `${pending.code}@${sig}`;
    if (tried.current === attempt) return;
    tried.current = attempt;
    let cancelled = false;
    let delivered = false;
    const base = o.apiBaseUrl.replace(/\/+$/, '');
    (async () => {
      try {
        const res = await fetch(`${base}/api/public/coupons/validate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            domain: o.domain,
            code: pending.code,
            items: o.lines.map((l) => ({ productSlug: l.slug, quantity: l.quantity ?? 1, price: l.price })),
            subtotal: o.subtotal,
          }),
        });
        const data = await res.json();
        if (cancelled) return;
        delivered = true;
        const now = latest.current;
        if (now.appliedCode || now.hasTypedText || !now.collecting) return;
        if (data?.valid && typeof data.discount?.amount === 'number' && typeof data.coupon?.code === 'string') {
          now.onApply({ code: data.coupon.code, discountAmount: data.discount.amount });
        }
      } catch {
        /* keep pending, show nothing */
      }
    })();
    return () => {
      cancelled = true;
      if (!delivered) tried.current = '';
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, o.appliedCode, o.hasTypedText, o.collecting]);
}
