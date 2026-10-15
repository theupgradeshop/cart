import { RefObject } from 'react';

/**
 * Gaps between the order polls of the pop-up, in ms: the first request is immediate, then 4 s x5, 15 s x4,
 * 45 s x4. That is 14 requests over 260 s (about 4.3 minutes), so the pop-up's 14 plus the thank-you page's
 * 12 stay under the orders route's 30 per 15 minutes, with room for one reload.
 */
declare const PAY_FRAME_POLL_GAPS_MS: readonly number[];
/** The optional signal the dashboard pay page may post to its parent. Anything else is ignored. */
interface PayFrameMessage {
    type: 'tus-payment';
    status: 'paid' | 'cancelled';
    orderId: string;
}
interface UsePayFrameOptions {
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
interface UsePayFrameResult {
    /** Attach to the iframe: `ref={frameRef}`. */
    frameRef: RefObject<HTMLIFrameElement>;
    /** Call from the iframe's `onLoad`. Same-origin success / cancel URLs are detected; a cross-origin frame is ignored. */
    onFrameLoad: () => void;
    /** Stops polling and the message listener, then calls onClose. Close = Back: nothing else changes. */
    close: () => void;
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
declare function usePayFrame(opts: UsePayFrameOptions): UsePayFrameResult;
/**
 * For a page that may be rendered inside the pop-up frame (the cancel page): when framed by a
 * same-origin top window, loads this page in the top window instead. No-op when not framed, when the
 * top is cross-origin, or when anything throws.
 */
declare function breakOutOfFrame(): void;

export { PAY_FRAME_POLL_GAPS_MS, type PayFrameMessage, type UsePayFrameOptions, type UsePayFrameResult, breakOutOfFrame, usePayFrame };
