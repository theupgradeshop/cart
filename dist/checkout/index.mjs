'use client';

// src/checkout/bodies.ts
function compact(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) if (v !== void 0) out[k] = v;
  return out;
}
function buildCartDoorBody(input) {
  const n = input.selectedInstallments;
  return compact({
    contract: 2,
    domain: input.domain,
    customer: compact({ ...input.customer }),
    items: input.items.map((i) => compact({ ...i })),
    couponCode: input.couponCode,
    language: input.language,
    marketingConsent: input.marketingConsent,
    shipping_address: input.shippingAddress,
    selectedInstallments: typeof n === "number" && Number.isInteger(n) && n > 1 ? n : void 0,
    successUrl: input.successUrl,
    cancelUrl: input.cancelUrl
  });
}
function buildFunnelDoorBody(input) {
  return compact({
    contract: 2,
    stepId: input.stepId,
    email: input.email,
    name: input.name,
    phone: input.phone,
    couponCode: input.couponCode,
    shipping_address: input.shippingAddress,
    utms: input.utms,
    session_id: input.sessionId,
    visitor_id: input.visitorId,
    successUrl: input.successUrl,
    cancelUrl: input.cancelUrl
  });
}

// src/checkout/errors.ts
var KNOWN = /* @__PURE__ */ new Set([
  "generic",
  "invalid_request",
  "order_not_found",
  "module_disabled",
  "gateway_not_configured",
  "unsupported_provider",
  "prerequisite_missing",
  "cohort_unavailable",
  "cohort_dates_unavailable",
  "cohort_identity_registered",
  "coupon_limit_reached",
  "coupon_invalid",
  "product_unavailable",
  "subscription_unavailable",
  "invalid_return_url",
  "payment_unavailable",
  "upsell_unavailable",
  "installments_unavailable",
  "shipping_address_required"
]);
var CHECKOUT_ERROR_KEYS = [...KNOWN, "rate_limited", "network"];
var BRAND = /* @__PURE__ */ Symbol.for("upgradeshop.checkout.error");
function isCheckoutError(e) {
  return typeof e === "object" && e !== null && e[BRAND] === true;
}
var _a, _b;
var CheckoutError = class extends (_b = Error, _a = BRAND, _b) {
  constructor(key, status, items) {
    super(key);
    this[_a] = true;
    if (items) this.items = items;
    this.name = "CheckoutError";
    this.key = key;
    this.status = status;
  }
};
function checkoutErrorKey(status, code) {
  if (status === 429) return "rate_limited";
  if (typeof code === "string" && KNOWN.has(code)) return code;
  return "generic";
}

// src/checkout/storage.ts
var PREFIX = "upgradeshop.checkout.ownership.";
function storeOwnershipToken(orderId, token) {
  try {
    window.sessionStorage.setItem(PREFIX + orderId, token);
  } catch {
  }
}
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

// src/checkout/validate.ts
function isFiniteNumber(x) {
  return typeof x === "number" && Number.isFinite(x);
}
function isSafeNavigationUrl(u) {
  if (typeof u !== "string" || !u) return false;
  try {
    const p = new URL(u);
    return p.protocol === "https:" || p.protocol === "http:" && p.hostname === "localhost";
  } catch {
    return false;
  }
}
function isSafeFunnelNextUrl(u) {
  if (/[\u0000-\u0020\u007f]/.test(u)) return false;
  if (u.startsWith("/")) {
    try {
      return new URL(u, "https://x.invalid").origin === "https://x.invalid";
    } catch {
      return false;
    }
  }
  try {
    const p = new URL(u);
    return p.protocol === "https:" || p.protocol === "http:";
  } catch {
    return false;
  }
}
function parseTotals(t) {
  if (!t || typeof t !== "object") return null;
  const r = t;
  if (!isFiniteNumber(r.subtotal) || !isFiniteNumber(r.discount) || !isFiniteNumber(r.shipping) || !isFiniteNumber(r.total) || r.total < 0 || typeof r.currency !== "string" || !r.currency) {
    return null;
  }
  return { subtotal: r.subtotal, discount: r.discount, shipping: r.shipping, total: r.total, currency: r.currency };
}
function parseV2Response(x) {
  if (!x || typeof x !== "object") return null;
  const r = x;
  if (typeof r.orderId !== "string" || !r.orderId) return null;
  if (typeof r.orderNumber !== "string") return null;
  if (typeof r.ownershipToken !== "string" || !r.ownershipToken) return null;
  const totals = parseTotals(r.totals);
  if (!totals) return null;
  const n = r.next;
  if (!n || typeof n !== "object") return null;
  let next;
  if (n.kind === "pay") {
    if (!isSafeNavigationUrl(n.url)) return null;
    next = n.display === "redirect" ? { kind: "pay", url: n.url, display: "redirect" } : { kind: "pay", url: n.url };
  } else if (n.kind === "none") {
    next = { kind: "none" };
  } else {
    return null;
  }
  const out = {
    orderId: r.orderId,
    orderNumber: r.orderNumber,
    totals,
    ownershipToken: r.ownershipToken,
    next
  };
  if (r.funnelNextUrl !== void 0) {
    out.funnelNextUrl = typeof r.funnelNextUrl === "string" && isSafeFunnelNextUrl(r.funnelNextUrl) ? r.funnelNextUrl : null;
  }
  return out;
}

