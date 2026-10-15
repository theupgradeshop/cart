import { useCallback, useEffect, useRef, type RefObject } from 'react';
import { readOwnershipToken } from './storage';

/**
 * Gaps between the order polls of the pop-up, in ms: the first request is immediate, then 4 s x5, 15 s x4,
 * 45 s x4. That is 14 requests over 260 s (about 4.3 minutes), so the pop-up's 14 plus the thank-you page's
 * 12 stay under the orders route's 30 per 15 minutes, with room for one reload.
 */
export const PAY_FRAME_POLL_GAPS_MS: readonly number[] = [
  4000, 4000, 4000, 4000, 4000, 15000, 15000, 15000, 15000, 45000, 45000, 45000, 45000,
];

/** The optional signal the dashboard pay page may post to its parent. Anything else is ignored. */
export interface PayFrameMessage {
  type: 'tus-payment';
  status: 'paid' | 'cancelled';
  orderId: string;
}

export interface UsePayFrameOptions {
  orderId: string;
  /** `next.url` of the checkout answer: the dashboard pay page shown in the iframe. */
  payUrl: string;
  /** Absolute URL of the site's thank-you page (same value passed to startCheckout). May carry its own query. */
  successUrl: string;
  /** Absolute URL of the site's checkout (same value passed to startCheckout). */
  cancelUrl: string;
  domain: string;
  /** Dashboard base URL (same as getOrderForThankYou). */
  apiBaseUrl: string;
  /** The pop-up is shown. Nothing runs while false. */
  open: boolean;
  /** The visitor reached the cancel URL (or the pay page said cancelled): the component closes the pop-up and leaves the cart alone. */
  onCancelled?: () => void;
  /** close() was called. */
  onClose?: () => void;
  /** Test seam / custom navigation of the TOP window. Defaults to `window.location.assign`. */
  navigateTop?: (url: string) => void;
}

export interface UsePayFrameResult {
  /** Attach to the iframe: `ref={frameRef}`. */
  frameRef: RefObject<HTMLIFrameElement>;
  /** Call from the iframe's `onLoad`. Same-origin success / cancel URLs are detected; a cross-origin frame is ignored. */
  onFrameLoad: () => void;
  /** Stops polling and the message listener, then calls onClose. Close = Back: nothing else changes. */
  close: () => void;
}

/** `url` with `orderId` added (before any #fragment), as startCheckout builds the thank-you URL. */
function withOrderId(url: string, orderId: string): string {
  const hash = url.indexOf('#');
  const path = hash === -1 ? url : url.slice(0, hash);
  const frag = hash === -1 ? '' : url.slice(hash);
  const sep = path.includes('?') ? '&' : '?';
  return `${path}${sep}orderId=${encodeURIComponent(orderId)}${frag}`;
}

function normPath(p: string): string {
  return p.length > 1 ? p.replace(/\/+$/, '') : p;
}

/** Same origin and same path (trailing slash ignored). Query and fragment are not compared. */
function samePage(a: URL, b: URL): boolean {
  return a.origin === b.origin && normPath(a.pathname) === normPath(b.pathname);
}

function parse(u: string): URL | null {
  try {
    return new URL(u);
  } catch {
    return null;
  }
}

/**
 * Behaviour of the payment pop-up (no visuals, no visitor words). The component renders the iframe
 * (`src={payUrl}`, `ref={frameRef}`, `onLoad={onFrameLoad}`) and a Back button calling `close()`.
 * While `open`:
 *  1. on each iframe load, a same-origin frame at the success page with this orderId navigates the TOP
 *     window to it; at the cancel page it calls onCancelled (a cross-origin read throws and is ignored);
 *  2. the order is polled on PAY_FRAME_POLL_GAPS_MS (14 requests over about 4.3 minutes, ownership token as a
 *     Bearer header); `paid` navigates the top window to `successUrl?orderId=`. The token is never cleared
 *     here because the thank-you page still needs it;
 *  3. a `message` event is accepted only from the pay page's origin, shape
 *     `{type:"tus-payment", status, orderId}` for this orderId: paid navigates, cancelled calls onCancelled.
 * Everything stops on close, on a first outcome and on unmount.
 */
