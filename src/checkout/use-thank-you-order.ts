import { useEffect, useRef, useState } from 'react';
import { getOrderForThankYou, isInSameOriginFrame, watchOrderForThankYou } from './thank-you';
import type { OrderFull, OrderThin, ThankYouResult } from './types';

export interface UseThankYouOrderOptions {
  domain: string;
  /** Dashboard base URL. Required: nothing is assumed on the money path. */
  apiBaseUrl: string;
  /** Fires once on a terminal PAID status: clear the cart and the pending coupon here. */
  onPaid?: (order: OrderThin | OrderFull) => void;
  /** The page language; sent so the dashboard's `paymentMessage` is written in it. */
  locale?: string;
  /**
   * Default true. When the short poll ends with the order still pending (`not_received`), keep checking on the slow
   * watch (`SLOW_WATCH_GAPS_MS`, at most 8 more requests over about 12 minutes) so a late gateway confirmation still
   * reaches `paid` and `onPaid`. `false` stops after the short poll, exactly as before.
   */
  keepWatching?: boolean;
}

export type UseThankYouOrderResult =
  | { status: 'confirming'; order: OrderThin | OrderFull | null }
  /** `watching` is true only while the slow watch is running after a `not_received` result; otherwise the key is absent. */
  | ({ status: 'done'; watching?: boolean } & ThankYouResult);

const NO_ORDER: UseThankYouOrderResult = { status: 'done', state: 'not_found', order: null, full: false, requests: 0 };

/** Drives the thank-you page: `confirming` while polling, then `done` with one of the states (a `not_received` may later turn `paid` while `watching`, unless `keepWatching` is false). Inside a same-origin frame it never polls. */
export function useThankYouOrder(orderId: string | null, opts: UseThankYouOrderOptions): UseThankYouOrderResult {
  const [state, setState] = useState<UseThankYouOrderResult>(
    orderId ? { status: 'confirming', order: null } : NO_ORDER,
  );
  const { domain, apiBaseUrl, locale } = opts;
  const keepWatching = opts.keepWatching !== false;
  const onPaidRef = useRef(opts.onPaid);
  onPaidRef.current = opts.onPaid;

  useEffect(() => {
    if (!orderId) {
      setState(NO_ORDER);
      return;
    }
    setState({ status: 'confirming', order: null });
    // In a same-origin frame (the pay pop-up's iframe): do not poll, clear the token or run onPaid. The pay pop-up sends the
    // top window to this page, which then reads the full order. Stay in `confirming` until that happens.
    if (isInSameOriginFrame()) return;
    const ctl = new AbortController();
    getOrderForThankYou(orderId, {
      domain,
      apiBaseUrl,
      locale,
      onPaid: (order) => onPaidRef.current?.(order),
      signal: ctl.signal,
      onUpdate: (order) => { if (!ctl.signal.aborted) setState({ status: 'confirming', order }); },
    })
      .then(async (result) => {
        if (ctl.signal.aborted) return;
        if (result.state !== 'not_received' || !keepWatching) {
          setState({ status: 'done', ...result });
          return;
        }
        setState({ status: 'done', ...result, watching: true });
        const watched = await watchOrderForThankYou(orderId, {
          domain,
          apiBaseUrl,
          locale,
          onPaid: (order) => onPaidRef.current?.(order),
          signal: ctl.signal,
        });
        if (ctl.signal.aborted) return;
        if (!watched) { setState({ status: 'done', ...result }); return; }
        setState({ status: 'done', ...watched, requests: result.requests + watched.requests });
      })
      .catch(() => {
        if (!ctl.signal.aborted) setState({ status: 'done', state: 'not_received', order: null, full: false, requests: 0 });
      });
    return () => ctl.abort();
  }, [orderId, domain, apiBaseUrl, locale, keepWatching]);

  return state;
}
