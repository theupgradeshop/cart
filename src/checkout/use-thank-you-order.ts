import { useEffect, useRef, useState } from 'react';
import { getOrderForThankYou } from './thank-you';
import type { OrderFull, OrderThin, ThankYouResult } from './types';

export interface UseThankYouOrderOptions {
  domain: string;
  /** Dashboard base URL. Required: nothing is assumed on the money path. */
  apiBaseUrl: string;
  /** Fires once on a terminal PAID status: clear the cart and the pending coupon here. */
  onPaid?: (order: OrderThin | OrderFull) => void;
}

export type UseThankYouOrderResult =
  | { status: 'confirming'; order: OrderThin | OrderFull | null }
  | ({ status: 'done' } & ThankYouResult);

const NO_ORDER: UseThankYouOrderResult = { status: 'done', state: 'not_found', order: null, full: false, requests: 0 };

/** Drives the thank-you page: `confirming` while polling, then `done` with one of the states. */
export function useThankYouOrder(orderId: string | null, opts: UseThankYouOrderOptions): UseThankYouOrderResult {
  const [state, setState] = useState<UseThankYouOrderResult>(
    orderId ? { status: 'confirming', order: null } : NO_ORDER,
  );
  const { domain, apiBaseUrl } = opts;
  const onPaidRef = useRef(opts.onPaid);
  onPaidRef.current = opts.onPaid;

  useEffect(() => {
    if (!orderId) {
      setState(NO_ORDER);
      return;
    }
    const ctl = new AbortController();
    setState({ status: 'confirming', order: null });
    getOrderForThankYou(orderId, {
      domain,
      apiBaseUrl,
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
  }, [orderId, domain, apiBaseUrl]);

  return state;
}