export function usePayFrame(opts: UsePayFrameOptions): UsePayFrameResult {
  const { orderId, payUrl, successUrl, cancelUrl, domain, apiBaseUrl, open } = opts;
  const frameRef = useRef<HTMLIFrameElement>(null) as RefObject<HTMLIFrameElement>;
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const doneRef = useRef(false);
  const stopRef = useRef<() => void>(() => {});

  const navigate = useCallback((url: string) => {
    if (doneRef.current) return;
    doneRef.current = true;
    stopRef.current();
    (optsRef.current.navigateTop ?? ((u: string) => window.location.assign(u)))(url);
  }, []);

  const cancel = useCallback(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    stopRef.current();
    optsRef.current.onCancelled?.();
  }, []);

  useEffect(() => {
    if (!open) return;
    doneRef.current = false;
    const ctl = new AbortController();
    const payOrigin = parse(payUrl)?.origin ?? null;
    const target = withOrderId(successUrl, orderId);

    const onMessage = (e: MessageEvent) => {
      if (!payOrigin || e.origin !== payOrigin) return;
      const frameWin = frameRef.current?.contentWindow;
      if (!frameWin || e.source !== frameWin) return;
      const d = e.data as Partial<PayFrameMessage> | null;
      if (!d || typeof d !== 'object' || d.type !== 'tus-payment' || d.orderId !== orderId) return;
      if (d.status === 'paid') navigate(target);
      else if (d.status === 'cancelled') cancel();
    };
    window.addEventListener('message', onMessage);

    stopRef.current = () => {
      ctl.abort();
      window.removeEventListener('message', onMessage);
    };

    // Order poll on its own schedule (PAY_FRAME_POLL_GAPS_MS). Only `paid` acts (a failed or cancelled status does
    // nothing and polling goes on: the pay page may offer a retry); a 404 or 429 ends the polling, the token is never cleared here.
    const token = readOwnershipToken(orderId);
    const pollUrl = `${apiBaseUrl.replace(/\/+$/, '')}/api/public/orders/${encodeURIComponent(orderId)}?domain=${encodeURIComponent(domain)}`;
    const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
    let timer: ReturnType<typeof setTimeout> | null = null;
    const prevStop = stopRef.current;
    stopRef.current = () => {
      prevStop();
      if (timer !== null) clearTimeout(timer);
      timer = null;
    };
    const poll = async (n: number): Promise<void> => {
      if (ctl.signal.aborted) return;
      let end = false;
      try {
        const res = await fetch(pollUrl, { headers, signal: ctl.signal });
        if (ctl.signal.aborted) return;
        if (res.status === 429 || res.status === 404) end = true;
        else if (res.ok) {
          const json = (await res.json()) as { financialStatus?: unknown };
          if (ctl.signal.aborted) return;
          if (json && json.financialStatus === 'paid') {
            navigate(target);
            return;
          }
        }
      } catch {
        /* a network blip or an abort: try the next slot */
      }
      if (end || ctl.signal.aborted || n >= PAY_FRAME_POLL_GAPS_MS.length) return;
      timer = setTimeout(() => { timer = null; void poll(n + 1); }, PAY_FRAME_POLL_GAPS_MS[n]);
    };
    void poll(0);

    return () => {
      stopRef.current();
      stopRef.current = () => {};
    };
  }, [open, orderId, payUrl, successUrl, domain, apiBaseUrl, navigate, cancel]);

  const onFrameLoad = useCallback(() => {
    if (!optsRef.current.open || doneRef.current) return;
    let href: string;
    try {
      const h = frameRef.current?.contentWindow?.location.href;
      if (!h) return;
      href = h;
    } catch {
      return; // cross-origin: the pay page is still showing
    }
    const here = parse(href);
    if (!here) return;
    const o = optsRef.current;
    const success = parse(o.successUrl);
    const cancelU = parse(o.cancelUrl);
    if (success && samePage(here, success) && here.searchParams.get('orderId') === o.orderId) {
      navigate(withOrderId(o.successUrl, o.orderId));
    } else if (cancelU && samePage(here, cancelU)) {
      cancel();
    }
  }, [navigate, cancel]);

  const close = useCallback(() => {
    // After any outcome (a navigation was issued, or a cancel already reported) close does nothing.
    if (doneRef.current) return;
    doneRef.current = true;
    stopRef.current();
    optsRef.current.onClose?.();
  }, []);

  useEffect(() => () => stopRef.current(), []);

  return { frameRef, onFrameLoad, close };
}

/**
 * For a page that may be rendered inside the pop-up frame (the cancel page): when framed by a
 * same-origin top window, loads this page in the top window instead. No-op when not framed, when the
 * top is cross-origin, or when anything throws.
 */
export function breakOutOfFrame(): void {
  try {
    if (window.self === window.top) return;
    const top = window.top;
    if (!top || top.location.origin !== window.location.origin) return;
    top.location.assign(window.location.href);
  } catch {
    /* cross-origin top: stay */
  }
}
