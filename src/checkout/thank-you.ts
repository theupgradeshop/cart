import { clearOwnershipToken, readOwnershipToken } from './storage';
import {
  type OrderFull,
  type OrderThin,
  type ThankYouResult,
  type ThankYouState,
} from './types';

export const POLL_INTERVAL_MS = 4000;
/** 12 requests per visit, inside the orders route's 30 per 15 minutes (a reload adds up to 12 more). */
export const POLL_MAX_REQUESTS = 12;
/**
 * The "slow watch" that `useThankYouOrder` starts when the short poll above ends with the order still pending: one
 * request after each gap (15 s, 30 s, 60 s, then 120 s x5), i.e. at most 8 more requests over 705 s (about 11.75 minutes).
 * Short poll 12 + slow watch 8 = 20, under the orders route's 30 per 15 minutes per IP + order, which leaves room for the
 * pay pop-up's own poll. Every request uses one of the 8, a 429 included; a 429 also doubles the next gap (the gap, not the sum). Gaps are only waited while the tab is visible.
 */
export const SLOW_WATCH_GAPS_MS: readonly number[] = [15000, 30000, 60000, 120000, 120000, 120000, 120000, 120000];

/**
 * `financialStatus` values after which the order will not change by itself.
 * `partially_paid` is deliberately NOT terminal: it only comes from manual payments, never from a
 * template checkout, and if it ever shows up the page keeps polling and ends in `not_received`.
 */
export const TERMINAL_FINANCIAL_STATUSES: readonly string[] = ['paid', 'failed', 'cancelled', 'refunded'];

/**
 * True inside a frame whose top window is on the SAME origin (the pay pop-up's iframe landing on the
 * thank-you page). A cross-origin top (reading it throws, or its origin differs) is false: a site embedded
 * by someone else keeps behaving as an unframed page.
 */
export function isInSameOriginFrame(): boolean {
  try {
    if (window.self === window.top) return false;
    return window.top!.location.origin === window.location.origin;
  } catch {
    return false;
  }
}

function stateFor(financialStatus: string): ThankYouState | null {
  switch (financialStatus) {
    case 'paid':
      return 'paid';
    case 'failed':
    case 'cancelled':
      return 'declined';
    case 'refunded':
      return 'refunded';
    default:
      return null;
  }
}

export interface GetOrderForThankYouOptions {
  domain: string;
  /** Dashboard base URL. Required: nothing is assumed on the money path. */
  apiBaseUrl: string;
  /** Called after each non-terminal answer, so the page can keep showing "confirming". */
  onUpdate?: (order: OrderThin | OrderFull) => void;
  /** Called once when a terminal PAID status is seen: the site clears its cart (and pending coupon) here. */
  onPaid?: (order: OrderThin | OrderFull) => void;
  /** Stops polling (component unmount). An aborted run never clears the token, never calls onPaid and never returns a terminal state. */
  signal?: AbortSignal;
  /** Keep the ownership token after a terminal status (the pay pop-up navigates to the thank-you page, which still needs it). Default false. */
  keepToken?: boolean;
  /** The page language (`en`, `he`, ...). Sent as `&locale=` so the dashboard writes `paymentMessage` in it; omitted, the order's own language is used. */
  locale?: string;
}

/** The two payment fields of the latest answer, only when the dashboard sent a non-null `paymentState`; otherwise nothing (the result keeps today's shape). */
function paymentFields(order: OrderThin | OrderFull | null): { paymentState?: string; paymentMessage?: string } {
  if (!order || typeof order.paymentState !== 'string' || !order.paymentState) return {};
  return typeof order.paymentMessage === 'string' && order.paymentMessage
    ? { paymentState: order.paymentState, paymentMessage: order.paymentMessage }
    : { paymentState: order.paymentState };
}

