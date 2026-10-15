import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useThankYouOrder } from '../src/checkout';
import { ORDER_ID, orderFull } from '../src/checkout/__fixtures__/contract-v2';

beforeEach(() => sessionStorage.clear());
afterEach(() => vi.unstubAllGlobals());
const opts = { domain: 'shop.test', apiBaseUrl: 'https://api.test' };

describe('useThankYouOrder', () => {
  it('null orderId is done / not_found with no request', () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    const { result } = renderHook(() => useThankYouOrder(null, opts));
    expect(result.current).toEqual({ status: 'done', state: 'not_found', order: null, full: false, requests: 0 });
    expect(f).not.toHaveBeenCalled();
  });

  it('paid: done, and the latest onPaid is the one called', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => orderFull('paid') }));
    const first = vi.fn();
    const latest = vi.fn();
    const { result, rerender } = renderHook(({ cb }) => useThankYouOrder(ORDER_ID, { ...opts, onPaid: cb }), {
      initialProps: { cb: first },
    });
    rerender({ cb: latest });
    await waitFor(() => expect(result.current.status).toBe('done'));
    expect(latest).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });

  it('inside a frame it makes no request, keeps the token, never calls onPaid and stays confirming', async () => {
    const spy = vi.spyOn(window, 'top', 'get').mockReturnValue({ location: { origin: window.location.origin } } as unknown as Window);
    sessionStorage.setItem(`upgradeshop.checkout.ownership.${ORDER_ID}`, 'tok');
    const f = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => orderFull('paid') });
    vi.stubGlobal('fetch', f);
    const onPaid = vi.fn();
    const { result } = renderHook(() => useThankYouOrder(ORDER_ID, { ...opts, onPaid }));
    await new Promise((r) => setTimeout(r, 30));
    expect(f).not.toHaveBeenCalled();
    expect(onPaid).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(`upgradeshop.checkout.ownership.${ORDER_ID}`)).toBe('tok');
    expect(result.current).toEqual({ status: 'confirming', order: null });
    spy.mockRestore();
  });

  it('under a cross-origin top it polls normally and reaches done', async () => {
    const spy = vi.spyOn(window, 'top', 'get').mockImplementation(() => { throw new DOMException('x', 'SecurityError'); });
    const f = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => orderFull('paid') });
    vi.stubGlobal('fetch', f);
    const onPaid = vi.fn();
    const { result } = renderHook(() => useThankYouOrder(ORDER_ID, { ...opts, onPaid }));
    await waitFor(() => expect(result.current.status).toBe('done'));
    expect(f).toHaveBeenCalled();
    expect(onPaid).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});
