// Meta pixel conversion events (spec customer-websites-278d, rev 2, council #150).
// Plain browser code: no React, no 'use client' banner. `window` is touched only when a function is called.
// Fail closed: nothing is sent until a site calls configureTracking({ hasConsent }).

export interface TrackingConfig {
  /** The site's own cookie-consent check (e.g. its hasAnalyticsConsent). */
  hasConsent: () => boolean;
  /**
   * True when the visitor has explicitly declined cookies (not merely "not answered yet").
   * An event created while this is true is dropped at once and never queued.
   */
  hasDeclined?: () => boolean;
}

/** What kind of form produced a Lead; sent as Meta's predefined `content_category`. */
export type LeadFormKind = 'contact' | 'newsletter' | 'waitlist' | 'popup' | 'lesson' | 'product';

/** Minimal structural order: both OrderThin and a site's own order type satisfy it. */
export interface TrackableOrder {
  orderId: string;
  financialStatus: string;
  total: number;
  currency?: string | null;
  paidAt?: string | null;
  items?: Array<{ productId?: string | null; quantity?: number; price?: number }> | null;
}

type Fbq = (...args: unknown[]) => void;
type FbqWindow = Window & { fbq?: Fbq };

const WAIT_MAX_MS = 60 * 60 * 1000; // an event waits for consent at most one hour from its creation
const FAST_POLL_MS = 250;
const FAST_POLL_WINDOW_MS = 10_000;
const SLOW_POLL_MS = 2_000;
const PENDING_KEY = 'tus:tracking:pending';
const PENDING_CAP = 20;
const LEAD_FORM_KINDS: readonly string[] = ['contact', 'newsletter', 'waitlist', 'popup', 'lesson', 'product'];
const EVENT_NAMES: readonly string[] = ['Purchase', 'Lead', 'CompleteRegistration'];
const MAX_PAID_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_FUTURE_SKEW_MS = 10 * 60 * 1000;
const STORE_KEY = 'tus:tracking:fired';
const STORE_CAP = 200;
const CURRENCY_RE = /^[A-Za-z]{3}$/;

type EventName = 'Purchase' | 'Lead' | 'CompleteRegistration';

interface PendingEntry {
  key: string;
  eventName: EventName;
  params: Record<string, unknown>;
  eventId: string | null;
  createdAt: number;
  dropped: boolean;
}

let config: TrackingConfig | null = null;
const inFlight = new Map<string, PendingEntry>();
/** Events waiting for consent in this page (oldest first), capped at PENDING_CAP. */
const pending: PendingEntry[] = [];

export function configureTracking(next: TrackingConfig): void {
  config = next;
  flushStoredPending();
}

function consent(): boolean {
  if (!config) return false;
  try {
    return config.hasConsent() === true;
  } catch {
    return false;
  }
}

function declined(): boolean {
  if (!config || typeof config.hasDeclined !== 'function') return false;
  try {
    return config.hasDeclined() === true;
  } catch {
    return false;
  }
}

function blockedByGuard(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    if (window.self !== window.top) return true;
  } catch {
    return true; // cross-origin top: we are in a frame
  }
  const path = window.location?.pathname ?? '';
  return path.startsWith('/preview');
}

function readFired(): string[] {
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === 'string') : [];
  } catch {
    return [];
  }
}

function alreadyFired(key: string): boolean {
  return readFired().includes(key);
}

function markFired(key: string): void {
  try {
    const keys = readFired().filter((k) => k !== key);
    keys.push(key);
    window.localStorage.setItem(STORE_KEY, JSON.stringify(keys.slice(-STORE_CAP)));
  } catch {
    // storage unavailable: the event was already sent, never crash
  }
}

