import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useThankYouOrder } from '../src/checkout';
import { ORDER_ID, orderFull } from '../src/checkout/__fixtures__/contract-v2';

const opts = { domain: 'shop.test', apiBaseUrl: 'https://api.test' };
const SHORT_REQUESTS = 12;
// Slow watch gaps: 15 s, 30 s, 60 s, then 120 s x5 (8 requests). Literals on purpose: the test pins the schedule.
const SLOW_GAPS = [15000, 30000, 60000, 120000, 120000, 120000, 120000, 120000];

const json = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const pending = () => json(orderFull('pending'));

function setVisibility(v: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => v });
  document.dispatchEvent(new Event('visibilitychange'));
}

/** Runs the short poll (12 requests, 4 s apart) to its end. */
async function finishShortPoll() {
  await act(async () => { await vi.advanceTimersByTimeAsync(4000 * (SHORT_REQUESTS - 1) + 10); });
}
const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

beforeEach(() => { sessionStorage.clear(); vi.useFakeTimers(); setVisibility('visible'); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); setVisibility('visible'); });

describe('useThankYouOrder slow watch', () => {
  it('a short poll that ends pending reports not_received + watching, then paid during the slow watch fires onPaid once', async () => {
    let calls = 0;
    const f = vi.fn().mockImplementation(async () => (++calls <= SHORT_REQUESTS + 2 ? pending() : json(orderFull('paid'))));
    vi.stubGlobal('fetch', f);
    const onPaid = vi.fn();
    const { result } = renderHook(() => useThankYouOrder(ORDER_ID, { ...opts, onPaid }));
    await finishShortPoll();
    expect(f).toHaveBeenCalledTimes(SHORT_REQUESTS);
    expect(result.current).toMatchObject({ status: 'done', state: 'not_received', watching: true });
    expect(onPaid).not.toHaveBeenCalled();
    await advance(SLOW_GAPS[0]); // slow request 1 (pending)
    await advance(SLOW_GAPS[1]); // slow request 2 (pending)
    expect(result.current).toMatchObject({ state: 'not_received', watching: true });
    await advance(SLOW_GAPS[2]); // slow request 3 (paid)
    expect(result.current).toMatchObject({ status: 'done', state: 'paid' });
    expect((result.current as { watching?: boolean }).watching).toBeUndefined();
    expect(onPaid).toHaveBeenCalledTimes(1);
    await advance(600000);
    expect(f).toHaveBeenCalledTimes(SHORT_REQUESTS + 3);
    expect(onPaid).toHaveBeenCalledTimes(1);
  });

  it('stops after 8 slow requests and settles on not_received without watching', async () => {
    const f = vi.fn().mockResolvedValue(pending());
    vi.stubGlobal('fetch', f);
    const { result } = renderHook(() => useThankYouOrder(ORDER_ID, opts));
    await finishShortPoll();
    for (const g of SLOW_GAPS) await advance(g);
    expect(f).toHaveBeenCalledTimes(SHORT_REQUESTS + 8);
    expect(result.current).toMatchObject({ status: 'done', state: 'not_received' });
    expect((result.current as { watching?: boolean }).watching).toBeUndefined();
    await advance(3600000);
    expect(f).toHaveBeenCalledTimes(SHORT_REQUESTS + 8);
  });

  it('a hidden tab makes no request; becoming visible checks at once and that check uses one of the 8', async () => {
    const f = vi.fn().mockResolvedValue(pending());
    vi.stubGlobal('fetch', f);
    renderHook(() => useThankYouOrder(ORDER_ID, opts));
    await finishShortPoll();
    setVisibility('hidden');
    await advance(600000);
    expect(f).toHaveBeenCalledTimes(SHORT_REQUESTS);
    setVisibility('visible');
    await advance(0);
    expect(f).toHaveBeenCalledTimes(SHORT_REQUESTS + 1);
    // 7 requests are left in the budget: the schedule resumes from the next gap.
    for (const g of SLOW_GAPS.slice(1)) await advance(g);
    expect(f).toHaveBeenCalledTimes(SHORT_REQUESTS + 8);
    await advance(3600000);
    expect(f).toHaveBeenCalledTimes(SHORT_REQUESTS + 8);
  });

  it('a 429 doubles the next gap and is not a failure', async () => {
    let n = 0;
    const f = vi.fn().mockImplementation(async () => {
      n += 1;
      if (n <= SHORT_REQUESTS) return pending();
      return n === SHORT_REQUESTS + 1 ? json({ error: 'Too many requests' }, 429) : pending();
    });
    vi.stubGlobal('fetch', f);
    const { result } = renderHook(() => useThankYouOrder(ORDER_ID, opts));
    await finishShortPoll();
    await advance(SLOW_GAPS[0]); // slow request 1 -> 429
    expect(f).toHaveBeenCalledTimes(SHORT_REQUESTS + 1);
    expect(result.current).toMatchObject({ state: 'not_received', watching: true });
    // finishShortPoll overshoots by 10 ms, so the doubled gap (60 s) is due 10 ms before this window's end
    await advance(SLOW_GAPS[1] * 2 - 50);
    expect(f).toHaveBeenCalledTimes(SHORT_REQUESTS + 1);
    await advance(50);
    expect(f).toHaveBeenCalledTimes(SHORT_REQUESTS + 2);
    // the doubling applies once: the following gap is back to normal
    await advance(SLOW_GAPS[2]);
    expect(f).toHaveBeenCalledTimes(SHORT_REQUESTS + 3);
  });

  it('keepWatching:false stops after the short poll, as before', async () => {
    const f = vi.fn().mockResolvedValue(pending());
    vi.stubGlobal('fetch', f);
    const { result } = renderHook(() => useThankYouOrder(ORDER_ID, { ...opts, keepWatching: false }));
    await finishShortPoll();
    expect(result.current).toEqual(expect.objectContaining({ status: 'done', state: 'not_received' }));
    expect('watching' in result.current).toBe(false);
    await advance(3600000);
    expect(f).toHaveBeenCalledTimes(SHORT_REQUESTS);
  });

  it('unmount aborts the watch: no further requests and no onPaid', async () => {
    const f = vi.fn().mockResolvedValue(pending());
    vi.stubGlobal('fetch', f);
    const onPaid = vi.fn();
    const { unmount } = renderHook(() => useThankYouOrder(ORDER_ID, { ...opts, onPaid }));
    await finishShortPoll();
    await advance(SLOW_GAPS[0]);
    expect(f).toHaveBeenCalledTimes(SHORT_REQUESTS + 1);
    unmount();
    f.mockResolvedValue(json(orderFull('paid')));
    await advance(3600000);
    expect(f).toHaveBeenCalledTimes(SHORT_REQUESTS + 1);
    expect(onPaid).not.toHaveBeenCalled();
  });

  it('a changed orderId aborts the old watch', async () => {
    const f = vi.fn().mockResolvedValue(pending());
    vi.stubGlobal('fetch', f);
    const { rerender } = renderHook(({ id }) => useThankYouOrder(id, opts), { initialProps: { id: ORDER_ID as string | null } });
    await finishShortPoll();
    rerender({ id: null });
    const before = f.mock.calls.length;
    await advance(3600000);
    expect(f).toHaveBeenCalledTimes(before);
  });

  it('a declined answer during the watch ends it as declined', async () => {
    let n = 0;
    const f = vi.fn().mockImplementation(async () => (++n <= SHORT_REQUESTS ? pending() : json(orderFull('failed'))));
    vi.stubGlobal('fetch', f);
    const onPaid = vi.fn();
    const { result } = renderHook(() => useThankYouOrder(ORDER_ID, { ...opts, onPaid }));
    await finishShortPoll();
    await advance(SLOW_GAPS[0]);
    expect(result.current).toMatchObject({ status: 'done', state: 'declined' });
    expect(onPaid).not.toHaveBeenCalled();
    await advance(3600000);
    expect(f).toHaveBeenCalledTimes(SHORT_REQUESTS + 1);
  });
});
