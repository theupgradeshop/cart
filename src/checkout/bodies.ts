import type { Attribution, StartCartCheckoutInput, Touch, StartFunnelCheckoutInput } from './types';

/** Drops undefined values so optional fields are absent from the body, not `null`. */
function compact<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v;
  return out as T;
}

/** `couponCodes` only for 2 or more codes: one code keeps today's body bytes. */
function manyCodes(codes: string[] | undefined): string[] | undefined {
  return Array.isArray(codes) && codes.length >= 2 ? codes : undefined;
}

const TOUCH_KEYS = [
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
  'gclid', 'fbclid', 'landing_path', 'referrer_host', 'at',
] as const;
const TOUCH_VALUE_MAX = 200;

function isPlain(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/** A fresh Touch holding only the 10 known keys whose values are strings (each capped at 200 chars); anything else is null. */
function copyTouch(t: unknown): Touch | null {
  if (!isPlain(t)) return null;
  const out: Touch = {};
  for (const k of TOUCH_KEYS) {
    const v = t[k];
    if (typeof v === 'string') out[k] = v.slice(0, TOUCH_VALUE_MAX);
  }
  return out;
}

/**
 * `attribution` for the body: a fresh `{first, last}` built by key whitelist, never the caller's object, so a cyclic
 * object, a BigInt, a throwing getter or an extra/nested key can never reach JSON.stringify (a throw there would lose a
 * paid order). Not a plain object, or any error while reading it: undefined (the key is left out). The dashboard
 * sanitizes again on receipt.
 */
function safeAttribution(a: unknown): Attribution | undefined {
  try {
    if (!isPlain(a)) return undefined;
    return { first: copyTouch(a.first), last: copyTouch(a.last) };
  } catch {
    return undefined;
  }
}

/** POST body for the cart door (`/api/public/checkout`, contract 2). */
export function buildCartDoorBody(input: StartCartCheckoutInput) {
  const n = input.selectedInstallments;
  return compact({
    contract: 2,
    domain: input.domain,
    customer: compact({ ...input.customer }),
    items: input.items.map((i) => compact({ ...i })),
    storeBundles: Array.isArray(input.storeBundles) && input.storeBundles.length > 0 ? input.storeBundles : undefined,
    couponCode: input.couponCode,
    couponCodes: manyCodes(input.couponCodes),
    language: input.language,
    marketingConsent: input.marketingConsent,
    shipping_address: input.shippingAddress,
    selectedInstallments: typeof n === 'number' && Number.isInteger(n) && n > 1 ? n : undefined,
    successUrl: input.successUrl,
    cancelUrl: input.cancelUrl,
    attribution: safeAttribution(input.attribution),
  });
}

/** POST body for the funnels door (`/api/public/funnels/checkout`, contract 2). */
export function buildFunnelDoorBody(input: StartFunnelCheckoutInput) {
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
    cancelUrl: input.cancelUrl,
  });
}
