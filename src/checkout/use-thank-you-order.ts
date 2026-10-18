import { useEffect, useRef, useState } from 'react';
import { getOrderForThankYou, isInSameOriginFrame } from './thank-you';
import type { OrderFull, OrderThin, ThankYouResult } from './types';

export interface UseThankYouOrderOptions {
  domain: string;
  /** Dashboard base URL. Required: nothing is assumed on the money path. */
  apiBaseUrl: string;
  /** Fires once on a terminal PAID status: clear the cart and the pending coupon here. */
  onPaid?: (order: OrderThin | OrderFull) => void;
  /** The page language; sent so the dashboard's `paymentMessage` is written in it. */
  locale?: string;
}

export type UseThankYouOrderResult =
  | { status: 'confirming'; order: OrderThin | OrderFull | null }
  | ({ status: 'done' } & ThankYouResult);

const NO_ORDER: UseThankYouOrderResult = { status: 'done', state: 'not_found', order: null, full: false, requests: 0 };

/** Drives the thank-you page: `confirming` while polling, then `done` with one of the states. Inside a same-origin frame it never polls. */
export function useThankYouOrder(orderId: string | null, opts: UseThankYouOrderOptions): UseThankYouOrderResult {
  const [state, setState] = useState<UseThankYouOrderResult>(
    orderId ? { status: 'confirming', order: null } : NO_ORDER,
  );
  const { domain, apiBaseUrl, locale } = opts;
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
      .then((result) => {
        if (!ctl.signal.aborted) setState({ status: 'done', ...result });
      })
      .catch(() => {
        if (!ctl.signal.aborted) setState({ status: 'done', state: 'not_received', order: null, full: false, requests: 0 });
      });
    return () => ctl.abort();
  }, [orderId, domain, apiBaseUrl, locale]);

  return state;
}
