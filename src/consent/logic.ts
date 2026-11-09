// Pure consent logic (no React, no window access at import time): regions, storage, effective choices, cookies.
// Spec websites-cookie-consent DRAFT 2, decisions D1-D7.

export type ConsentCategory = 'analytics' | 'marketing';
export type ConsentMode = 'ask' | 'notice';
export type RegionGroup = 'europe' | 'israel' | 'rest';
export type ConsentChoices = Record<ConsentCategory, boolean>;

export const CATEGORIES: readonly ConsentCategory[] = ['analytics', 'marketing'];

export interface ConsentConfig {
  /** The owner's mode per region group (server snapshot, dashboard website-config). */
  regions: Record<RegionGroup, ConsentMode>;
  privacyPath?: string | null;
  /** Categories that have at least one tool in use (GA, Meta Pixel, a site script). Empty = no banner at all. */
  categoriesInUse: ConsentCategory[];
  googleAnalyticsId?: string | null;
  metaPixelId?: string | null;
}

export interface StoredConsent {
  mode: ConsentMode;
  /** Categories the visitor was shown (and so answered, explicitly or by the notice OK). */
  asked: ConsentCategory[];
  choices: ConsentChoices;
  at: number;
}

const EU27 = [
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT',
  'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
];
/** EU 27 + EEA (IS, LI, NO) + United Kingdom + Switzerland. */
const EUROPE = new Set([...EU27, 'IS', 'LI', 'NO', 'GB', 'CH']);

/** Country code -> region group. Null / unknown / malformed -> null (the caller asks first). */
export function regionGroupOf(country: string | null | undefined): RegionGroup | null {
  if (typeof country !== 'string') return null;
  const cc = country.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(cc) || cc === 'XX' || cc === 'T1') return null;
  if (EUROPE.has(cc)) return 'europe';
  if (cc === 'IL') return 'israel';
  return 'rest';
}

/** The mode for a visitor: an unknown country is ALWAYS ask first, in code, not editable. */
export function resolveMode(country: string | null | undefined, config: ConsentConfig): ConsentMode {
  const group = regionGroupOf(country);
  return group ? config.regions[group] : 'ask';
}

export function inUse(config: ConsentConfig): ConsentCategory[] {
  return CATEGORIES.filter((c) => config.categoriesInUse.includes(c));
}

function normaliseCategories(value: unknown): ConsentCategory[] {
  return Array.isArray(value) ? CATEGORIES.filter((c) => value.includes(c)) : [];
}

/**
 * Reads the stored choice. Old string values migrate: "accepted" -> each category in `legacyAcceptedMeans` on, the
 * others off; "declined" -> all off; both count as asked for exactly the `legacyAcceptedMeans` categories (what the old
 * banner asked), stored mode ask. Unreadable / unknown -> null (never answered).
 */
export function readStored(storageKey: string, legacyAcceptedMeans: ConsentCategory[]): StoredConsent | null {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(storageKey);
  } catch {
    return null;
  }
  if (raw === null) return null;
  const legacy = CATEGORIES.filter((c) => legacyAcceptedMeans.includes(c));
  if (raw === 'accepted' || raw === 'declined') {
    const on = raw === 'accepted';
    return {
      mode: 'ask',
      asked: legacy,
      choices: { analytics: on && legacy.includes('analytics'), marketing: on && legacy.includes('marketing') },
      at: 0,
    };
  }
  try {
    const p = JSON.parse(raw) as Partial<StoredConsent> | null;
    if (!p || typeof p !== 'object') return null;
    const c = (p.choices ?? {}) as Partial<ConsentChoices>;
    return {
      mode: p.mode === 'notice' ? 'notice' : 'ask',
      asked: normaliseCategories(p.asked),
      choices: { analytics: c.analytics === true, marketing: c.marketing === true },
      at: typeof p.at === 'number' ? p.at : 0,
    };
  } catch {
    return null;
  }
}

export function writeStored(storageKey: string, value: StoredConsent): void {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(value));
  } catch {
    // storage blocked: the choice cannot be kept
  }
}

/**
 * What may run right now, per category (D5):
 * - never answered: ask -> off, notice -> on;
 * - answered for that category: the stored choice (an older explicit off stays off);
 * - a category in use that was not asked: ask -> off until answered, notice -> on;
 * - stored mode notice but the visitor is now in an ask region: off until they answer here (a notice OK was never
 *   an opt-in), so an explicit off stays off and a previous on is re-asked.
 */
export function effectiveChoices(
  stored: StoredConsent | null,
  mode: ConsentMode,
  used: ConsentCategory[],
): ChoicesState {
  const out: ConsentChoices = { analytics: false, marketing: false };
  for (const c of used) {
    if (!stored) {
      out[c] = mode === 'notice';
    } else if (stored.mode === 'notice' && mode === 'ask') {
      out[c] = false;
    } else if (stored.asked.includes(c)) {
      out[c] = stored.choices[c];
    } else {
      out[c] = mode === 'notice';
    }
  }
  return out;
}
type ChoicesState = ConsentChoices;

