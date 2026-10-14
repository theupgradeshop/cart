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

// src/checkout/server.ts
var server_exports = {};
__export(server_exports, {
  CHECKOUT_ERROR_KEYS: () => CHECKOUT_ERROR_KEYS,
  CheckoutError: () => CheckoutError,
  buildCartDoorBody: () => buildCartDoorBody,
  buildFunnelDoorBody: () => buildFunnelDoorBody,
  checkoutErrorKey: () => checkoutErrorKey,
  getCheckoutCapabilities: () => getCheckoutCapabilities,
  isCheckoutError: () => isCheckoutError
});
module.exports = __toCommonJS(server_exports);

// src/checkout/capabilities.ts
async function getCheckoutCapabilities(domain, apiBaseUrl, timeoutMs = 5e3) {
  const none = { available: false, installmentsMax: 1 };
  try {
    const res = await fetch(
      `${apiBaseUrl.replace(/\/+$/, "")}/api/public/checkout-settings?domain=${encodeURIComponent(domain)}`,
      { signal: AbortSignal.timeout(timeoutMs) }
    );
    if (!res.ok) return none;
    const json = await res.json();
    const p = json?.payments;
    if (!p || p.available !== true) return none;
    const max = typeof p.installmentsMax === "number" && Number.isFinite(p.installmentsMax) ? Math.floor(p.installmentsMax) : 1;
    return { available: true, installmentsMax: Math.max(1, max) };
  } catch {
    return none;
  }
}

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
  "installments_unavailable"
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
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  CHECKOUT_ERROR_KEYS,
  CheckoutError,
  buildCartDoorBody,
  buildFunnelDoorBody,
  checkoutErrorKey,
  getCheckoutCapabilities,
  isCheckoutError
});
