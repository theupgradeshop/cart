// src/tracking/index.ts
var WAIT_MS = 1e4;
var POLL_MS = 250;
var MAX_PAID_AGE_MS = 24 * 60 * 60 * 1e3;
var MAX_FUTURE_SKEW_MS = 10 * 60 * 1e3;
var STORE_KEY = "tus:tracking:fired";
var STORE_CAP = 200;
var CURRENCY_RE = /^[A-Za-z]{3}$/;
var config = null;
var inFlight = /* @__PURE__ */ new Set();
function configureTracking(next) {
  config = next;
}
function consent() {
  if (!config) return false;
  try {
    return config.hasConsent() === true;
  } catch {
    return false;
  }
}
function blockedByGuard() {
  if (typeof window === "undefined") return true;
  try {
    if (window.self !== window.top) return true;
  } catch {
    return true;
  }
  const path = window.location?.pathname ?? "";
  return path.startsWith("/preview");
}
function readFired() {
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((k) => typeof k === "string") : [];
  } catch {
    return [];
  }
}
function alreadyFired(key) {
  return readFired().includes(key);
}
function markFired(key) {
  try {
    const keys = readFired().filter((k) => k !== key);
    keys.push(key);
    window.localStorage.setItem(STORE_KEY, JSON.stringify(keys.slice(-STORE_CAP)));
  } catch {
  }
}
function fbqReady() {
  return typeof window.fbq === "function";
}
var sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function send(key, eventName, params, eventId) {
  if (blockedByGuard()) return false;
  if (inFlight.has(key) || alreadyFired(key)) return false;
  inFlight.add(key);
  try {
    const startedAt = Date.now();
    while (!(consent() && fbqReady())) {
      if (Date.now() - startedAt >= WAIT_MS) return false;
      await sleep(POLL_MS);
    }
    if (!consent() || !fbqReady() || alreadyFired(key)) return false;
    const fbq = window.fbq;
    try {
      if (eventId) fbq("track", eventName, params, { eventID: eventId });
      else fbq("track", eventName, params);
    } catch {
      return false;
    }
    markFired(key);
    return true;
  } finally {
    inFlight.delete(key);
  }
}
function paidAtOk(paidAt) {
  if (typeof paidAt !== "string" || !paidAt) return false;
  const t = Date.parse(paidAt);
  if (!Number.isFinite(t)) return false;
  const delta = Date.now() - t;
  if (delta < -MAX_FUTURE_SKEW_MS) return false;
  return Math.max(0, delta) <= MAX_PAID_AGE_MS;
}
async function trackPurchase(order) {
  if (!order || typeof order.orderId !== "string" || !order.orderId) return false;
  if (order.financialStatus !== "paid") return false;
  if (typeof order.total !== "number" || !Number.isFinite(order.total) || order.total <= 0) return false;
  if (typeof order.currency !== "string" || !CURRENCY_RE.test(order.currency)) return false;
  if (!paidAtOk(order.paidAt)) return false;
  const params = { value: order.total, currency: order.currency.toUpperCase() };
  const contents = [];
  for (const item of Array.isArray(order.items) ? order.items : []) {
    if (!item || typeof item.productId !== "string" || !item.productId) continue;
    const q = item.quantity;
    contents.push({ id: item.productId, quantity: typeof q === "number" && Number.isFinite(q) && q > 0 ? q : 1 });
  }
  if (contents.length > 0) {
    params.content_ids = contents.map((c) => c.id);
    params.contents = contents;
  }
  const id = "purchase_" + order.orderId;
  return send(id, "Purchase", params, id);
}
async function trackLead(submissionId) {
  if (typeof submissionId !== "string" || !submissionId) return false;
  const id = "lead_" + submissionId;
  return send(id, "Lead", {}, id);
}
async function trackCompleteRegistration(key, memberId) {
  if (typeof key !== "string" || !key) return false;
  const eventId = typeof memberId === "string" && memberId ? "reg_" + memberId : null;
  return send(key, "CompleteRegistration", {}, eventId);
}
export {
  configureTracking,
  trackCompleteRegistration,
  trackLead,
  trackPurchase
};
