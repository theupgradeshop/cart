// src/checkout/capabilities.ts
function parseRules(x) {
  if (!Array.isArray(x)) return [];
  const out = [];
  for (const r of x) {
    if (!r || typeof r !== "object") continue;
    const { minAmount, maxPayments } = r;
    if (typeof minAmount === "number" && Number.isFinite(minAmount) && minAmount >= 0 && typeof maxPayments === "number" && Number.isInteger(maxPayments) && maxPayments >= 1) {
      out.push({ minAmount, maxPayments });
    }
  }
  return out;
}
async function getCheckoutCapabilities(domain, apiBaseUrl, timeoutMs = 5e3) {
  const none = { available: false, installmentsMax: 1, installmentRules: [] };
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
    return { available: true, installmentsMax: Math.max(1, max), installmentRules: parseRules(p.installmentRules) };
  } catch {
    return none;
  }
}
function maxInstallmentsFor(total, capabilities) {
  const base = Number.isFinite(capabilities.installmentsMax) ? Math.max(1, Math.floor(capabilities.installmentsMax)) : 1;
  const rules = capabilities.installmentRules ?? [];
  if (rules.length === 0) return base;
  if (!Number.isFinite(total)) return 1;
  const t = Math.round(Math.max(0, total));
  const match = [...rules].sort((a, b) => b.minAmount - a.minAmount).find((r) => t >= r.minAmount);
  return match ? match.maxPayments : 1;
}

// src/checkout/bodies.ts
function compact(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) if (v !== void 0) out[k] = v;
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
export {
  CHECKOUT_ERROR_KEYS,
  CheckoutError,
  buildCartDoorBody,
  buildFunnelDoorBody,
  checkoutErrorKey,
  getCheckoutCapabilities,
  isCheckoutError,
  maxInstallmentsFor
};