// src/checkout/start-checkout.ts
function thankYouUrl(thankYouPath, orderId) {
  const hash = thankYouPath.indexOf("#");
  const path = hash === -1 ? thankYouPath : thankYouPath.slice(0, hash);
  const frag = hash === -1 ? "" : thankYouPath.slice(hash);
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}orderId=${encodeURIComponent(orderId)}${frag}`;
}
async function startCheckout(input) {
  const base = input.apiBaseUrl.replace(/\/+$/, "");
  const url = input.door === "cart" ? `${base}/api/public/checkout` : `${base}/api/public/funnels/checkout`;
  const body = input.door === "cart" ? buildCartDoorBody(input) : buildFunnelDoorBody(input);
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
  } catch {
    throw new CheckoutError("network", 0);
  }
  let json = null;
  try {
    json = await res.json();
  } catch {
  }
  if (!res.ok) {
    const b = json && typeof json === "object" ? json : {};
    const key = checkoutErrorKey(res.status, b.code);
    const items = key === "product_unavailable" && Array.isArray(b.items) && b.items.every((i) => typeof i === "string") ? b.items : void 0;
    throw new CheckoutError(key, res.status, items);
  }
  const parsed = parseV2Response(json);
  if (!parsed) throw new CheckoutError("generic", res.status);
  const order = parsed;
  storeOwnershipToken(order.orderId, order.ownershipToken);
  const result = {
    orderId: order.orderId,
    orderNumber: order.orderNumber,
    totals: order.totals,
    next: order.next,
    ...order.funnelNextUrl !== void 0 ? { funnelNextUrl: order.funnelNextUrl } : {}
  };
  const navigate = input.navigate ?? ((u) => window.location.assign(u));
  navigate(order.next.kind === "pay" ? order.next.url : thankYouUrl(input.thankYouPath, order.orderId));
  return result;
}

// src/checkout/thank-you.ts
var POLL_INTERVAL_MS = 4e3;
var POLL_MAX_REQUESTS = 12;
var TERMINAL_FINANCIAL_STATUSES = ["paid", "failed", "cancelled", "refunded"];
function isInSameOriginFrame() {
  try {
    if (window.self === window.top) return false;
    return window.top.location.origin === window.location.origin;
  } catch {
    return false;
  }
}
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
function paymentFields(order) {
  if (!order || typeof order.paymentState !== "string" || !order.paymentState) return {};
  return typeof order.paymentMessage === "string" && order.paymentMessage ? { paymentState: order.paymentState, paymentMessage: order.paymentMessage } : { paymentState: order.paymentState };
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
  const url = `${base}/api/public/orders/${encodeURIComponent(orderId)}?domain=${encodeURIComponent(opts.domain)}${opts.locale ? `&locale=${encodeURIComponent(opts.locale)}` : ""}`;
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const framed = isInSameOriginFrame();
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
      if (res.status === 429) return { state: "not_received", order: last, full, requests, ...paymentFields(last) };
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
            if (!opts.keepToken && !framed) clearOwnershipToken(orderId);
            if (state === "paid" && !framed) safely(() => opts.onPaid?.(json));
            return { state, order: json, full, requests, ...state === "declined" ? paymentFields(json) : {} };
          }
          safely(() => opts.onUpdate?.(json));
        }
      }
    }
  }
  return { state: "not_received", order: last, full, requests, ...paymentFields(last) };
}

// src/checkout/use-thank-you-order.ts
import { useEffect, useRef, useState } from "react";
var NO_ORDER = { status: "done", state: "not_found", order: null, full: false, requests: 0 };
function useThankYouOrder(orderId, opts) {
  const [state, setState] = useState(
    orderId ? { status: "confirming", order: null } : NO_ORDER
  );
  const { domain, apiBaseUrl, locale } = opts;
  const onPaidRef = useRef(opts.onPaid);
  onPaidRef.current = opts.onPaid;
  useEffect(() => {
    if (!orderId) {
      setState(NO_ORDER);
      return;
    }
    setState({ status: "confirming", order: null });
    if (isInSameOriginFrame()) return;
    const ctl = new AbortController();
    getOrderForThankYou(orderId, {
      domain,
      apiBaseUrl,
      locale,
      onPaid: (order) => onPaidRef.current?.(order),
      signal: ctl.signal,
      onUpdate: (order) => {
        if (!ctl.signal.aborted) setState({ status: "confirming", order });
      }
    }).then((result) => {
      if (!ctl.signal.aborted) setState({ status: "done", ...result });
    }).catch(() => {
      if (!ctl.signal.aborted) setState({ status: "done", state: "not_received", order: null, full: false, requests: 0 });
    });
    return () => ctl.abort();
  }, [orderId, domain, apiBaseUrl, locale]);
  return state;
}

// src/checkout/use-link-coupon.ts
import { useEffect as useEffect2, useRef as useRef2 } from "react";
function useLinkCoupon(o) {
  const tried = useRef2("");
  const latest = useRef2(o);
  latest.current = o;
  const sig = o.ready ? `${o.lines.map((l) => `${l.slug}:${l.quantity ?? 1}:${l.price}`).join("|")}#${o.subtotal}` : "";
  useEffect2(() => {
    if (!sig || o.appliedCode || o.hasTypedText || !o.collecting) return;
    const pending = o.readPending();
    if (!pending) return;
    const attempt = `${pending.code}@${sig}`;
    if (tried.current === attempt) return;
    tried.current = attempt;
    let cancelled = false;
    let delivered = false;
    const base = o.apiBaseUrl.replace(/\/+$/, "");
    (async () => {
      try {
        const res = await fetch(`${base}/api/public/coupons/validate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            domain: o.domain,
            code: pending.code,
            items: o.lines.map((l) => ({ productSlug: l.slug, quantity: l.quantity ?? 1, price: l.price })),
            subtotal: o.subtotal
          })
        });
        const data = await res.json();
        if (cancelled) return;
        delivered = true;
        const now = latest.current;
        if (now.appliedCode || now.hasTypedText || !now.collecting) return;
        if (data?.valid && typeof data.discount?.amount === "number" && typeof data.coupon?.code === "string") {
          now.onApply({ code: data.coupon.code, discountAmount: data.discount.amount });
        }
      } catch {
      }
    })();
    return () => {
      cancelled = true;
      if (!delivered) tried.current = "";
    };
  }, [sig, o.appliedCode, o.hasTypedText, o.collecting]);
}

// src/checkout/capabilities.ts
function maxInstallmentsFor(total, capabilities) {
  const base = Number.isFinite(capabilities.installmentsMax) ? Math.max(1, Math.floor(capabilities.installmentsMax)) : 1;
  const rules = capabilities.installmentRules ?? [];
  if (rules.length === 0) return base;
  if (!Number.isFinite(total)) return 1;
  const t = Math.round(Math.max(0, total));
  const match = [...rules].sort((a, b) => b.minAmount - a.minAmount).find((r) => t >= r.minAmount);
  return match ? match.maxPayments : 1;
}
export {
  CHECKOUT_ERROR_KEYS,
  CheckoutError,
  POLL_INTERVAL_MS,
  POLL_MAX_REQUESTS,
  TERMINAL_FINANCIAL_STATUSES,
  buildCartDoorBody,
  buildFunnelDoorBody,
  checkoutErrorKey,
  getOrderForThankYou,
  isCheckoutError,
  maxInstallmentsFor,
  startCheckout,
  useLinkCoupon,
  useThankYouOrder
};
