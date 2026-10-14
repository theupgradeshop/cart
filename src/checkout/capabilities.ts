import type { CheckoutCapabilities } from './types';

/**
 * `GET /api/public/checkout-settings` -> `payments{available, installmentsMax}`.
 * Any failure (or an older dashboard without `payments`) reads as not available, so a visitor
 * never sees a buy button that cannot work. A request that hangs past `timeoutMs` (default 5000) reads the same way. Safe to call from a Server Component.
 */
export async function getCheckoutCapabilities(
  domain: string,
  apiBaseUrl: string,
  timeoutMs = 5000,
): Promise<CheckoutCapabilities> {
  const none: CheckoutCapabilities = { available: false, installmentsMax: 1 };
  try {
    const res = await fetch(
      `${apiBaseUrl.replace(/\/+$/, '')}/api/public/checkout-settings?domain=${encodeURIComponent(domain)}`,
      { signal: AbortSignal.timeout(timeoutMs) },
    );
    if (!res.ok) return none;
    const json = (await res.json()) as { payments?: { available?: unknown; installmentsMax?: unknown } };
    const p = json?.payments;
    if (!p || p.available !== true) return none;
    const max = typeof p.installmentsMax === 'number' && Number.isFinite(p.installmentsMax) ? Math.floor(p.installmentsMax) : 1;
    return { available: true, installmentsMax: Math.max(1, max) };
  } catch {
    return none;
  }
}
