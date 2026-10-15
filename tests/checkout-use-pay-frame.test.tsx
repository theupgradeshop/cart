import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePayFrame, breakOutOfFrame, PAY_FRAME_POLL_GAPS_MS } from '../src/checkout/pay-frame';
import { parseV2Response } from '../src/checkout/validate';
import { ORDER_ID, orderFull } from '../src/checkout/__fixtures__/contract-v2';

const SUCCESS = 'https://shop.test/thank-you';
const CANCEL = 'https://shop.test/checkout';
const PAY = 'https://pay.test/pay/abc';
const base = {
  orderId: ORDER_ID,
  payUrl: PAY,
  successUrl: SUCCESS,
  cancelUrl: CANCEL,
  domain: 'shop.test',
  apiBaseUrl: 'https://api.test',
  open: true,
};

function pending() {
  return vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => orderFull('pending') });
}

function setup(over: Partial<Parameters<typeof usePayFrame>[0]> = {}) {
  const navigateTop = vi.fn();
  const onCancelled = vi.fn();
  const onClose = vi.fn();
  const hook = renderHook((p: Parameters<typeof usePayFrame>[0]) => usePayFrame(p), {
    initialProps: { ...base, navigateTop, onCancelled, onClose, ...over },
  });
  // The iframe's window is this window, so a message with source: window comes from the frame.
  Object.defineProperty(hook.result.current.frameRef, 'current', { value: { contentWindow: window }, writable: true, configurable: true });
  return { ...hook, navigateTop, onCancelled, onClose };
}

function frameAt(result: { current: ReturnType<typeof usePayFrame> }, href: string | (() => string)) {
  const win = {
    location: {
      get href() {
        return typeof href === 'function' ? href() : href;
      },
    },
  };
  Object.defineProperty(result.current.frameRef, 'current', { value: { contentWindow: win }, writable: true, configurable: true });
}

const post = (origin: string, data: unknown, source: MessageEventSource | null = window) =>
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { origin, data, source }));
  });

beforeEach(() => {
  sessionStorage.clear();
  vi.useFakeTimers();
  vi.stubGlobal('fetch', pending());
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('usePayFrame frame load', () => {
  it('same-origin success URL with this orderId navigates the top window', () => {
    const { result, navigateTop } = setup();
    const href = `${SUCCESS}?orderId=${ORDER_ID}`;
    frameAt(result, href);
    act(() => result.current.onFrameLoad());
    expect(navigateTop).toHaveBeenCalledWith(href);
  });

  it('navigates to successUrl?orderId, not the frame\'s raw href (extra params are dropped)', () => {
    const { result, navigateTop } = setup();
    frameAt(result, `${SUCCESS}?orderId=${ORDER_ID}&utm=x#frag`);
    act(() => result.current.onFrameLoad());
    expect(navigateTop).toHaveBeenCalledWith(`${SUCCESS}?orderId=${encodeURIComponent(ORDER_ID)}`);
  });

  it('success URL for another order is ignored', () => {
    const { result, navigateTop } = setup();
    frameAt(result, `${SUCCESS}?orderId=other`);
    act(() => result.current.onFrameLoad());
    expect(navigateTop).not.toHaveBeenCalled();
  });

  it('cancel URL reports cancelled and does not navigate', () => {
    const { result, navigateTop, onCancelled } = setup();
    frameAt(result, `${CANCEL}?x=1`);
    act(() => result.current.onFrameLoad());
    expect(onCancelled).toHaveBeenCalledTimes(1);
    expect(navigateTop).not.toHaveBeenCalled();
  });

  it('cross-origin load (getter throws) does nothing', () => {
    const { result, navigateTop, onCancelled } = setup();
    frameAt(result, () => {
      throw new DOMException('blocked', 'SecurityError');
    });
    act(() => result.current.onFrameLoad());
    expect(navigateTop).not.toHaveBeenCalled();
    expect(onCancelled).not.toHaveBeenCalled();
  });
});

describe('usePayFrame polling', () => {
  it('paid poll navigates to successUrl?orderId and keeps the token', async () => {
    sessionStorage.setItem('upgradeshop.checkout.ownership.' + ORDER_ID, 'tok');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => orderFull('paid') }));
    const { navigateTop } = setup();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(navigateTop).toHaveBeenCalledWith(`${SUCCESS}?orderId=${encodeURIComponent(ORDER_ID)}`);
    expect(sessionStorage.getItem('upgradeshop.checkout.ownership.' + ORDER_ID)).toBe('tok');
  });

  it('keeps polling every interval while pending, and stops on close', async () => {
    const f = pending();
    vi.stubGlobal('fetch', f);
    const { result, onClose } = setup();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(f).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PAY_FRAME_POLL_GAPS_MS[0]);
    });
    expect(f).toHaveBeenCalledTimes(2);
    act(() => result.current.close());
    expect(onClose).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60000);
    });
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('stops polling on unmount, and on open=false', async () => {
    const f = pending();
    vi.stubGlobal('fetch', f);
    const { unmount } = setup();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60000);
    });
    expect(f).toHaveBeenCalledTimes(1);
    const g = pending();
    vi.stubGlobal('fetch', g);
    const h = setup({ open: false });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60000);
    });
    expect(g).not.toHaveBeenCalled();
    h.unmount();
  });
});

