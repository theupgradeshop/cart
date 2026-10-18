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

/**
 * Reads the order for the thank-you page. With a stored ownership token the full shape comes back;
 * without one (another tab or device) the thin shape (number, items, total, status). While the status
 * is not terminal it polls every 4 s, at most 12 requests. The token is sent as `Authorization: Bearer`. A 429 is non-terminal and ends polling in
 * `not_received`. The token is cleared only after a terminal status. `onPaid` fires only on `paid`.
 */
export async function getOrderForThankYou(orderId: string, opts: GetOrderForThankYouOptions): Promise<ThankYouResult> {
  const base = opts.apiBaseUrl.replace(/\/+$/, '');
  const token = readOwnershipToken(orderId);
  // The token travels in a header and never in a URL.
  const url = `${base}/api/public/orders/${encodeURIComponent(orderId)}?domain=${encodeURIComponent(opts.domain)}${opts.locale ? `&locale=${encodeURIComponent(opts.locale)}` : ''}`;
  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};

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
