'use client';

// src/checkout/use-pay-frame.ts
import { useCallback, useEffect, useRef } from "react";

// src/checkout/storage.ts
var PREFIX = "upgradeshop.checkout.ownership.";
function readOwnershipToken(orderId) {
  try {
    return window.sessionStorage.getItem(PREFIX + orderId);
  } catch {
    return null;
  }
}

// src/checkout/use-pay-frame.ts
var PAY_FRAME_POLL_GAPS_MS = [
  4e3,
  4e3,
  4e3,
  4e3,
  4e3,
  15e3,
  15e3,
  15e3,
  15e3,
  45e3,
  45e3,
  45e3,
  45e3
];
function withOrderId(url, orderId) {
  const hash = url.indexOf("#");
  const path = hash === -1 ? url : url.slice(0, hash);
  const frag = hash === -1 ? "" : url.slice(hash);
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}orderId=${encodeURIComponent(orderId)}${frag}`;
}
function normPath(p) {
  return p.length > 1 ? p.replace(/\/+$/, "") : p;
}
function samePage(a, b) {
  return a.origin === b.origin && normPath(a.pathname) === normPath(b.pathname);
}
function parse(u) {
  try {
    return new URL(u);
  } catch {
    return null;
  }
}
function usePayFrame(opts) {
  const { orderId, payUrl, successUrl, cancelUrl, domain, apiBaseUrl, open } = opts;
  const frameRef = useRef(null);
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const doneRef = useRef(false);
  const stopRef = useRef(() => {
  });
  const navigate = useCallback((url) => {
    if (doneRef.current) return;
    doneRef.current = true;
    stopRef.current();
    (optsRef.current.navigateTop ?? ((u) => window.location.assign(u)))(url);
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
    const onMessage = (e) => {
      if (!payOrigin || e.origin !== payOrigin) return;
      const frameWin = frameRef.current?.contentWindow;
      if (!frameWin || e.source !== frameWin) return;
      const d = e.data;
      if (!d || typeof d !== "object" || d.type !== "tus-payment" || d.orderId !== orderId) return;
      if (d.status === "paid") navigate(target);
      else if (d.status === "cancelled") cancel();
    };
    window.addEventListener("message", onMessage);
    stopRef.current = () => {
      ctl.abort();
      window.removeEventListener("message", onMessage);
    };
    const token = readOwnershipToken(orderId);
    const pollUrl = `${apiBaseUrl.replace(/\/+$/, "")}/api/public/orders/${encodeURIComponent(orderId)}?domain=${encodeURIComponent(domain)}`;
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    let timer = null;
    const prevStop = stopRef.current;
    stopRef.current = () => {
      prevStop();
      if (timer !== null) clearTimeout(timer);
      timer = null;
    };
    const poll = async (n) => {
      if (ctl.signal.aborted) return;
      let end = false;
      try {
        const res = await fetch(pollUrl, { headers, signal: ctl.signal });
        if (ctl.signal.aborted) return;
        if (res.status === 429 || res.status === 404) end = true;
        else if (res.ok) {
          const json = await res.json();
          if (ctl.signal.aborted) return;
          if (json && json.financialStatus === "paid") {
            navigate(target);
            return;
          }
        }
      } catch {
      }
      if (end || ctl.signal.aborted || n >= PAY_FRAME_POLL_GAPS_MS.length) return;
      timer = setTimeout(() => {
        timer = null;
        void poll(n + 1);
      }, PAY_FRAME_POLL_GAPS_MS[n]);
    };
    void poll(0);
    return () => {
      stopRef.current();
      stopRef.current = () => {
      };
    };
  }, [open, orderId, payUrl, successUrl, domain, apiBaseUrl, navigate, cancel]);
  const onFrameLoad = useCallback(() => {
    if (!optsRef.current.open || doneRef.current) return;
    let href;
    try {
      const h = frameRef.current?.contentWindow?.location.href;
      if (!h) return;
      href = h;
    } catch {
      return;
    }
    const here = parse(href);
    if (!here) return;
    const o = optsRef.current;
    const success = parse(o.successUrl);
    const cancelU = parse(o.cancelUrl);
    if (success && samePage(here, success) && here.searchParams.get("orderId") === o.orderId) {
      navigate(withOrderId(o.successUrl, o.orderId));
    } else if (cancelU && samePage(here, cancelU)) {
      cancel();
    }
  }, [navigate, cancel]);
  const close = useCallback(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    stopRef.current();
    optsRef.current.onClose?.();
  }, []);
  useEffect(() => () => stopRef.current(), []);
  return { frameRef, onFrameLoad, close };
}
function breakOutOfFrame() {
  try {
    if (window.self === window.top) return;
    const top = window.top;
    if (!top || top.location.origin !== window.location.origin) return;
    top.location.assign(window.location.href);
  } catch {
  }
}
export {
  PAY_FRAME_POLL_GAPS_MS,
  breakOutOfFrame,
  usePayFrame
};
