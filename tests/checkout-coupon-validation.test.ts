import { describe, it, expect, vi, afterEach } from 'vitest';
import { buildCouponValidateBody, parseCouponValidation, startCheckout, CheckoutError, CHECKOUT_ERROR_KEYS } from '../src/checkout';

afterEach(() => { vi.unstubAllGlobals(); });

const rest = { domain: 'shop.test', items: [{ productSlug: 'p', quantity: 1, price: 100 }], subtotal: 100 };

describe('buildCouponValidateBody', () => {
  it('one code is today\'s { code, ...rest }, byte for byte', () => {
    expect(JSON.stringify(buildCouponValidateBody(['save10'], rest))).toBe(
      '{"code":"save10","domain":"shop.test","items":[{"productSlug":"p","quantity":1,"price":100}],"subtotal":100}',
    );
  });
  it('two or more: code is the first, codes carries all, new code last as given', () => {
    const b = buildCouponValidateBody(['A', 'B', 'new'], rest);
    expect(b.code).toBe('A');
    expect(b.codes).toEqual(['A', 'B', 'new']);
    expect(b.subtotal).toBe(100);
  });
  it('sends at most 5 and drops blanks', () => {
    expect(buildCouponValidateBody(['1', '2', '3', '4', '5', '6'], rest).codes).toEqual(['1', '2', '3', '4', '5']);
    expect(buildCouponValidateBody(['A', ' ', 'B'], rest).codes).toEqual(['A', 'B']);
    expect('codes' in buildCouponValidateBody(['A', ''], rest)).toBe(false);
  });
});

describe('parseCouponValidation', () => {
  it('one-code shape', () => {
    const r = parseCouponValidation(200, { valid: true, coupon: { code: 'SAVE10', allowFreeShipping: true, allowCombining: true }, discount: { amount: 10 } }, ['save10']);
    expect(r).toEqual({ kind: 'ok', applied: { coupons: [{ code: 'SAVE10', discount: 10, allowCombining: true }], total: 10, freeShipping: true } });
  });
  it('a missing allowCombining / allowFreeShipping reads as false', () => {
    const r = parseCouponValidation(200, { valid: true, coupon: { code: 'X' }, discount: { amount: 5 } }, ['x']);
    expect(r).toEqual({ kind: 'ok', applied: { coupons: [{ code: 'X', discount: 5, allowCombining: false }], total: 5, freeShipping: false } });
  });
  it('two-plus shape: rows, combined total, set-level free shipping', () => {
    const r = parseCouponValidation(200, {
      valid: true, coupons: [{ code: 'A', discount: 10, allowCombining: true }, { code: 'B', discount: 4.5, allowCombining: true }],
      discount: { amount: 14.5 }, allowFreeShipping: true, results: [],
    }, ['A', 'B']);
    expect(r).toEqual({ kind: 'ok', applied: { coupons: [{ code: 'A', discount: 10, allowCombining: true }, { code: 'B', discount: 4.5, allowCombining: true }], total: 14.5, freeShipping: true } });
  });
  it('a pre-DC13 route answering a 2-code request with the one-code shape: the set is that one coupon', () => {
    const r = parseCouponValidation(200, { valid: true, coupon: { code: 'A' }, discount: { amount: 3 } }, ['A', 'B']);
    expect(r.kind === 'ok' && r.applied.coupons.map((c) => c.code)).toEqual(['A']);
  });
  it('refusal keeps the server list, sentence, refused code and conflicts', () => {
    const r = parseCouponValidation(400, {
      valid: false, error: 'B can’t combine with A', code: 'coupon_not_combinable', couponCode: 'b', conflictsWith: ['A'],
      coupons: [{ code: 'A', discount: 10 }], results: [],
    }, ['A', 'B']);
    expect(r).toEqual({
      kind: 'refused', errorCode: 'coupon_not_combinable', refusedCode: 'b', conflictsWith: ['A'],
      message: 'B can’t combine with A', keep: [{ code: 'A', discount: 10, allowCombining: false }],
    });
  });
  it('a one-code refusal names no code (the response did not)', () => {
    const r = parseCouponValidation(400, { valid: false, error: 'expired', code: 'EXPIRED' }, ['old']);
    expect(r).toEqual({ kind: 'refused', errorCode: 'EXPIRED', message: 'expired', keep: [] });
  });
  it('never returns a code the response did not name, nor a refused code that was not sent', () => {
    const ok = parseCouponValidation(200, { valid: true, coupon: { code: 'REAL' }, discount: { amount: 1 } }, ['typed']);
    expect(ok.kind === 'ok' && ok.applied.coupons.map((c) => c.code)).toEqual(['REAL']);
    const many = parseCouponValidation(200, { valid: true, coupons: [{ code: 'A', discount: 1 }], discount: { amount: 1 } }, ['A', 'B']);
    expect(many.kind === 'ok' && many.applied.coupons.map((c) => c.code)).toEqual(['A']);
    const refused = parseCouponValidation(400, { valid: false, error: 'x', code: 'EXPIRED', couponCode: 'OTHER', coupons: [] }, ['A']);
    expect(refused.kind === 'refused' && refused.refusedCode).toBeUndefined();
  });
  it('429, 5xx, status 0, non-JSON and malformed answers are unreachable', () => {
    const body = { valid: false, error: 'x', code: 'RATE_LIMITED' };
    expect(parseCouponValidation(429, body, ['A'])).toEqual({ kind: 'unreachable' });
    expect(parseCouponValidation(500, { valid: false, code: 'INTERNAL_ERROR' }, ['A'])).toEqual({ kind: 'unreachable' });
    expect(parseCouponValidation(503, null, ['A'])).toEqual({ kind: 'unreachable' });
    expect(parseCouponValidation(0, null, ['A'])).toEqual({ kind: 'unreachable' });
    expect(parseCouponValidation(400, 'html', ['A'])).toEqual({ kind: 'unreachable' });
    expect(parseCouponValidation(200, { valid: true, coupon: { code: 'A' } }, ['A'])).toEqual({ kind: 'unreachable' });
    expect(parseCouponValidation(200, { valid: true, coupons: [], discount: { amount: 0 } }, ['A'])).toEqual({ kind: 'unreachable' });
  });
});

