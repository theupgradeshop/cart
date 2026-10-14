import type { CheckoutCapabilities, InstallmentRule } from './types';

/** Keeps only well-formed rules: finite non-negative minAmount and an integer maxPayments >= 1. */
function parseRules(x: unknown): InstallmentRule[] {
  if (!Array.isArray(x)) return [];
  const out: InstallmentRule[] = [];
  for (const r of x) {
    if (!r || typeof r !== 'object') continue;
    const { minAmount, maxPayments } = r as Record<string, unknown>;
    if (
      typeof minAmount === 'number' && Number.isFinite(minAmount) && minAmount >= 0 &&
      typeof maxPayments === 'number' && Number.isInteger(maxPayments) && maxPayments >= 1
    ) {
      out.push({ minAmount, maxPayments });
    }
  }
  return out;
}

/**
 * `GET /api/public/checkout-settings` -> `payments{available, installmentsMax, installmentRules}`.
 * Any failure (or an older dashboard without `payments`) reads as not available, so a visitor
 * never sees a buy button that cannot work. A request that hangs past `timeoutMs` (default 5000) reads the same way. Safe to call from a Server Component.
 */
export async function getCheckoutCapabilities(
  domain: string,
  apiBaseUrl: string,
  timeoutMs = 5000,
): Promise<CheckoutCapabilities> {
  const none: CheckoutCapabilities = { available: false, installmentsMax: 1, installmentRules: [] };
  try {
    const res = await fetch(
      `${apiBaseUrl.replace(/\/+$/, '')}/api/public/checkout-settings?domain=${encodeURIComponent(domain)}`,
      { signal: AbortSignal.timeout(timeoutMs) },
    );
    if (!res.ok) return none;
    const json = (await res.json()) as {
      payments?: { available?: unknown; installmentsMax?: unknown; installmentRules?: unknown };
    };
    const p = json?.payments;
    if (!p || p.available !== true) return none;
    const max = typeof p.installmentsMax === 'number' && Number.isFinite(p.installmentsMax) ? Math.floor(p.installmentsMax) : 1;
    return { available: true, installmentsMax: Math.max(1, max), installmentRules: parseRules(p.installmentRules) };
  } catch {
    return none;
  }
}

/**
 * The most payments a visitor may choose, mirroring the dashboard's own resolution at the gateway level.
 * `total` is the post-coupon, post-shipping order total in major units; it is rounded (Math.round) as the
 * checkout door does. No rules: `installmentsMax`. With rules: the rule with the HIGHEST `minAmount` that the
 * total reaches decides (ties keep the original array order, first wins), with NO cap by `installmentsMax`;
 * no rule reached, or a total that is not finite, gives 1. Per-product limits are not known to the site, so it never offers more than this
 * gateway-level number. Pure and server-safe.
 */
export function maxInstallmentsFor(
  total: number,
  capabilities: Pick<CheckoutCapabilities, 'installmentsMax'> & { installmentRules?: InstallmentRule[] },
): number {
  const base = Number.isFinite(capabilities.installmentsMax) ? Math.max(1, Math.floor(capabilities.installmentsMax)) : 1;
  const rules = capabilities.installmentRules ?? [];
  if (rules.length === 0) return base;
  if (!Number.isFinite(total)) return 1;
  const t = Math.round(Math.max(0, total));
  const match = [...rules].sort((a, b) => b.minAmount - a.minAmount).find((r) => t >= r.minAmount);
  return match ? match.maxPayments : 1;
}
