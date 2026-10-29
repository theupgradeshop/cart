import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useLinkCoupon, type UseLinkCouponOptions } from '../src/checkout';
import * as clientEntry from '../src/checkout';
import { getCheckoutCapabilities } from '../src/checkout/server';

afterEach(() => { vi.unstubAllGlobals(); });

describe('getCheckoutCapabilities', () => {
  const settings = (body: unknown, ok = true) =>
    vi.fn().mockResolvedValue({ ok, status: ok ? 200 : 500, json: async () => body });

  it('reads payments{available, installmentsMax}', async () => {
    const f = settings({ payments: { available: true, installmentsMax: 6 }, maxPayments: 1 });
    vi.stubGlobal('fetch', f);
    expect(await getCheckoutCapabilities('shop.test', 'https://api.test')).toEqual({ available: true, installmentsMax: 6, installmentRules: [] });
    expect(f.mock.calls[0][0]).toBe('https://api.test/api/public/checkout-settings?domain=shop.test');
  });
  it('not available, missing payments, failures: hidden', async () => {
    const none = { available: false, installmentsMax: 1, installmentRules: [] };
    vi.stubGlobal('fetch', settings({ payments: { available: false, installmentsMax: 3 } }));
    expect(await getCheckoutCapabilities('d', 'https://api.test')).toEqual(none);
    vi.stubGlobal('fetch', settings({ maxPayments: 3 }));
    expect(await getCheckoutCapabilities('d', 'https://api.test')).toEqual(none);
    vi.stubGlobal('fetch', settings({}, false));
    expect(await getCheckoutCapabilities('d', 'https://api.test')).toEqual(none);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('x')));
    expect(await getCheckoutCapabilities('d', 'https://api.test')).toEqual(none);
  });
  it('a request that hangs past the timeout reads as not available', async () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal('fetch', vi.fn((_u: string, init: RequestInit) => new Promise((_res, rej) => {
        init.signal!.addEventListener('abort', () => rej(new DOMException('aborted', 'TimeoutError')));
      })));
      const p = getCheckoutCapabilities('d', 'https://api.test', 1000);
      await vi.advanceTimersByTimeAsync(1001);
      expect(await p).toEqual({ available: false, installmentsMax: 1, installmentRules: [] });
      const q = getCheckoutCapabilities('d', 'https://api.test');
      await vi.advanceTimersByTimeAsync(4999);
      let settled = false;
      q.then(() => { settled = true; });
      await vi.advanceTimersByTimeAsync(0);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(2);
      expect(await q).toEqual({ available: false, installmentsMax: 1, installmentRules: [] });
    } finally {
      vi.useRealTimers();
    }
  });

  it('the client entry does not export getCheckoutCapabilities', () => {
    expect('getCheckoutCapabilities' in clientEntry).toBe(false);
  });

  it('installmentsMax is floored and at least 1', async () => {
    vi.stubGlobal('fetch', settings({ payments: { available: true, installmentsMax: 0 } }));
    expect((await getCheckoutCapabilities('d', 'https://api.test')).installmentsMax).toBe(1);
    vi.stubGlobal('fetch', settings({ payments: { available: true, installmentsMax: 3.9 } }));
    expect((await getCheckoutCapabilities('d', 'https://api.test')).installmentsMax).toBe(3);
  });
});

