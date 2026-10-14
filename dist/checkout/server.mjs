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
export {
  CHECKOUT_ERROR_KEYS,
  CheckoutError,
  buildCartDoorBody,
  buildFunnelDoorBody,
  checkoutErrorKey,
  getCheckoutCapabilities,
  isCheckoutError
};
