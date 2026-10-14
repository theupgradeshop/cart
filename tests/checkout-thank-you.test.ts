import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getOrderForThankYou, POLL_INTERVAL_MS, POLL_MAX_REQUESTS } from '../src/checkout';
import { readOwnershipToken } from '../src/checkout/storage';
import { ORDER_ID, orderFull, orderThin } from '../src/checkout/__fixtures__/contract-v2';

const BASE = 'https://api.test';
const opts = { domain: 'shop.test', apiBaseUrl: BASE };
const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
const status = (s: number) => ({ ok: false, status: s, json: async () => ({}) });

beforeEach(() => {
  vi.useFakeTimers();
  sessionStorage.clear();
  sessionStorage.setItem(`upgradeshop.checkout.ownership.${ORDER_ID}`, 'own.tok.en');
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('getOrderForThankYou', () => {
  it('sends the token as a Bearer header, never in the URL, and returns the full shape', async () => {
    const f = vi.fn().mockResolvedValue(ok(orderFull('paid')));
    vi.stubGlobal('fetch', f);
    const r = await getOrderForThankYou(ORDER_ID, opts);
    expect(f.mock.calls[0][0]).toBe(`${BASE}/api/public/orders/${ORDER_ID}?domain=shop.test`);
    expect(f.mock.calls[0][0]).not.toContain('t=');
    expect(f.mock.calls[0][1].headers).toEqual({ Authorization: 'Bearer own.tok.en' });
    expect(r).toMatchObject({ state: 'paid', full: true, requests: 1 });
  });

  it('paid: clears the token and fires onPaid once', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok(orderFull('paid'))));
    const onPaid = vi.fn();
    await getOrderForThankYou(ORDER_ID, { ...opts, onPaid });
    expect(readOwnershipToken(ORDER_ID)).toBeNull();
    expect(onPaid).toHaveBeenCalledTimes(1);
  });

  it.each([['failed'], ['cancelled']])('%s: declined, token cleared, onPaid NOT fired (cart kept)', async (s) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok(orderFull(s))));
    const onPaid = vi.fn();
    const r = await getOrderForThankYou(ORDER_ID, { ...opts, onPaid });
    expect(r.state).toBe('declined');
    expect(readOwnershipToken(ORDER_ID)).toBeNull();
    expect(onPaid).not.toHaveBeenCalled();
  });

  it('refunded is terminal but not paid', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok(orderFull('refunded'))));
    const onPaid = vi.fn();
    const r = await getOrderForThankYou(ORDER_ID, { ...opts, onPaid });
    expect(r.state).toBe('refunded');
    expect(onPaid).not.toHaveBeenCalled();
  });

  it('pending then paid: polls every 4 s, keeps the token while pending, clears after terminal', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(ok(orderFull('pending')))
      .mockResolvedValueOnce(ok(orderFull('pending')))
      .mockResolvedValueOnce(ok(orderFull('paid')));
    vi.stubGlobal('fetch', f);
    const onUpdate = vi.fn();
    const p = getOrderForThankYou(ORDER_ID, { ...opts, onUpdate });
    await vi.advanceTimersByTimeAsync(0);
    expect(f).toHaveBeenCalledTimes(1);
    expect(readOwnershipToken(ORDER_ID)).toBe('own.tok.en');
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS - 1);
    expect(f).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(f).toHaveBeenCalledTimes(2);
    expect(readOwnershipToken(ORDER_ID)).toBe('own.tok.en');
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    const r = await p;
    expect(f).toHaveBeenCalledTimes(3);
    expect(r.state).toBe('paid');
    expect(onUpdate).toHaveBeenCalledTimes(2);
    expect(readOwnershipToken(ORDER_ID)).toBeNull();
  });

  it('caps at 12 requests and ends in not_received with the token kept', async () => {
    const f = vi.fn().mockResolvedValue(ok(orderFull('pending')));
    vi.stubGlobal('fetch', f);
    const p = getOrderForThankYou(ORDER_ID, opts);
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 20);
    const r = await p;
    expect(POLL_MAX_REQUESTS).toBe(12);
    expect(f).toHaveBeenCalledTimes(12);
    expect(r).toMatchObject({ state: 'not_received', requests: 12 });
    expect(readOwnershipToken(ORDER_ID)).toBe('own.tok.en');
  });

  it('a 429 is non-terminal: polling ends in not_received, token kept, no onPaid', async () => {
    const f = vi.fn().mockResolvedValueOnce(ok(orderFull('pending'))).mockResolvedValueOnce(status(429));
    vi.stubGlobal('fetch', f);
    const onPaid = vi.fn();
    const p = getOrderForThankYou(ORDER_ID, { ...opts, onPaid });
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3);
    const r = await p;
    expect(f).toHaveBeenCalledTimes(2);
    expect(r.state).toBe('not_received');
    expect(readOwnershipToken(ORDER_ID)).toBe('own.tok.en');
    expect(onPaid).not.toHaveBeenCalled();
  });

  it('a network error or 500 counts toward the cap and polling continues', async () => {
    const f = vi.fn()
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockResolvedValueOnce(status(500))
      .mockResolvedValueOnce(ok(orderFull('paid')));
    vi.stubGlobal('fetch', f);
    const p = getOrderForThankYou(ORDER_ID, opts);
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3);
    expect((await p).state).toBe('paid');
    expect(f).toHaveBeenCalledTimes(3);
  });

  it('404 is not_found', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(status(404)));
    expect((await getOrderForThankYou(ORDER_ID, opts)).state).toBe('not_found');
  });

  it('no stored token: no Authorization header, thin response returned, status still read', async () => {
    sessionStorage.clear();
    const f = vi.fn().mockResolvedValue(ok(orderThin('paid')));
    vi.stubGlobal('fetch', f);
    const r = await getOrderForThankYou(ORDER_ID, opts);
    expect(f.mock.calls[0][0]).toBe(`${BASE}/api/public/orders/${ORDER_ID}?domain=shop.test`);
    expect(f.mock.calls[0][1].headers).toEqual({});
    expect(r).toMatchObject({ state: 'paid', full: false });
    expect(r.order).toHaveProperty('orderNumber', 'O-10001');
    expect(r.order).not.toHaveProperty('customerEmail');
  });

  it('an aborted signal stops polling', async () => {
    const f = vi.fn().mockResolvedValue(ok(orderFull('pending')));
    vi.stubGlobal('fetch', f);
    const ctl = new AbortController();
    const p = getOrderForThankYou(ORDER_ID, { ...opts, signal: ctl.signal });
    await vi.advanceTimersByTimeAsync(0);
    ctl.abort();
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3);
    await p;
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('abort while a request is in flight that would return paid: token kept, no onPaid, not terminal', async () => {
    let release!: (v: unknown) => void;
    const f = vi.fn().mockReturnValue(new Promise((r) => { release = r; }));
    vi.stubGlobal('fetch', f);
    const onPaid = vi.fn();
    const ctl = new AbortController();
    const p = getOrderForThankYou(ORDER_ID, { ...opts, onPaid, signal: ctl.signal });
    await vi.advanceTimersByTimeAsync(0);
    expect(f.mock.calls[0][1].signal).toBe(ctl.signal);
    ctl.abort();
    release(ok(orderFull('paid')));
    const r = await p;
    expect(onPaid).not.toHaveBeenCalled();
    expect(readOwnershipToken(ORDER_ID)).toBe('own.tok.en');
    expect(r.state).toBe('not_received');
  });

  it('abort between the response and its body: still no clear, no onPaid', async () => {
    const ctl = new AbortController();
    const onPaid = vi.fn();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => { ctl.abort(); return orderFull('paid'); },
    }));
    const r = await getOrderForThankYou(ORDER_ID, { ...opts, onPaid, signal: ctl.signal });
    expect(onPaid).not.toHaveBeenCalled();
    expect(readOwnershipToken(ORDER_ID)).toBe('own.tok.en');
    expect(r.state).toBe('not_received');
  });

  it('a throwing onPaid or onUpdate does not stop the result', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok(orderFull('paid'))));
    const r = await getOrderForThankYou(ORDER_ID, { ...opts, onPaid: () => { throw new Error('boom'); } });
    expect(r.state).toBe('paid');
    const f = vi.fn().mockResolvedValueOnce(ok(orderFull('pending'))).mockResolvedValueOnce(ok(orderFull('paid')));
    vi.stubGlobal('fetch', f);
    const p = getOrderForThankYou(ORDER_ID, { ...opts, onUpdate: () => { throw new Error('boom'); } });
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect((await p).state).toBe('paid');
  });

  it('removes its abort listener when the sleep timer fires', async () => {
    const f = vi.fn().mockResolvedValueOnce(ok(orderFull('pending'))).mockResolvedValueOnce(ok(orderFull('paid')));
    vi.stubGlobal('fetch', f);
    const ctl = new AbortController();
    const add = vi.spyOn(ctl.signal, 'addEventListener');
    const remove = vi.spyOn(ctl.signal, 'removeEventListener');
    const p = getOrderForThankYou(ORDER_ID, { ...opts, signal: ctl.signal });
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    await p;
    expect(add).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledTimes(1);
  });
});
