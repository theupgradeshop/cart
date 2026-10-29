'use client';
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/checkout/index.ts
var index_exports = {};
__export(index_exports, {
  CHECKOUT_ERROR_KEYS: () => CHECKOUT_ERROR_KEYS,
  CheckoutError: () => CheckoutError,
  MAX_COUPON_CODES: () => MAX_COUPON_CODES,
  POLL_INTERVAL_MS: () => POLL_INTERVAL_MS,
  POLL_MAX_REQUESTS: () => POLL_MAX_REQUESTS,
  TERMINAL_FINANCIAL_STATUSES: () => TERMINAL_FINANCIAL_STATUSES,
  buildCartDoorBody: () => buildCartDoorBody,
  buildCouponValidateBody: () => buildCouponValidateBody,
  buildFunnelDoorBody: () => buildFunnelDoorBody,
  checkoutErrorKey: () => checkoutErrorKey,
  getOrderForThankYou: () => getOrderForThankYou,
  isCheckoutError: () => isCheckoutError,
  maxInstallmentsFor: () => maxInstallmentsFor,
  parseCouponValidation: () => parseCouponValidation,
  startCheckout: () => startCheckout,
  useLinkCoupon: () => useLinkCoupon,
  useThankYouOrder: () => useThankYouOrder
});
module.exports = __toCommonJS(index_exports);

