// src/tracking/index.ts
var WAIT_MAX_MS = 60 * 60 * 1e3;
var FAST_POLL_MS = 250;
var FAST_POLL_WINDOW_MS = 1e4;
var SLOW_POLL_MS = 2e3;
var PENDING_KEY = "tus:tracking:pending";
var PENDING_CAP = 20;
var LEAD_FORM_KINDS = ["contact", "newsletter", "waitlist", "popup", "lesson", "product"];
var EVENT_NAMES = ["Purchase", "Lead", "CompleteRegistration"];
var MAX_PAID_AGE_MS = 24 * 60 * 60 * 1e3;
var MAX_FUTURE_SKEW_MS = 10 * 60 * 1e3;
var STORE_KEY = "tus:tracking:fired";
var STORE_CAP = 200;
var CURRENCY_RE = /^[A-Za-z]{3}$/;
var config = null;
var inFlight = /* @__PURE__ */ new Map();
var pending = [];
function configureTracking(next) {
  config = next;
  flushStoredPending();
}
function consent() {
  if (!config) return false;
  try {
    return config.hasConsent() === true;
  } catch {
    return false;
  }
}
function declined() {
  if (!config || typeof config.hasDeclined !== "function") return false;
  try {
    return config.hasDeclined() === true;
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
function readStoredPending() {
  try {
    const raw = window.sessionStorage.getItem(PENDING_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
function writeStoredPending(items) {
  try {
    if (items.length === 0) window.sessionStorage.removeItem(PENDING_KEY);
    else window.sessionStorage.setItem(PENDING_KEY, JSON.stringify(items));
  } catch {
  }
}
function removeStoredPending(key) {
  if (typeof window === "undefined") return;
  const items = readStoredPending();
  const kept = items.filter((i) => !(i && typeof i === "object" && i.key === key));
  if (kept.length !== items.length) writeStoredPending(kept);
}
function leavePending(entry) {
  const i = pending.indexOf(entry);
  if (i >= 0) pending.splice(i, 1);
  if (inFlight.get(entry.key) === entry) inFlight.delete(entry.key);
}
async function send(key, eventName, params, eventId, createdAt = Date.now()) {
  if (blockedByGuard()) {
    removeStoredPending(key);
    return false;
  }
  if (inFlight.has(key)) return false;
  if (alreadyFired(key)) {
    removeStoredPending(key);
    return false;
  }
  if (declined()) {
    removeStoredPending(key);
    return false;
  }
  const entry = { key, eventName, params, eventId, createdAt, dropped: false };
  inFlight.set(key, entry);
  pending.push(entry);
  while (pending.length > PENDING_CAP) {
    const oldest = pending.shift();
    oldest.dropped = true;
    if (inFlight.get(oldest.key) === oldest) inFlight.delete(oldest.key);
    removeStoredPending(oldest.key);
  }
  try {
    for (; ; ) {
      if (entry.dropped) return false;
      if (declined()) {
        removeStoredPending(key);
        return false;
      }
      const age = Date.now() - entry.createdAt;
      if (age >= WAIT_MAX_MS) return false;
      if (consent() && fbqReady()) break;
      await sleep(age < FAST_POLL_WINDOW_MS ? FAST_POLL_MS : SLOW_POLL_MS);
    }
    if (declined()) {
      removeStoredPending(key);
      return false;
    }
    if (Date.now() - entry.createdAt >= WAIT_MAX_MS) return false;
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
    const wasDropped = entry.dropped;
    leavePending(entry);
    if (!wasDropped) removeStoredPending(key);
  }
}
function isPlainObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function flushStoredPending() {
  if (typeof window === "undefined") return;
  const raw = readStoredPending();
  if (raw.length === 0) return;
  const now = Date.now();
  const valid = [];
  for (const item of raw) {
    if (!isPlainObject(item)) continue;
    const { key, event, params, eventId, createdAt } = item;
    if (typeof key !== "string" || !key) continue;
    if (typeof event !== "string" || !EVENT_NAMES.includes(event)) continue;
    if (!isPlainObject(params)) continue;
    if (eventId !== null && typeof eventId !== "string") continue;
    if (typeof createdAt !== "number" || !Number.isFinite(createdAt)) continue;
    if (now - createdAt >= WAIT_MAX_MS) continue;
    if (createdAt - now > MAX_FUTURE_SKEW_MS) continue;
    valid.push({
      stored: item,
      entry: {
        key,
        eventName: event,
        params,
        eventId,
        createdAt: Math.min(createdAt, now),
        dropped: false
      }
    });
  }
  if (valid.length !== raw.length) writeStoredPending(valid.map((v) => v.stored));
  for (const { entry } of valid) {
    if (inFlight.has(entry.key)) continue;
    void send(entry.key, entry.eventName, entry.params, entry.eventId, entry.createdAt);
  }
}
function persistPendingTracking() {
  try {
    if (typeof window === "undefined" || !consent()) return;
    const items = pending.filter((e) => !e.dropped).map((e) => ({ key: e.key, event: e.eventName, params: e.params, eventId: e.eventId, createdAt: e.createdAt }));
    if (items.length === 0) window.sessionStorage.removeItem(PENDING_KEY);
    else window.sessionStorage.setItem(PENDING_KEY, JSON.stringify(items));
  } catch {
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
    params.content_type = "product";
    params.contents = contents;
  }
  const id = "purchase_" + order.orderId;
  return send(id, "Purchase", params, id);
}
async function trackLead(submissionId, formKind) {
  if (typeof submissionId !== "string" || !submissionId) return false;
  const id = "lead_" + submissionId;
  const params = typeof formKind === "string" && LEAD_FORM_KINDS.includes(formKind) ? { content_category: formKind } : {};
  return send(id, "Lead", params, id);
}
async function trackCompleteRegistration(key, memberId) {
  if (typeof key !== "string" || !key) return false;
  const eventId = typeof memberId === "string" && memberId ? "reg_" + memberId : null;
  return send(key, "CompleteRegistration", {}, eventId);
}
export {
  configureTracking,
  persistPendingTracking,
  trackCompleteRegistration,
  trackLead,
  trackPurchase
};