describe('startCheckout coupon refusals', () => {
  const input = {
    door: 'cart' as const, domain: 'shop.test', apiBaseUrl: 'https://api.test',
    customer: { email: 'a@example.test', firstName: 'A' }, items: [{ productSlug: 'p', quantity: 1 }],
    successUrl: 'https://shop.test/ty', cancelUrl: 'https://shop.test/c', thankYouPath: '/ty', navigate: vi.fn(),
  };
  const reply = (status: number, body: unknown) => vi.fn().mockResolvedValue({ ok: false, status, json: async () => body });

  it('400 coupon_not_combinable maps to its key and exposes the facts, not the sentence', async () => {
    vi.stubGlobal('fetch', reply(400, { error: 'server words', code: 'coupon_not_combinable', couponCode: 'B', conflictsWith: ['A'], coupons: [{ code: 'A', discount: 10 }, { code: 5 }] }));
    const e = await startCheckout({ ...input, couponCode: 'A', couponCodes: ['A', 'B'] }).catch((x) => x);
    expect(e).toBeInstanceOf(CheckoutError);
    expect(e.key).toBe('coupon_not_combinable');
    expect(e.couponCode).toBe('B');
    expect(e.conflictsWith).toEqual(['A']);
    expect(e.coupons).toEqual([{ code: 'A', discount: 10 }]);
    expect(e.message).toBe('coupon_not_combinable');
  });
  it('too_many_coupons maps to its key; other errors carry no coupon facts', async () => {
    vi.stubGlobal('fetch', reply(400, { error: 'x', code: 'too_many_coupons', coupons: [] }));
    const e = await startCheckout(input).catch((x) => x);
    expect(e.key).toBe('too_many_coupons');
    expect(e.coupons).toEqual([]);
    vi.stubGlobal('fetch', reply(400, { error: 'x', code: 'product_unavailable', coupons: [{ code: 'A', discount: 1 }] }));
    const p = await startCheckout(input).catch((x) => x);
    expect(p.coupons).toBeUndefined();
  });
  it('both keys are listed for the site to word', () => {
    expect(CHECKOUT_ERROR_KEYS).toContain('coupon_not_combinable');
    expect(CHECKOUT_ERROR_KEYS).toContain('too_many_coupons');
  });
  it('a 2-code checkout sends couponCode first plus couponCodes; one code sends no couponCodes', async () => {
    const f = reply(400, { error: 'x' });
    vi.stubGlobal('fetch', f);
    await startCheckout({ ...input, couponCode: 'A', couponCodes: ['A', 'B'] }).catch(() => {});
    const two = JSON.parse(f.mock.calls[0][1].body);
    expect(two.couponCode).toBe('A');
    expect(two.couponCodes).toEqual(['A', 'B']);
    await startCheckout({ ...input, couponCode: 'A' }).catch(() => {});
    expect('couponCodes' in JSON.parse(f.mock.calls[1][1].body)).toBe(false);
  });
});
