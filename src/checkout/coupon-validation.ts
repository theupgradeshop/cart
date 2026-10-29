/**
 * Pure helpers for the coupon preview call (`POST /api/public/coupons/validate`), shared by every site and by
 * `useLinkCoupon` (DC13, websites SPEC "Shared parser"). No fetch, no React, no visitor words: a refusal's `message`
 * is the dashboard's sentence in the buyer's language, for the site to show as text.
 */
import type { AppliedCoupon } from './types';

/** An order carries at most this many codes (the dashboard refuses a 6th). */
export const MAX_COUPON_CODES = 5;

/**
 * The preview request body. One code is today's `{ code, ...rest }`. Two or more are `{ code: codes[0], codes, ...rest }`:
 * `code` keeps a pre-DC13 route validating the first code instead of answering 400. `codes` are the applied codes in
 * applied order and the NEW code last, as given; at most 5 are sent. Blank entries are dropped.
 */
export function buildCouponValidateBody(codes: string[], rest: Record<string, unknown>): Record<string, unknown> {
  const list = codes.filter((c) => typeof c === 'string' && c.trim() !== '').slice(0, MAX_COUPON_CODES);
  if (list.length <= 1) return { code: list[0] ?? codes[0] ?? '', ...rest };
  return { code: list[0], codes: list, ...rest };
}

export type CouponValidation =
  | {
      kind: 'ok';
      /** Always the response's set, never the caller's list. `total` is the server's combined discount. */
      applied: { coupons: AppliedCoupon[]; total: number; freeShipping: boolean };
    }
  | {
      kind: 'refused';
      /** The dashboard's own reason code (`coupon_not_combinable`, `too_many_coupons`, `EXPIRED`, ...). */
      errorCode?: string;
      /** The code the response named as refused, only when it is one of the codes sent. */
      refusedCode?: string;
      conflictsWith?: string[];
      /** The dashboard's sentence, in the buyer's language. */
      message?: string;
      /** The coupons the dashboard kept applied (typed before the refused one). */
      keep: AppliedCoupon[];
    }
  | {
      /** Rate limited (>= 429), a server error (5xx), no usable answer, or an answer that is not the contract's: show nothing and keep the state. */
      kind: 'unreachable';
    };

const UNREACHABLE: CouponValidation = { kind: 'unreachable' };

function obj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function coupons(list: unknown, flag: (item: Record<string, unknown>) => boolean): AppliedCoupon[] | null {
  if (!Array.isArray(list)) return null;
  const out: AppliedCoupon[] = [];
  for (const raw of list) {
    const c = obj(raw);
    const discount = c ? num(c.discount) : null;
    if (!c || typeof c.code !== 'string' || !c.code || discount === null) return null;
    out.push({ code: c.code, discount, allowCombining: flag(c) });
  }
  return out;
}

/**
 * Reads the preview answer. `sentCodes` are the codes the request carried. The applied set is whatever the response
 * names (a code the response did not name is never returned): one-code shape `{ valid, coupon, discount }`, several-code
 * shape `{ valid, coupons[], discount.amount, allowFreeShipping }`. A missing `allowCombining` reads as false.
 */
export function parseCouponValidation(status: number, json: unknown, sentCodes: string[]): CouponValidation {
  if (!Number.isFinite(status) || status <= 0 || status >= 429) return UNREACHABLE;
  const b = obj(json);
  if (!b) return UNREACHABLE;

  if (status >= 200 && status < 300 && b.valid === true) {
    const total = num(obj(b.discount)?.amount);
    if (total === null) return UNREACHABLE;
    if (b.coupons !== undefined) {
      const list = coupons(b.coupons, (c) => c.allowCombining === true);
      if (!list || list.length === 0) return UNREACHABLE;
      return { kind: 'ok', applied: { coupons: list, total, freeShipping: b.allowFreeShipping === true } };
    }
    const coupon = obj(b.coupon);
    if (!coupon || typeof coupon.code !== 'string' || !coupon.code) return UNREACHABLE;
    return {
      kind: 'ok',
      applied: {
        coupons: [{ code: coupon.code, discount: total, allowCombining: coupon.allowCombining === true }],
        total,
        freeShipping: coupon.allowFreeShipping === true,
      },
    };
  }

  if (status >= 400 && status < 429 && b.valid !== true) {
    const sent = new Set(sentCodes.map((c) => c.trim().toUpperCase()));
    const out: Extract<CouponValidation, { kind: 'refused' }> = { kind: 'refused', keep: coupons(b.coupons, () => false) ?? [] };
    if (typeof b.code === 'string') out.errorCode = b.code;
    if (typeof b.couponCode === 'string' && sent.has(b.couponCode.trim().toUpperCase())) out.refusedCode = b.couponCode;
    if (Array.isArray(b.conflictsWith)) out.conflictsWith = b.conflictsWith.filter((c): c is string => typeof c === 'string');
    if (typeof b.error === 'string') out.message = b.error;
    return out;
  }
  return UNREACHABLE;
}
