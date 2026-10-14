import type { StartCartCheckoutInput, StartFunnelCheckoutInput } from './types';

/** Drops undefined values so optional fields are absent from the body, not `null`. */
function compact<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v;
  return out as T;
}

/** POST body for the cart door (`/api/public/checkout`, contract 2). */
export function buildCartDoorBody(input: StartCartCheckoutInput) {
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
    selectedInstallments: typeof n === 'number' && Number.isInteger(n) && n > 1 ? n : undefined,
    successUrl: input.successUrl,
    cancelUrl: input.cancelUrl,
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
    shipping_address: input.shippingAddress,
    utms: input.utms,
    session_id: input.sessionId,
    visitor_id: input.visitorId,
    successUrl: input.successUrl,
    cancelUrl: input.cancelUrl,
  });
}
