// Pay pop-up entry (`@upgradeshop/cart/checkout/pay-frame`, 'use client'): usePayFrame and breakOutOfFrame.
// A separate entry so a site can load it lazily with the pop-up instead of with its checkout form.
export { usePayFrame, breakOutOfFrame, PAY_FRAME_POLL_GAPS_MS } from './use-pay-frame';
export type { UsePayFrameOptions, UsePayFrameResult, PayFrameMessage } from './use-pay-frame';
