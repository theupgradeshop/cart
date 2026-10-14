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
});