describe('useLinkCoupon (D5 recipe)', () => {
  const valid = { valid: true, coupon: { code: 'SAVE10' }, discount: { amount: 10 } };
  let f: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    f = vi.fn().mockResolvedValue({ json: async () => valid });
    vi.stubGlobal('fetch', f);
  });
  const base = (over: Partial<UseLinkCouponOptions> = {}): UseLinkCouponOptions => ({
    domain: 'shop.test',
    apiBaseUrl: 'https://api.test',
    lines: [{ slug: 'p', quantity: 1, price: 100 }],
    subtotal: 100,
    ready: true,
    appliedCode: '',
    hasTypedText: false,
    collecting: true,
    readPending: () => ({ code: 'save10' }),
    onApply: vi.fn(),
    ...over,
  });

  it('validates the pending code and applies the code the dashboard returned', async () => {
    const o = base();
    renderHook(() => useLinkCoupon(o));
    await waitFor(() => expect(o.onApply).toHaveBeenCalledWith({ code: 'SAVE10', discountAmount: 10 }));
    const [url, init] = f.mock.calls[0];
    expect(url).toBe('https://api.test/api/public/coupons/validate');
    expect(JSON.parse(init.body)).toEqual({
      domain: 'shop.test', code: 'save10', items: [{ productSlug: 'p', quantity: 1, price: 100 }], subtotal: 100,
    });
  });

  it('request bytes are the single-code bytes (domain, code, items, subtotal in this order)', async () => {
    const o = base();
    renderHook(() => useLinkCoupon(o));
    await waitFor(() => expect(f).toHaveBeenCalled());
    expect(f.mock.calls[0][1].body).toBe(
      '{"domain":"shop.test","code":"save10","items":[{"productSlug":"p","quantity":1,"price":100}],"subtotal":100}',
    );
  });

  it.each([429, 500])('a %s answer applies nothing', async (status) => {
    f.mockResolvedValue({ status, json: async () => ({ valid: false, error: 'x', code: 'RATE_LIMITED' }) });
    const o = base();
    renderHook(() => useLinkCoupon(o));
    await waitFor(() => expect(f).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 10));
    expect(o.onApply).not.toHaveBeenCalled();
  });

  it('does not clear the pending code after an auto-apply: a cancel-return re-applies it', async () => {
    const pending = { code: 'save10' };
    const readPending = vi.fn(() => pending);
    const o1 = base({ readPending });
    const first = renderHook(() => useLinkCoupon(o1));
    await waitFor(() => expect(o1.onApply).toHaveBeenCalledTimes(1));
    first.unmount();
    // cancel-return: a fresh mount of the checkout, nothing applied yet, the pending code still readable
    const o2 = base({ readPending });
    renderHook(() => useLinkCoupon(o2));
    await waitFor(() => expect(o2.onApply).toHaveBeenCalledWith({ code: 'SAVE10', discountAmount: 10 }));
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('an invalid code is not applied and stays pending', async () => {
    f.mockResolvedValue({ json: async () => ({ valid: false, error: 'x', code: 'NOT_FOUND' }) });
    const o = base();
    renderHook(() => useLinkCoupon(o));
    await waitFor(() => expect(f).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 10));
    expect(o.onApply).not.toHaveBeenCalled();
  });

  it.each([
    ['not ready', { ready: false }],
    ['a coupon already applied', { appliedCode: 'X' }],
    ['typed text in the box', { hasTypedText: true }],
    ['already submitted', { collecting: false }],
    ['no pending code', { readPending: () => null }],
  ])('does nothing with %s', async (_n, over) => {
    const o = base(over as Partial<UseLinkCouponOptions>);
    renderHook(() => useLinkCoupon(o));
    await new Promise((r) => setTimeout(r, 10));
    expect(f).not.toHaveBeenCalled();
    expect(o.onApply).not.toHaveBeenCalled();
  });

  it('never applies a result that lands after typing or submit', async () => {
    let release!: (v: unknown) => void;
    f.mockReturnValue(new Promise((r) => { release = r; }));
    let o = base();
    const { rerender } = renderHook(() => useLinkCoupon(o));
    await waitFor(() => expect(f).toHaveBeenCalled());
    o = { ...o, hasTypedText: true };
    rerender();
    release({ json: async () => valid });
    await new Promise((r) => setTimeout(r, 10));
    expect(o.onApply).not.toHaveBeenCalled();
  });
});

describe('server entry', () => {
  it('exports the server-safe parts and works without React', async () => {
    const m = await import('../src/checkout/server');
    expect(Object.keys(m).sort()).toEqual(
      ['CHECKOUT_ERROR_KEYS', 'CheckoutError', 'buildCartDoorBody', 'buildFunnelDoorBody', 'checkoutErrorKey', 'getCheckoutCapabilities', 'isCheckoutError', 'maxInstallmentsFor'],
    );
  });
});

import { maxInstallmentsFor } from '../src/checkout/server';
import * as serverEntry from '../src/checkout/server';
import {
  settingsPayable, settingsNotAvailable, settingsPayableAlt,
} from '../src/checkout/__fixtures__/recorded-u1';

describe('capabilities from recorded checkout-settings answers', () => {
  const settings = (body: unknown) => vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => body });
  it.each([
    ['payable', settingsPayable, { available: true, installmentsMax: 1, installmentRules: [] }],
    ['not available', settingsNotAvailable, { available: false, installmentsMax: 1, installmentRules: [] }],
    ['payable (second store)', settingsPayableAlt, { available: true, installmentsMax: 1, installmentRules: [] }],
  ])('%s', async (_n, rec, expected) => {
    vi.stubGlobal('fetch', settings(rec));
    expect(await getCheckoutCapabilities('d', 'https://api.test')).toEqual(expected);
  });

  it('installmentRules: valid kept, invalid dropped, absent -> []', async () => {
    vi.stubGlobal('fetch', settings({ payments: { available: true, installmentsMax: 12, installmentRules: [
      { minAmount: 100, maxPayments: 3 }, { minAmount: -1, maxPayments: 3 }, { minAmount: 'x', maxPayments: 3 },
      { minAmount: Infinity, maxPayments: 3 }, { minAmount: 50, maxPayments: 0 }, { minAmount: 50, maxPayments: 2.5 },
      null, 'r', { minAmount: 0, maxPayments: 1 },
    ] } }));
    expect((await getCheckoutCapabilities('d', 'https://api.test')).installmentRules).toEqual([
      { minAmount: 100, maxPayments: 3 }, { minAmount: 0, maxPayments: 1 },
    ]);
    vi.stubGlobal('fetch', settings({ payments: { available: true, installmentsMax: 2, installmentRules: 'nope' } }));
    expect((await getCheckoutCapabilities('d', 'https://api.test')).installmentRules).toEqual([]);
  });
});