describe('usePayFrame messages', () => {
  const msg = (status: string, orderId = ORDER_ID) => ({ type: 'tus-payment', status, orderId });

  it('message from a wrong origin is ignored', () => {
    const { navigateTop, onCancelled } = setup();
    post('https://evil.test', msg('paid'));
    post('https://evil.test', msg('cancelled'));
    expect(navigateTop).not.toHaveBeenCalled();
    expect(onCancelled).not.toHaveBeenCalled();
  });

  it('message for a different orderId or shape is ignored', () => {
    const { navigateTop, onCancelled } = setup();
    post('https://pay.test', msg('paid', 'other'));
    post('https://pay.test', { type: 'other', status: 'paid', orderId: ORDER_ID });
    post('https://pay.test', 'paid');
    post('https://pay.test', null);
    expect(navigateTop).not.toHaveBeenCalled();
    expect(onCancelled).not.toHaveBeenCalled();
  });

  it('paid message from the pay origin navigates once', () => {
    const { navigateTop } = setup();
    post('https://pay.test', msg('paid'));
    post('https://pay.test', msg('paid'));
    expect(navigateTop).toHaveBeenCalledTimes(1);
    expect(navigateTop).toHaveBeenCalledWith(`${SUCCESS}?orderId=${encodeURIComponent(ORDER_ID)}`);
  });

  it('cancelled message reports cancelled', () => {
    const { navigateTop, onCancelled } = setup();
    post('https://pay.test', msg('cancelled'));
    expect(onCancelled).toHaveBeenCalledTimes(1);
    expect(navigateTop).not.toHaveBeenCalled();
  });

  it('listener is removed on close and on unmount', () => {
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    const a = setup();
    const added = add.mock.calls.filter((c) => c[0] === 'message').length;
    expect(added).toBe(1);
    act(() => a.result.current.close());
    post('https://pay.test', msg('paid'));
    expect(a.navigateTop).not.toHaveBeenCalled();
    const b = setup();
    b.unmount();
    post('https://pay.test', msg('paid'));
    expect(b.navigateTop).not.toHaveBeenCalled();
    expect(remove.mock.calls.filter((c) => c[0] === 'message').length).toBeGreaterThanOrEqual(2);
    add.mockRestore();
    remove.mockRestore();
  });
});

describe('usePayFrame poll schedule', () => {
  const total = PAY_FRAME_POLL_GAPS_MS.reduce((a, b) => a + b, 0);

  it('makes 14 requests over about 4.3 minutes on the stated gaps, then stops', async () => {
    const f = pending();
    vi.stubGlobal('fetch', f);
    setup();
    expect(PAY_FRAME_POLL_GAPS_MS).toHaveLength(13);
    expect(total).toBe(260000);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(f).toHaveBeenCalledTimes(1);
    // just before the second slot nothing new, at the slot one more
    await act(async () => { await vi.advanceTimersByTimeAsync(PAY_FRAME_POLL_GAPS_MS[0] - 1); });
    expect(f).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(f).toHaveBeenCalledTimes(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(total); });
    expect(f).toHaveBeenCalledTimes(14);
    await act(async () => { await vi.advanceTimersByTimeAsync(10 * 60000); });
    expect(f).toHaveBeenCalledTimes(14);
  });

  it('a failed or cancelled order does nothing and polling goes on', async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => orderFull('failed') });
    vi.stubGlobal('fetch', f);
    const { navigateTop, onCancelled } = setup();
    await act(async () => { await vi.advanceTimersByTimeAsync(PAY_FRAME_POLL_GAPS_MS[0] * 2 + 1); });
    expect(f.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(navigateTop).not.toHaveBeenCalled();
    expect(onCancelled).not.toHaveBeenCalled();
  });

  it('a 429 or 404 ends the polling', async () => {
    for (const status of [429, 404]) {
      const f = vi.fn().mockResolvedValue({ ok: false, status, json: async () => ({}) });
      vi.stubGlobal('fetch', f);
      const h = setup();
      await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
      expect(f).toHaveBeenCalledTimes(1);
      h.unmount();
    }
  });
});