/** True when the banner should show: nothing stored, an in-use category not in `asked`, or notice stored and ask now. */
export function bannerNeeded(stored: StoredConsent | null, mode: ConsentMode, used: ConsentCategory[]): boolean {
  if (used.length === 0) return false;
  if (!stored) return true;
  if (stored.mode === 'notice' && mode === 'ask') return true;
  return used.some((c) => !stored.asked.includes(c));
}

/** True only for an explicit "off" the visitor chose for a category. */
export function explicitlyDeclined(stored: StoredConsent | null, category: ConsentCategory): boolean {
  return !!stored && stored.asked.includes(category) && stored.choices[category] === false;
}

// ---- cookies -------------------------------------------------------------------------------------------------------

const COOKIES: Record<ConsentCategory, RegExp> = {
  analytics: /^(_ga|_gid|_ga_.+)$/,
  marketing: /^(_fbp|_fbc)$/,
};

/** `a.b.example.com` -> [`a.b.example.com`, `b.example.com`, `example.com`] (never a bare top-level label). */
export function cookieDomainCandidates(host: string): string[] {
  const labels = host.split('.').filter(Boolean);
  if (labels.length < 2 || /^[\d.]+$/.test(host) || host.includes(':')) return [];
  const out: string[] = [];
  for (let i = 0; i <= labels.length - 2; i += 1) out.push(labels.slice(i).join('.'));
  return out;
}

/** Expires the category's cookies for the current host and every parent domain, path `/`. */
export function clearCategoryCookies(category: ConsentCategory): void {
  if (typeof document === 'undefined') return;
  const names = document.cookie
    .split(';')
    .map((part) => part.split('=')[0].trim())
    .filter((name) => COOKIES[category].test(name));
  if (names.length === 0) return;
  const domains = cookieDomainCandidates(window.location.hostname);
  const expire = 'expires=Thu, 01 Jan 1970 00:00:00 GMT; max-age=0; path=/';
  for (const name of names) {
    document.cookie = `${name}=; ${expire}`;
    for (const domain of domains) {
      document.cookie = `${name}=; ${expire}; domain=${domain}`;
      document.cookie = `${name}=; ${expire}; domain=.${domain}`;
    }
  }
}

/** Page-level actions behind an object so a test can watch the reload and the hard navigation. */
export const pageActions = {
  reload: () => window.location.reload(),
  /** A hard navigation (the page is replaced, nothing of the old document keeps running). */
  assign: (url: string) => window.location.assign(url),
};

// ---- environment ---------------------------------------------------------------------------------------------------

/** The page editor shows the site in an iframe and /preview is editor chrome, not a visit: nothing renders or loads. */
export function isEmbeddedOrPreview(): boolean {
  if (typeof window === 'undefined') return true;
  if (window.location.pathname.startsWith('/preview')) return true;
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

// ---- region call ---------------------------------------------------------------------------------------------------

export const GEO_TIMEOUT_MS = 1500;

/**
 * The page's `?ck_country=<CC>` (2 ASCII letters, upper-cased) or null. The dashboard honours it only on staging
 * (USE_STAGING_DOMAINS=true); production ignores it. Anything else is never forwarded.
 */
function countryOverride(): string | null {
  try {
    const v = new URLSearchParams(window.location.search).get('ck_country');
    return v !== null && /^[A-Za-z]{2}$/.test(v) ? v.toUpperCase() : null;
  } catch {
    return null;
  }
}

/**
 * `GET <dashboardUrl>/api/public/visitor-geo` (plus `?ck_country=<CC>` when the page carries a valid override; then the
 * sessionStorage cache is neither read nor written) with a hard 1.5 s timeout; the answer is kept in sessionStorage for the
 * visit (one call per visit). Any failure, block or timeout -> null (ask first). Failures are not cached.
 */
export async function fetchCountry(dashboardUrl: string | undefined, storageKey: string): Promise<string | null> {
  const cacheKey = `${storageKey}:geo`;
  const override = countryOverride();
  try {
    if (override) throw new Error('override: skip the cache');
    const cached = window.sessionStorage.getItem(cacheKey);
    if (cached !== null) {
      const parsed = JSON.parse(cached) as { country?: unknown };
      return typeof parsed.country === 'string' ? parsed.country : null;
    }
  } catch {
    // no sessionStorage: fall through to the call
  }
  if (!dashboardUrl) return null;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(null);
    }, GEO_TIMEOUT_MS);
  });
  const call = (async () => {
    const res = await fetch(`${dashboardUrl.replace(/\/+$/, '')}/api/public/visitor-geo${override ? `?ck_country=${override}` : ''}`, {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!res.ok) return undefined;
    const body = (await res.json()) as { country?: unknown };
    return typeof body.country === 'string' ? body.country : null;
  })().catch(() => undefined);
  const result = await Promise.race([call, timeout]);
  if (timer) clearTimeout(timer);
  if (result === undefined || (result === null && controller.signal.aborted)) return null;
  if (override) return result;
  try {
    window.sessionStorage.setItem(cacheKey, JSON.stringify({ country: result }));
  } catch {
    // ignore
  }
  return result;
}
