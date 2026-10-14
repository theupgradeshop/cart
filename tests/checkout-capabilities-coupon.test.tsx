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
    expect(await getCheckoutCapabilities('shop.test', 'https://api.test')).toEqual({ available: true, installmentsMax: 6 });
    expect(f.mock.calls[0][0]).toBe('https://api.test/api/public/checkout-settings?domain=shop.test');
  });
  it('not available, missing payments, failures: hidden', async () => {
    const none = { available: false, installmentsMax: 1 };
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
      expect(await p).toEqual({ available: false, installmentsMax: 1 });
      const q = getCheckoutCapabilities('d', 'https://api.test');
      await vi.advanceTimersByTimeAsync(4999);
      let settled = false;
      q.then(() => { settled = true; });
      await vi.advanceTimersByTimeAsync(0);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(2);
      expect(await q).toEqual({ available: false, installmentsMax: 1 });
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
      ['CHECKOUT_ERROR_KEYS', 'CheckoutError', 'buildCartDoorBody', 'buildFunnelDoorBody', 'checkoutErrorKey', 'getCheckoutCapabilities', 'isCheckoutError'],
    );
  });
});