describe('usePayFrame first outcome wins and re-open', () => {
  const paidFetch = () => vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => orderFull('paid') });

  it('frame-load success first, then a paid poll: one navigation', async () => {
    const { result, navigateTop } = setup();
    frameAt(result, `${SUCCESS}?orderId=${ORDER_ID}`);
    act(() => result.current.onFrameLoad());
    expect(navigateTop).toHaveBeenCalledTimes(1);
    vi.stubGlobal('fetch', paidFetch());
    await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
    post('https://pay.test', { type: 'tus-payment', status: 'paid', orderId: ORDER_ID });
    expect(navigateTop).toHaveBeenCalledTimes(1);
  });

  it('a paid poll first, then a frame-load success and a message: one navigation', async () => {
    vi.stubGlobal('fetch', paidFetch());
    const { result, navigateTop } = setup();
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect(navigateTop).toHaveBeenCalledTimes(1);
    frameAt(result, `${SUCCESS}?orderId=${ORDER_ID}`);
    act(() => result.current.onFrameLoad());
    post('https://pay.test', { type: 'tus-payment', status: 'paid', orderId: ORDER_ID });
    expect(navigateTop).toHaveBeenCalledTimes(1);
  });

  it('close() after a navigation was issued does nothing (the form must not unlock)', () => {
    const { result, navigateTop, onClose } = setup();
    post('https://pay.test', { type: 'tus-payment', status: 'paid', orderId: ORDER_ID });
    expect(navigateTop).toHaveBeenCalledTimes(1);
    act(() => result.current.close());
    expect(onClose).not.toHaveBeenCalled();
  });

  it('a message whose source is not the frame is ignored', () => {
    const { navigateTop, onCancelled } = setup();
    post('https://pay.test', { type: 'tus-payment', status: 'paid', orderId: ORDER_ID }, null);
    post('https://pay.test', { type: 'tus-payment', status: 'cancelled', orderId: ORDER_ID }, new MessageChannel().port1);
    expect(navigateTop).not.toHaveBeenCalled();
    expect(onCancelled).not.toHaveBeenCalled();
  });

  it('re-open after close: listener and polling start again, a cancel then a new outcome both work', async () => {
    const f = pending();
    vi.stubGlobal('fetch', f);
    const navigateTop = vi.fn();
    const onCancelled = vi.fn();
    const onClose = vi.fn();
    const hook = renderHook((p: Parameters<typeof usePayFrame>[0]) => usePayFrame(p), {
      initialProps: { ...base, navigateTop, onCancelled, onClose },
    });
    Object.defineProperty(hook.result.current.frameRef, 'current', { value: { contentWindow: window }, writable: true, configurable: true });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    post('https://pay.test', { type: 'tus-payment', status: 'cancelled', orderId: ORDER_ID });
    expect(onCancelled).toHaveBeenCalledTimes(1);
    // after the cancel, everything is stopped
    await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
    expect(f).toHaveBeenCalledTimes(1);
    hook.rerender({ ...base, navigateTop, onCancelled, onClose, open: false });
    hook.rerender({ ...base, navigateTop, onCancelled, onClose, open: true });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(f).toHaveBeenCalledTimes(2);
    post('https://pay.test', { type: 'tus-payment', status: 'paid', orderId: ORDER_ID });
    expect(navigateTop).toHaveBeenCalledTimes(1);
    expect(onCancelled).toHaveBeenCalledTimes(1);
  });
});

describe('breakOutOfFrame', () => {
  it('is a no-op when not framed', () => {
    const assign = vi.fn();
    const orig = window.location;
    Object.defineProperty(window, 'location', { value: { ...orig, assign, href: 'https://shop.test/x', origin: 'https://shop.test' }, configurable: true });
    expect(() => breakOutOfFrame()).not.toThrow();
    expect(assign).not.toHaveBeenCalled();
    Object.defineProperty(window, 'location', { value: orig, configurable: true });
  });

  it('framed by a same-origin top: loads this page in the top window', () => {
    const assign = vi.fn();
    const top = { location: { origin: window.location.origin, assign } };
    const spy = vi.spyOn(window, 'top', 'get').mockReturnValue(top as unknown as Window);
    breakOutOfFrame();
    expect(assign).toHaveBeenCalledWith(window.location.href);
    spy.mockRestore();
  });

  it('framed by a cross-origin top (throws): stays', () => {
    const top = {
      get location(): never {
        throw new DOMException('blocked', 'SecurityError');
      },
    };
    const spy = vi.spyOn(window, 'top', 'get').mockReturnValue(top as unknown as Window);
    expect(() => breakOutOfFrame()).not.toThrow();
    spy.mockRestore();
  });
});

describe('parseV2Response next.display', () => {
  const body = (display: unknown) => ({
    orderId: 'o1',
    orderNumber: '1',
    ownershipToken: 't',
    totals: { subtotal: 1, discount: 0, shipping: 0, total: 1, currency: 'ILS' },
    next: { kind: 'pay', url: 'https://pay.test/p', ...(display === undefined ? {} : { display }) },
  });
  it('accepts "redirect" and passes it through', () => {
    expect(parseV2Response(body('redirect'))?.next).toEqual({ kind: 'pay', url: 'https://pay.test/p', display: 'redirect' });
  });
  it('absent display leaves next unchanged', () => {
    expect(parseV2Response(body(undefined))?.next).toEqual({ kind: 'pay', url: 'https://pay.test/p' });
  });
  it('any other display value is dropped, never passed through', () => {
    for (const v of ['modal', '', null, 1]) {
      expect(parseV2Response(body(v))?.next).toEqual({ kind: 'pay', url: 'https://pay.test/p' });
    }
  });
});