describe('maxInstallmentsFor', () => {
  const rules = [{ minAmount: 100, maxPayments: 3 }, { minAmount: 500, maxPayments: 6 }, { minAmount: 1000, maxPayments: 12 }];
  it('no rules: installmentsMax (recorded settings have no rules)', () => {
    expect(maxInstallmentsFor(85, settingsPayable.payments)).toBe(1);
    expect(maxInstallmentsFor(85, { installmentsMax: 6, installmentRules: [] })).toBe(6);
  });
  // The recorded settings carry no rules, so every rule test below is typed (mirrors the dashboard's resolveAllowedInstallments).
  it('typed: the rule with the highest minAmount reached decides', () => {
    const c = { installmentsMax: 12, installmentRules: rules };
    expect(maxInstallmentsFor(100, c)).toBe(3);
    expect(maxInstallmentsFor(499.4, c)).toBe(3);
    expect(maxInstallmentsFor(500, c)).toBe(6);
    expect(maxInstallmentsFor(5000, c)).toBe(12);
  });
  it('typed: below every minAmount gives 1', () => {
    expect(maxInstallmentsFor(99.4, { installmentsMax: 12, installmentRules: rules })).toBe(1);
  });
  it('typed: no cap by installmentsMax when rules exist', () => {
    expect(maxInstallmentsFor(5000, { installmentsMax: 4, installmentRules: rules })).toBe(12);
    expect(maxInstallmentsFor(1000, { installmentsMax: 1, installmentRules: [{ minAmount: 1000, maxPayments: 3 }] })).toBe(3);
  });
  it('typed: non-monotone rules, the highest reached minAmount wins even if it allows fewer', () => {
    expect(maxInstallmentsFor(600, { installmentsMax: 1, installmentRules: [{ minAmount: 0, maxPayments: 12 }, { minAmount: 500, maxPayments: 6 }] })).toBe(6);
    expect(maxInstallmentsFor(1200, { installmentsMax: 1, installmentRules: [{ minAmount: 100, maxPayments: 12 }, { minAmount: 1000, maxPayments: 3 }] })).toBe(3);
  });
  it('typed: duplicate minAmount keeps array order, first wins', () => {
    expect(maxInstallmentsFor(500, { installmentsMax: 1, installmentRules: [{ minAmount: 500, maxPayments: 3 }, { minAmount: 500, maxPayments: 6 }] })).toBe(3);
  });
  it('typed: the total is rounded like the door (499.5 reaches a 500 rule)', () => {
    const c = { installmentsMax: 1, installmentRules: [{ minAmount: 500, maxPayments: 6 }] };
    expect(maxInstallmentsFor(499.5, c)).toBe(6);
    expect(maxInstallmentsFor(499.49, c)).toBe(1);
  });
  it('typed: a total that is not finite reaches no rule (1)', () => {
    const c = { installmentsMax: 12, installmentRules: [{ minAmount: 0, maxPayments: 6 }] };
    expect(maxInstallmentsFor(NaN, c)).toBe(1);
    expect(maxInstallmentsFor(Infinity, c)).toBe(1);
    expect(maxInstallmentsFor(NaN, { installmentsMax: 5, installmentRules: [] })).toBe(5);
  });
  it('typed: a non-finite installmentsMax reads as 1', () => {
    expect(maxInstallmentsFor(10, { installmentsMax: Infinity, installmentRules: [] })).toBe(1);
    expect(maxInstallmentsFor(10, { installmentsMax: NaN })).toBe(1);
  });
  it('installmentRules may be absent', () => {
    expect(maxInstallmentsFor(10, { installmentsMax: 5 })).toBe(5);
  });
  it('is exported from both entries', () => {
    expect(serverEntry.maxInstallmentsFor).toBe(maxInstallmentsFor);
    expect(typeof clientEntry.maxInstallmentsFor).toBe('function');
  });
});