// src/checkout/bodies.ts
function compact(obj2) {
  const out = {};
  for (const [k, v] of Object.entries(obj2)) if (v !== void 0) out[k] = v;
  return out;
}
function manyCodes(codes) {
  return Array.isArray(codes) && codes.length >= 2 ? codes : void 0;
}
function buildCartDoorBody(input) {
  const n = input.selectedInstallments;
  return compact({
    contract: 2,
    domain: input.domain,
    customer: compact({ ...input.customer }),
    items: input.items.map((i) => compact({ ...i })),
    couponCode: input.couponCode,
    couponCodes: manyCodes(input.couponCodes),
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
    couponCodes: manyCodes(input.couponCodes),
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
  "coupon_not_combinable",
  "too_many_coupons",
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
  constructor(key, status, items, coupon) {
    super(key);
    this[_a] = true;
    if (items) this.items = items;
    if (coupon?.couponCode !== void 0) this.couponCode = coupon.couponCode;
    if (coupon?.conflictsWith !== void 0) this.conflictsWith = coupon.conflictsWith;
    if (coupon?.coupons !== void 0) this.coupons = coupon.coupons;
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
var COUPON_KEYS = /* @__PURE__ */ new Set(["coupon_not_combinable", "too_many_coupons", "coupon_invalid", "coupon_limit_reached"]);
function couponRefusal(json) {
  const b = json && typeof json === "object" ? json : {};
  const out = {};
  if (typeof b.couponCode === "string") out.couponCode = b.couponCode;
  if (Array.isArray(b.conflictsWith)) out.conflictsWith = b.conflictsWith.filter((c) => typeof c === "string");
  if (Array.isArray(b.coupons)) {
    out.coupons = b.coupons.filter((c) => !!c && typeof c.code === "string" && typeof c.discount === "number" && Number.isFinite(c.discount)).map((c) => ({ code: c.code, discount: c.discount }));
  }
  return out;
}
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
    throw new CheckoutError(key, res.status, items, COUPON_KEYS.has(key) ? couponRefusal(json) : void 0);
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
var import_react = require("react");
var NO_ORDER = { status: "done", state: "not_found", order: null, full: false, requests: 0 };
function useThankYouOrder(orderId, opts) {
  const [state, setState] = (0, import_react.useState)(
    orderId ? { status: "confirming", order: null } : NO_ORDER
  );
  const { domain, apiBaseUrl, locale } = opts;
  const onPaidRef = (0, import_react.useRef)(opts.onPaid);
  onPaidRef.current = opts.onPaid;
  (0, import_react.useEffect)(() => {
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
var import_react2 = require("react");

// src/checkout/coupon-validation.ts
var MAX_COUPON_CODES = 5;
function buildCouponValidateBody(codes, rest) {
  const list = codes.filter((c) => typeof c === "string" && c.trim() !== "").slice(0, MAX_COUPON_CODES);
  if (list.length <= 1) return { code: list[0] ?? codes[0] ?? "", ...rest };
  return { code: list[0], codes: list, ...rest };
}
var UNREACHABLE = { kind: "unreachable" };
function obj(v) {
  return v && typeof v === "object" && !Array.isArray(v) ? v : null;
}
function num(v) {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function coupons(list, flag) {
  if (!Array.isArray(list)) return null;
  const out = [];
  for (const raw of list) {
    const c = obj(raw);
    const discount = c ? num(c.discount) : null;
    if (!c || typeof c.code !== "string" || !c.code || discount === null) return null;
    out.push({ code: c.code, discount, allowCombining: flag(c) });
  }
  return out;
}
function parseCouponValidation(status, json, sentCodes) {
  if (!Number.isFinite(status) || status <= 0 || status >= 429) return UNREACHABLE;
  const b = obj(json);
  if (!b) return UNREACHABLE;
  if (status >= 200 && status < 300 && b.valid === true) {
    const total = num(obj(b.discount)?.amount);
    if (total === null) return UNREACHABLE;
    if (b.coupons !== void 0) {
      const list = coupons(b.coupons, (c) => c.allowCombining === true);
      if (!list || list.length === 0) return UNREACHABLE;
      return { kind: "ok", applied: { coupons: list, total, freeShipping: b.allowFreeShipping === true } };
    }
    const coupon = obj(b.coupon);
    if (!coupon || typeof coupon.code !== "string" || !coupon.code) return UNREACHABLE;
    return {
      kind: "ok",
      applied: {
        coupons: [{ code: coupon.code, discount: total, allowCombining: coupon.allowCombining === true }],
        total,
        freeShipping: coupon.allowFreeShipping === true
      }
    };
  }
  if (status >= 400 && status < 429 && b.valid !== true) {
    const sent = new Set(sentCodes.map((c) => c.trim().toUpperCase()));
    const out = { kind: "refused", keep: coupons(b.coupons, () => false) ?? [] };
    if (typeof b.code === "string") out.errorCode = b.code;
    if (typeof b.couponCode === "string" && sent.has(b.couponCode.trim().toUpperCase())) out.refusedCode = b.couponCode;
    if (Array.isArray(b.conflictsWith)) out.conflictsWith = b.conflictsWith.filter((c) => typeof c === "string");
    if (typeof b.error === "string") out.message = b.error;
    return out;
  }
  return UNREACHABLE;
}

// src/checkout/use-link-coupon.ts
function useLinkCoupon(o) {
  const tried = (0, import_react2.useRef)("");
  const latest = (0, import_react2.useRef)(o);
  latest.current = o;
  const sig = o.ready ? `${o.lines.map((l) => `${l.slug}:${l.quantity ?? 1}:${l.price}`).join("|")}#${o.subtotal}` : "";
  (0, import_react2.useEffect)(() => {
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
            ...buildCouponValidateBody([pending.code], {
              items: o.lines.map((l) => ({ productSlug: l.slug, quantity: l.quantity ?? 1, price: l.price })),
              subtotal: o.subtotal
            })
          })
        });
        const data = await res.json();
        if (cancelled) return;
        delivered = true;
        const now = latest.current;
        if (now.appliedCode || now.hasTypedText || !now.collecting) return;
        const parsed = parseCouponValidation(typeof res.status === "number" ? res.status : 200, data, [pending.code]);
        if (parsed.kind === "ok") {
          now.onApply({ code: parsed.applied.coupons[0].code, discountAmount: parsed.applied.total });
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
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  CHECKOUT_ERROR_KEYS,
  CheckoutError,
  MAX_COUPON_CODES,
  POLL_INTERVAL_MS,
  POLL_MAX_REQUESTS,
  TERMINAL_FINANCIAL_STATUSES,
  buildCartDoorBody,
  buildCouponValidateBody,
  buildFunnelDoorBody,
  checkoutErrorKey,
  getOrderForThankYou,
  isCheckoutError,
  maxInstallmentsFor,
  parseCouponValidation,
  startCheckout,
  useLinkCoupon,
  useThankYouOrder
});