/** A site callback that throws must never stop the result from returning. */
function safely(fn: () => void): void {
  try { fn(); } catch { /* the site's callback failed; the order result is unaffected */ }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const onAbort = () => { clearTimeout(t); resolve(); };
    const t = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function orderRequest(orderId: string, opts: { domain: string; apiBaseUrl: string; locale?: string }): { url: string; headers: Record<string, string> } {
  const base = opts.apiBaseUrl.replace(/\/+$/, '');
  const token = readOwnershipToken(orderId);
  // The token travels in a header and never in a URL.
  const url = `${base}/api/public/orders/${encodeURIComponent(orderId)}?domain=${encodeURIComponent(opts.domain)}${opts.locale ? `&locale=${encodeURIComponent(opts.locale)}` : ''}`;
  return { url, headers: token ? { Authorization: `Bearer ${token}` } : {} };
}

/**
 * Reads the order for the thank-you page. With a stored ownership token the full shape comes back;
 * without one (another tab or device) the thin shape (number, items, total, status). While the status
 * is not terminal it polls every 4 s, at most 12 requests. The token is sent as `Authorization: Bearer`. A 429 is non-terminal and ends polling in
 * `not_received`. The token is cleared only after a terminal status. `onPaid` fires only on `paid`.
 */
export async function getOrderForThankYou(orderId: string, opts: GetOrderForThankYouOptions): Promise<ThankYouResult> {
  const { url, headers } = orderRequest(orderId, opts);

  // Inside a same-origin frame (the pay pop-up's iframe landing on the thank-you page) the token stays in the shared
  // sessionStorage and the cart is not cleared: the top window reloads this page and must get the full order.
  const framed = isInSameOriginFrame();
  let requests = 0;
  let last: OrderThin | OrderFull | null = null;
  let full = false;

  while (requests < POLL_MAX_REQUESTS) {
    if (opts.signal?.aborted) break;
    if (requests > 0) {
      await sleep(POLL_INTERVAL_MS, opts.signal);
      if (opts.signal?.aborted) break;
    }
    requests += 1;

    let res: Response | null = null;
    try {
      res = await fetch(url, { headers, signal: opts.signal });
    } catch {
      res = null; // network blip or abort: non-terminal
    }
    if (opts.signal?.aborted) break;

    if (res) {
      if (res.status === 429) return { state: 'not_received', order: last, full, requests, ...paymentFields(last) };
      if (res.status === 404) return { state: 'not_found', order: null, full: false, requests };
      if (res.ok) {
        let json: (OrderThin | OrderFull) | null = null;
        try {
          json = (await res.json()) as OrderThin | OrderFull;
        } catch {
          json = null;
        }
        if (opts.signal?.aborted) break;
        if (json && typeof json.financialStatus === 'string') {
          last = json;
          full = 'customerEmail' in json;
          const state = stateFor(json.financialStatus);
          if (state) {
            if (!opts.keepToken && !framed) clearOwnershipToken(orderId);
            if (state === 'paid' && !framed) safely(() => opts.onPaid?.(json!));
            return { state, order: json, full, requests, ...(state === 'declined' ? paymentFields(json) : {}) };
          }
          safely(() => opts.onUpdate?.(json!));
        }
      }
    }
  }
  return { state: 'not_received', order: last, full, requests, ...paymentFields(last) };
}

/** Resolves when the tab is visible (at once if it already is) or the signal aborts. */
function whenVisible(signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (typeof document === 'undefined' || document.visibilityState !== 'hidden' || signal?.aborted) { resolve(); return; }
    const done = () => {
      document.removeEventListener('visibilitychange', onChange);
      signal?.removeEventListener('abort', done);
      resolve();
    };
    const onChange = () => { if (document.visibilityState !== 'hidden') done(); };
    document.addEventListener('visibilitychange', onChange);
    signal?.addEventListener('abort', done, { once: true });
  });
}

export interface WatchOrderForThankYouOptions {
  domain: string;
  apiBaseUrl: string;
  locale?: string;
  /** Called once when a terminal PAID status is seen (not while the page is in a same-origin frame, which the hook already excludes). */
  onPaid?: (order: OrderThin | OrderFull) => void;
  /** Called after each non-terminal answer. */
  onUpdate?: (order: OrderThin | OrderFull) => void;
  /** Aborts the watch (unmount or a changed orderId): no more requests, no onPaid, no token clear, resolves with `null`. */
  signal?: AbortSignal;
  /** Keep the ownership token after a terminal status. Default false. */
  keepToken?: boolean;
}

/**
 * The slow watch (see `SLOW_WATCH_GAPS_MS`): after each gap, one request, at most `SLOW_WATCH_GAPS_MS.length` in all.
 * While the tab is hidden it makes no request; when it becomes visible it checks at once (that check uses one of the
 * slots) and then goes on with the schedule. Every request uses one of the slots, a 429
 * included; a 429 is not a failure, it also doubles the next gap. Any other error likewise uses its slot and the watch goes on. A terminal status ends it (token cleared unless `keepToken`, `onPaid` on `paid`);
 * a 404 ends it as `not_found`. If the budget runs out the result is `not_received` with the latest order. An abort resolves `null`.
 * `requests` in the result counts the slow-watch requests only.
 */
export async function watchOrderForThankYou(orderId: string, opts: WatchOrderForThankYouOptions): Promise<ThankYouResult | null> {
  const { signal } = opts;
  let requests = 0;
  let last: OrderThin | OrderFull | null = null;
  let full = false;
  let doubleNext = false;

  for (let i = 0; i < SLOW_WATCH_GAPS_MS.length; i += 1) {
    await sleep(SLOW_WATCH_GAPS_MS[i] * (doubleNext ? 2 : 1), signal);
    doubleNext = false;
    if (signal?.aborted) return null;
    await whenVisible(signal);
    if (signal?.aborted) return null;
    requests += 1;

    // Re-read the token each time: it never changes during a watch, but a header built now is always current.
    const { url, headers } = orderRequest(orderId, opts);
    let res: Response | null = null;
    try {
      res = await fetch(url, { headers, signal });
    } catch {
      res = null; // network blip or abort: non-terminal
    }
    if (signal?.aborted) return null;
    if (!res) continue;
    if (res.status === 429) { doubleNext = true; continue; }
    if (res.status === 404) return { state: 'not_found', order: null, full: false, requests };
    if (!res.ok) continue;
    let json: (OrderThin | OrderFull) | null = null;
    try {
      json = (await res.json()) as OrderThin | OrderFull;
    } catch {
      json = null;
    }
    if (signal?.aborted) return null;
    if (!json || typeof json.financialStatus !== 'string') continue;
    last = json;
    full = 'customerEmail' in json;
    const state = stateFor(json.financialStatus);
    if (state) {
      if (!opts.keepToken) clearOwnershipToken(orderId);
      if (state === 'paid') safely(() => opts.onPaid?.(json!));
      return { state, order: json, full, requests, ...(state === 'declined' ? paymentFields(json) : {}) };
    }
    safely(() => opts.onUpdate?.(json!));
  }
  return { state: 'not_received', order: last, full, requests, ...paymentFields(last) };
}
