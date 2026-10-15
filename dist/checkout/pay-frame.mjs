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
function clearOwnershipToken(orderId) {
  try {
    window.sessionStorage.removeItem(PREFIX + orderId);
  } catch {
  }
}

// src/checkout/thank-you.ts
var POLL_INTERVAL_MS = 4e3;
var POLL_MAX_REQUESTS = 12;
function stateFor(financialStatus) {
  switch (financialStatus) {
    case "paid":
      return "paid";
    case "failed":
    case "cancelled":
      return "declined";
    case "refunded":
      return "refunded";
    default:
      return null;
  }
}
function safely(fn) {
  try {
    fn();
  } catch {
  }
}
function sleep(ms, signal) {
  return new Promise((resolve) => {
    const onAbort = () => {
      clearTimeout(t);
      resolve();
    };
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
async function getOrderForThankYou(orderId, opts) {
  const base = opts.apiBaseUrl.replace(/\/+$/, "");
  const token = readOwnershipToken(orderId);
  const url = `${base}/api/public/orders/${encodeURIComponent(orderId)}?domain=${encodeURIComponent(opts.domain)}`;
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  let requests = 0;
  let last = null;
  let full = false;
  while (requests < POLL_MAX_REQUESTS) {
    if (opts.signal?.aborted) break;
    if (requests > 0) {
      await sleep(POLL_INTERVAL_MS, opts.signal);
      if (opts.signal?.aborted) break;
    }
    requests += 1;
    let res = null;
    try {
      res = await fetch(url, { headers, signal: opts.signal });
    } catch {
      res = null;
    }
    if (opts.signal?.aborted) break;
    if (res) {
      if (res.status === 429) return { state: "not_received", order: last, full, requests };
      if (res.status === 404) return { state: "not_found", order: null, full: false, requests };
      if (res.ok) {
        let json = null;
        try {
          json = await res.json();
        } catch {
          json = null;
        }
        if (opts.signal?.aborted) break;
        if (json && typeof json.financialStatus === "string") {
          last = json;
          full = "customerEmail" in json;
          const state = stateFor(json.financialStatus);
          if (state) {
            if (!opts.keepToken) clearOwnershipToken(orderId);
            if (state === "paid") safely(() => opts.onPaid?.(json));
            return { state, order: json, full, requests };
          }
          safely(() => opts.onUpdate?.(json));
        }
      }
    }
  }
  return { state: "not_received", order: last, full, requests };
}

// src/checkout/use-pay-frame.ts
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
    getOrderForThankYou(orderId, { domain, apiBaseUrl, signal: ctl.signal, keepToken: true }).then((r) => {
      if (!ctl.signal.aborted && r.state === "paid") navigate(target);
    }).catch(() => {
    });
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
      navigate(href);
    } else if (cancelU && samePage(here, cancelU)) {
      cancel();
    }
  }, [navigate, cancel]);
  const close = useCallback(() => {
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
  breakOutOfFrame,
  usePayFrame
};
