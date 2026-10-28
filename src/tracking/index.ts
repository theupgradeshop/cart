// Meta pixel conversion events (spec customer-websites-278d, rev 2, council #150).
// Plain browser code: no React, no 'use client' banner. `window` is touched only when a function is called.
// Fail closed: nothing is sent until a site calls configureTracking({ hasConsent }).

export interface TrackingConfig {
  /** The site's own cookie-consent check (e.g. its hasAnalyticsConsent). */
  hasConsent: () => boolean;
}

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

const WAIT_MS = 10_000;
const POLL_MS = 250;
const MAX_PAID_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_FUTURE_SKEW_MS = 10 * 60 * 1000;
const STORE_KEY = 'tus:tracking:fired';
const STORE_CAP = 200;
const CURRENCY_RE = /^[A-Za-z]{3}$/;

let config: TrackingConfig | null = null;
const inFlight = new Set<string>();

export function configureTracking(next: TrackingConfig): void {
  config = next;
}

function consent(): boolean {
  if (!config) return false;
  try {
    return config.hasConsent() === true;
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

async function send(
  key: string,
  eventName: 'Purchase' | 'Lead' | 'CompleteRegistration',
  params: Record<string, unknown>,
  eventId: string | null,
): Promise<boolean> {
  if (blockedByGuard()) return false;
  if (inFlight.has(key) || alreadyFired(key)) return false;
  inFlight.add(key);
  try {
    const startedAt = Date.now();
    while (!(consent() && fbqReady())) {
      if (Date.now() - startedAt >= WAIT_MS) return false;
      await sleep(POLL_MS);
    }
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
    inFlight.delete(key);
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
    params.contents = contents;
  }
  const id = 'purchase_' + order.orderId;
  return send(id, 'Purchase', params, id);
}

export async function trackLead(submissionId: string | null | undefined): Promise<boolean> {
  if (typeof submissionId !== 'string' || !submissionId) return false;
  const id = 'lead_' + submissionId;
  return send(id, 'Lead', {}, id);
}

export async function trackCompleteRegistration(key: string, memberId?: string | null): Promise<boolean> {
  if (typeof key !== 'string' || !key) return false;
  const eventId = typeof memberId === 'string' && memberId ? 'reg_' + memberId : null;
  return send(key, 'CompleteRegistration', {}, eventId);
}