function fbqReady(): boolean {
  return typeof (window as FbqWindow).fbq === 'function';
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function readStoredPending(): unknown[] {
  try {
    const raw = window.sessionStorage.getItem(PENDING_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeStoredPending(items: unknown[]): void {
  try {
    if (items.length === 0) window.sessionStorage.removeItem(PENDING_KEY);
    else window.sessionStorage.setItem(PENDING_KEY, JSON.stringify(items));
  } catch {
    // storage unavailable: never crash
  }
}

function removeStoredPending(key: string): void {
  if (typeof window === 'undefined') return;
  const items = readStoredPending();
  const kept = items.filter((i) => !(i && typeof i === 'object' && (i as { key?: unknown }).key === key));
  if (kept.length !== items.length) writeStoredPending(kept);
}

function leavePending(entry: PendingEntry): void {
  const i = pending.indexOf(entry);
  if (i >= 0) pending.splice(i, 1);
  if (inFlight.get(entry.key) === entry) inFlight.delete(entry.key);
}

async function send(
  key: string,
  eventName: EventName,
  params: Record<string, unknown>,
  eventId: string | null,
  createdAt: number = Date.now(),
): Promise<boolean> {
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
  const entry: PendingEntry = { key, eventName, params, eventId, createdAt, dropped: false };
  inFlight.set(key, entry);
  pending.push(entry);
  while (pending.length > PENDING_CAP) {
    const oldest = pending.shift() as PendingEntry;
    oldest.dropped = true;
    if (inFlight.get(oldest.key) === oldest) inFlight.delete(oldest.key);
  }
  try {
    while (!(consent() && fbqReady())) {
      if (entry.dropped) return false;
      const age = Date.now() - entry.createdAt;
      if (age >= WAIT_MAX_MS) return false;
      await sleep(age < FAST_POLL_WINDOW_MS ? FAST_POLL_MS : SLOW_POLL_MS);
    }
    if (entry.dropped) return false;
    // Send time: consent again, and another tab may have fired this key during the wait.
    if (!consent() || !fbqReady() || alreadyFired(key)) return false;
    const fbq = (window as FbqWindow).fbq as Fbq;
    try {
      if (eventId) fbq('track', eventName, params, { eventID: eventId });
      else fbq('track', eventName, params);
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

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Re-send the entries a previous page of this tab carried across the accept reload. */
function flushStoredPending(): void {
  if (typeof window === 'undefined') return;
  const raw = readStoredPending();
  if (raw.length === 0) return;
  const now = Date.now();
  const valid: Array<{ entry: PendingEntry; stored: unknown }> = [];
  for (const item of raw) {
    if (!isPlainObject(item)) continue;
    const { key, event, params, eventId, createdAt } = item;
    if (typeof key !== 'string' || !key) continue;
    if (typeof event !== 'string' || !EVENT_NAMES.includes(event)) continue;
    if (!isPlainObject(params)) continue;
    if (eventId !== null && typeof eventId !== 'string') continue;
    if (typeof createdAt !== 'number' || !Number.isFinite(createdAt)) continue;
    if (now - createdAt >= WAIT_MAX_MS) continue;
    valid.push({
      stored: item,
      entry: {
        key,
        eventName: event as EventName,
        params,
        eventId: eventId as string | null,
        createdAt: Math.min(createdAt, now),
        dropped: false,
      },
    });
  }
  if (valid.length !== raw.length) writeStoredPending(valid.map((v) => v.stored));
  for (const { entry } of valid) {
    if (inFlight.has(entry.key)) continue; // already waiting in this page: its own send removes the stored copy
    void send(entry.key, entry.eventName, entry.params, entry.eventId, entry.createdAt);
  }
}

/**
 * Call in a consent accept handler that reloads the page, after the consent value is saved and just
 * before the reload. Stores the events still waiting for consent in sessionStorage (tab-scoped) so
 * the next page sends them. Writes nothing when consent is not given. Never throws.
 */
export function persistPendingTracking(): void {
  try {
    if (typeof window === 'undefined' || !consent()) return;
    const items = pending
      .filter((e) => !e.dropped)
      .map((e) => ({ key: e.key, event: e.eventName, params: e.params, eventId: e.eventId, createdAt: e.createdAt }));
    if (items.length === 0) return;
    window.sessionStorage.setItem(PENDING_KEY, JSON.stringify(items));
  } catch {
    // never throw
  }
}

function paidAtOk(paidAt: string | null | undefined): boolean {
  if (typeof paidAt !== 'string' || !paidAt) return false;
  const t = Date.parse(paidAt);
  if (!Number.isFinite(t)) return false;
  const delta = Date.now() - t; // negative = in the future
  if (delta < -MAX_FUTURE_SKEW_MS) return false;
  return Math.max(0, delta) <= MAX_PAID_AGE_MS;
}

export async function trackPurchase(order: TrackableOrder): Promise<boolean> {
  if (!order || typeof order.orderId !== 'string' || !order.orderId) return false;
  if (order.financialStatus !== 'paid') return false;
  if (typeof order.total !== 'number' || !Number.isFinite(order.total) || order.total <= 0) return false;
  if (typeof order.currency !== 'string' || !CURRENCY_RE.test(order.currency)) return false;
  if (!paidAtOk(order.paidAt)) return false;

  const params: Record<string, unknown> = { value: order.total, currency: order.currency.toUpperCase() };
  const contents: Array<{ id: string; quantity: number }> = [];
  for (const item of Array.isArray(order.items) ? order.items : []) {
    if (!item || typeof item.productId !== 'string' || !item.productId) continue;
    const q = item.quantity;
    contents.push({ id: item.productId, quantity: typeof q === 'number' && Number.isFinite(q) && q > 0 ? q : 1 });
  }
  if (contents.length > 0) {
    params.content_ids = contents.map((c) => c.id);
    params.content_type = 'product';
    params.contents = contents;
  }
  const id = 'purchase_' + order.orderId;
  return send(id, 'Purchase', params, id);
}

export async function trackLead(
  submissionId: string | null | undefined,
  formKind?: LeadFormKind,
): Promise<boolean> {
  if (typeof submissionId !== 'string' || !submissionId) return false;
  const id = 'lead_' + submissionId;
  const params: Record<string, unknown> =
    typeof formKind === 'string' && LEAD_FORM_KINDS.includes(formKind) ? { content_category: formKind } : {};
  return send(id, 'Lead', params, id);
}

export async function trackCompleteRegistration(key: string, memberId?: string | null): Promise<boolean> {
  if (typeof key !== 'string' || !key) return false;
  const eventId = typeof memberId === 'string' && memberId ? 'reg_' + memberId : null;
  return send(key, 'CompleteRegistration', {}, eventId);
}
