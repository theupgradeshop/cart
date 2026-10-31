// Under-construction gate (`@upgradeshop/cart/site-gate`, v1.7.0; spec websites-o-p D5, council 2026-10-31).
// Server-safe entry: NO 'use client', no React. Runs first in a site's middleware/proxy.
//
// siteGate(req, opts) -> Response | null.  null = "not gated, carry on" (mode off, skipped path, dashboard
// unreachable on a cold start, or ANY error inside: the whole body is wrapped, a bug here never takes a site down).
//
// UC mode is a presentation/search signal over already-public content, NOT access control.
import { NextResponse, type NextRequest } from 'next/server';
import {
  PASS_COOKIE,
  PREVIEW_COOKIE,
  PREVIEW_PARAM,
  VIEW_COOKIE,
  VIEW_PARAM,
  type SiteGateVariant,
  type SiteGateView,
} from './shared';

export type { SiteGateView, SiteGateVariant } from './shared';

export interface SiteGateOptions {
  /** The site's public host, as registered in the dashboard (e.g. `camoflash.co.il`). */
  domain: string;
  /** Dashboard base URL (e.g. `https://app.upgradeshop.ai`). */
  platformUrl: string;
  /** The site's own extra skip (its thank-you route). Build it with `thankYouSkip`. */
  extraSkip?: (pathname: string) => boolean;
  /** Test seam; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}

export interface SiteGateAnswer {
  on: boolean;
  view: SiteGateView;
  variant: SiteGateVariant;
  businessName: string;
}

// ---------------------------------------------------------------- skip list

const SKIP_PREFIXES = ['/api', '/_next', '/preview', '/brand-icon', '/d', '/l'];
/** The render route. NOT skipped: it is gated like any page (a direct request never renders it in public). */
const COMING_SOON_PATH = '/site-coming-soon';
const FILE_EXT_RE = /\.[A-Za-z0-9]+$/;
const SKIP_EXACT = ['/robots.txt', '/sitemap.xml'];

function underSegment(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(prefix + '/');
}

/** Paths the gate never touches. Segment-boundary matches only: `/api-docs` and `/preview-x` are gated. */
export function isSiteGateSkipped(pathname: string): boolean {
  if (SKIP_EXACT.includes(pathname)) return true;
  // Static files (favicon.ico, /x/file.ext): only when the LAST segment carries an extension.
  const last = pathname.slice(pathname.lastIndexOf('/') + 1);
  if (FILE_EXT_RE.test(last)) return true;
  return SKIP_PREFIXES.some((p) => underSegment(pathname, p));
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\\/-]/g, '\\$&');
}

/**
 * Build a site's `extraSkip` for its thank-you route(s). `path` is the site's own path (`/thank-you`,
 * `/checkout/thank-you`) or a list of them (add the `/checkout-thank-you` CMS slug where the site has it).
 * Matches at a segment boundary, with or without a trailing slash, optionally behind one language prefix
 * (codes taken from the site's enabled languages, regex-escaped). `<path>-x` does NOT match.
 */
export function thankYouSkip(path: string | string[], enabledLanguages: string[]): (pathname: string) => boolean {
  const paths = (Array.isArray(path) ? path : [path])
    .map((p) => '/' + p.trim().replace(/^\/+|\/+$/g, ''))
    .filter((p) => p !== '/');
  if (paths.length === 0) return () => false;
  const langs = enabledLanguages.filter((l) => typeof l === 'string' && l.length > 0).map(escapeRegExp);
  const langPart = langs.length ? `(?:/(?:${langs.join('|')}))?` : '';
  const re = new RegExp(`^${langPart}(?:${paths.map(escapeRegExp).join('|')})(?:/.*)?$`);
  return (pathname: string) => re.test(pathname);
}

// ---------------------------------------------------------------- tokens

const MAX_TOKEN_LEN = 1024;
const PASS_RE = /^[A-Za-z0-9_-]{1,900}\.[A-Za-z0-9_-]{1,300}$/;
const PREVIEW_RE = /^[A-Za-z0-9_-]{16,128}$/;

function validPass(v: string | undefined): string | undefined {
  return v && v.length <= MAX_TOKEN_LEN && PASS_RE.test(v) ? v : undefined;
}
function validPreview(v: string | null | undefined): string | undefined {
  return v && v.length <= MAX_TOKEN_LEN && PREVIEW_RE.test(v) ? v : undefined;
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

// ---------------------------------------------------------------- fetch + cache

const TTL_MS = 5_000;
const BACKOFF_MS = 5_000;
const IDLE_AWAIT_MS = 60_000;
const TIMEOUT_MS = 1_000;
const LRU_CAP = 64;
const FAILURE_LOG_INTERVAL_MS = 5 * 60_000;
const BUCKET_CAPACITY = 5;
const BUCKET_REFILL_PER_SEC = 5;
const MAX_NAME_LEN = 200;

interface Entry {
  answer: SiteGateAnswer | null;
  /** Last attempt (ok or failed): drives the tokenless revalidate/backoff clock. */
  at: number;
  /** Last SUCCESSFUL fetch: the only clock that makes an answer fresh. */
  okAt: number;
  lastOk: boolean;
  inflight: Promise<SiteGateAnswer | null> | null;
  lastFailureLogAt: number;
}

interface Tokens {
  pass?: string;
  preview?: string;
}

const VIEWS: readonly string[] = ['visitor', 'team', 'preview'];
const VARIANTS: readonly string[] = ['centered', 'split', 'banner'];

/** Lone surrogates -> U+FFFD (encodeURIComponent throws on them). */
function wellFormed(s: string): string {
  const w = (s as string & { toWellFormed?: () => string }).toWellFormed;
  if (typeof w === 'function') return w.call(s);
  return s.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '\uFFFD');
}

/** At most MAX_NAME_LEN code points (never splits a surrogate pair), well-formed. */
function cleanName(s: string): string {
  try {
    return wellFormed(Array.from(s).slice(0, MAX_NAME_LEN).join(''));
  } catch {
    return '';
  }
}

function encodeName(s: string): string {
  try {
    return encodeURIComponent(wellFormed(s));
  } catch {
    return '';
  }
}

function parseAnswer(data: unknown): SiteGateAnswer | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  if (typeof d.on !== 'boolean') return null;
  if (!d.on) return { on: false, view: 'visitor', variant: 'centered', businessName: '' };
  if (typeof d.view !== 'string' || !VIEWS.includes(d.view)) return null;
  if (typeof d.variant !== 'string' || !VARIANTS.includes(d.variant)) return null;
  if (typeof d.businessName !== 'string') return null;
  return {
    on: true,
    view: d.view as SiteGateView,
    variant: d.variant as SiteGateVariant,
    businessName: cleanName(d.businessName),
  };
}

/** One dashboard call. Headers are built from scratch; req.headers is never copied. null = unreachable. */
async function fetchAnswer(
  domain: string,
  platformUrl: string,
  tokens: Tokens,
  fetchImpl: typeof fetch,
): Promise<SiteGateAnswer | null> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(null);
    }, TIMEOUT_MS);
  });
  const work = (async () => {
    const headers = new Headers({ accept: 'application/json' });
    if (tokens.pass) headers.set('x-tus-site-pass', tokens.pass);
    if (tokens.preview) headers.set('x-tus-site-preview', tokens.preview);
    const url = `${platformUrl.replace(/\/+$/, '')}/api/public/site-gate?domain=${encodeURIComponent(domain)}`;
    const res = await fetchImpl(url, { method: 'GET', headers, signal: controller.signal, cache: 'no-store', redirect: 'manual' });
    if (!res.ok) return null; // 3xx (manual), 404, 429, 5xx: unreachable
    return parseAnswer(await res.json());
  })().catch(() => null);
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function newEntry(): Entry {
  return { answer: null, at: 0, okAt: 0, lastOk: true, inflight: null, lastFailureLogAt: 0 };
}

/** Tokenless entries live outside the LRU so a flood of distinct tokens can never evict last-known. */
const tokenless = new Map<string, Entry>();
const tokened = new Map<string, Entry>(); // bounded LRU
let bucketTokens = BUCKET_CAPACITY;
let bucketAt = 0;

function takeBucket(now: number): boolean {
  if (bucketAt === 0) bucketAt = now;
  bucketTokens = Math.min(BUCKET_CAPACITY, bucketTokens + ((now - bucketAt) / 1000) * BUCKET_REFILL_PER_SEC);
  bucketAt = now;
  if (bucketTokens < 1) return false;
  bucketTokens -= 1;
  return true;
}

/** Test helper: forget every cache entry and refill the token bucket. */
export function __resetSiteGateForTests(): void {
  tokenless.clear();
  tokened.clear();
  bucketTokens = BUCKET_CAPACITY;
  bucketAt = 0;
}

/** Test helper: how many entries each cache holds (the token LRU is bounded). */
export function __siteGateCacheSizes(): { tokened: number; tokenless: number } {
  return { tokened: tokened.size, tokenless: tokenless.size };
}

function refresh(
  entry: Entry,
  domain: string,
  platformUrl: string,
  tokens: Tokens,
  fetchImpl: typeof fetch,
  logFailures: boolean,
  dropOnFailure = false,
): Promise<SiteGateAnswer | null> {
  if (!entry.inflight) {
    entry.inflight = (async () => {
      const answer = await fetchAnswer(domain, platformUrl, tokens, fetchImpl);
      const now = Date.now();
      if (answer) {
        entry.answer = answer; // only a 2xx with a valid body writes the cache
        entry.okAt = now;
        if (!entry.lastOk && logFailures) console.info(`[site-gate] dashboard reachable again for ${domain}`);
        entry.lastOk = true;
      } else {
        if (logFailures && (entry.lastOk || now - entry.lastFailureLogAt >= FAILURE_LOG_INTERVAL_MS)) {
          entry.lastFailureLogAt = now;
          console.error(
            `[site-gate] dashboard unreachable for ${domain} - ` +
              (entry.answer ? 'serving the last-known answer' : 'no answer known yet, the site is served OPEN'),
          );
        }
        entry.lastOk = false;
        if (dropOnFailure) entry.answer = null; // a token answer is never served past its TTL
      }
      entry.at = now;
      return answer;
    })().finally(() => {
      entry.inflight = null;
    });
  }
  return entry.inflight;
}

/** Tokenless: stale-while-revalidate, last-known kept through any outage. null = never known. */
async function getTokenless(domain: string, platformUrl: string, fetchImpl: typeof fetch): Promise<SiteGateAnswer | null> {
  let e = tokenless.get(domain);
  if (!e) {
    e = newEntry();
    tokenless.set(domain, e);
  }
  const now = Date.now();
  const stale = now - e.at >= (e.lastOk ? TTL_MS : BACKOFF_MS);
  if (e.answer) {
    if (now - e.okAt >= IDLE_AWAIT_MS) {
      // Idle site: the last-known answer is old, so wait for the refresh (bounded by the 1 s timeout).
      if (!e.lastOk && !stale) return e.answer; // already failed just now: back off
      await refresh(e, domain, platformUrl, {}, fetchImpl, true);
      return e.answer;
    }
    if (stale) void refresh(e, domain, platformUrl, {}, fetchImpl, true);
    return e.answer;
  }
  if (!e.lastOk && !stale) return null; // backing off: do not pay the timeout on every request
  await refresh(e, domain, platformUrl, {}, fetchImpl, true);
  return e.answer;
}

/** Token-bearing: answer valid for one TTL only (never served stale); null = unreachable / over the cap. */
async function getTokened(
  key: string,
  domain: string,
  platformUrl: string,
  tokens: Tokens,
  fetchImpl: typeof fetch,
): Promise<SiteGateAnswer | null> {
  const now = Date.now();
  let e = tokened.get(key);
  if (e) {
    tokened.delete(key);
    tokened.set(key, e); // LRU touch
    if (e.answer && now - e.okAt < TTL_MS) return e.answer;
    if (e.inflight) return e.inflight;
    if (!e.lastOk && now - e.at < BACKOFF_MS) return null;
  }
  if (!takeBucket(now)) return null;
  if (!e) {
    e = newEntry();
    tokened.set(key, e);
    while (tokened.size > LRU_CAP) {
      const oldest = tokened.keys().next().value;
      if (oldest === undefined) break;
      tokened.delete(oldest);
    }
  }
  return refresh(e, domain, platformUrl, tokens, fetchImpl, false, true);
}

// ---------------------------------------------------------------- responses

const SECURE_HOST_COOKIE = { httpOnly: true, secure: true, sameSite: 'lax' as const, path: '/' };

function cleanRequestHeaders(req: NextRequest): Headers {
  const h = new Headers(req.headers);
  const drop: string[] = [];
  h.forEach((_v, k) => {
    if (k.startsWith('x-tus-site-') || k.startsWith('x-tus-uc-')) drop.push(k);
  });
  for (const k of drop) h.delete(k);
  return h;
}

function visitorResponse(
  req: NextRequest,
  info: { variant: SiteGateVariant; businessName: string },
  deleteCookies: string[],
): NextResponse {
  const headers = cleanRequestHeaders(req);
  headers.set('x-tus-uc-variant', info.variant);
  headers.set('x-tus-uc-business-name', encodeName(info.businessName));
  const res = NextResponse.rewrite(new URL('/site-coming-soon', req.url), {
    status: 503,
    headers: { 'Retry-After': '3600', 'Cache-Control': 'no-store' },
    request: { headers },
  });
  for (const name of deleteCookies) res.cookies.set(name, '', { ...SECURE_HOST_COOKIE, maxAge: 0 });
  if (req.cookies.get(VIEW_COOKIE)) res.cookies.set(VIEW_COOKIE, '', { path: '/', maxAge: 0 });
  return res;
}

const VIEW_COOKIE_MAX_AGE = 30;

/**
 * Public origin of the request. The protocol comes from nginx's x-forwarded-proto when well-formed, else nextUrl.
 * The host is pinned: x-forwarded-host / host is used only when it equals the site's `domain` (case-insensitive,
 * port stripped); anything else, including a forged header, yields `domain` itself.
 */
function requestOrigin(req: NextRequest, domain: string): { proto: 'http' | 'https'; host: string } {
  const first = (v: string | null) => (v ? v.split(',')[0].trim() : '');
  const claimed = (first(req.headers.get('x-forwarded-host')) || first(req.headers.get('host'))).replace(/:\d{1,5}$/, '').toLowerCase();
  const host = claimed !== '' && claimed === domain.toLowerCase() ? claimed : domain;
  const fProto = first(req.headers.get('x-forwarded-proto')).toLowerCase();
  const proto = fProto === 'http' || fProto === 'https' ? fProto : req.nextUrl.protocol === 'https:' ? 'https' : 'http';
  return { proto, host };
}

/** Mode off: open (null), but expire a leftover team/preview bar cookie. */
function offResponse(req: NextRequest, pathname: string): Response | null {
  if (pathname === COMING_SOON_PATH || pathname.startsWith(COMING_SOON_PATH + '/')) return null;
  if (!req.cookies.get(VIEW_COOKIE)) return null;
  const res = NextResponse.next();
  res.cookies.set(VIEW_COOKIE, '', { path: '/', maxAge: 0 });
  return res;
}

function insideResponse(req: NextRequest, view: 'team' | 'preview', domain: string): NextResponse {
  const res = NextResponse.next({ request: { headers: cleanRequestHeaders(req) } });
  res.headers.set('Cache-Control', 'private, no-store');
  // Readable by the bar. Short and refreshed on every gated request, so it cannot outlive the mode for long.
  res.cookies.set(VIEW_COOKIE, view, {
    httpOnly: false,
    secure: requestOrigin(req, domain).proto === 'https',
    sameSite: 'lax',
    path: '/',
    maxAge: VIEW_COOKIE_MAX_AGE,
  });
  return res;
}

// ---------------------------------------------------------------- the gate

export async function siteGate(req: NextRequest, opts: SiteGateOptions): Promise<Response | null> {
  let result: Response | null = null;
  try {
    result = await gateInner(req, opts);
  } catch {
    result = null;
  }
  if (result === null && isComingSoonRequest(req)) {
    // The render route never renders in public unless the gate has put the visitor/team view in front of it.
    return new NextResponse('Not found', {
      status: 404,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }
  return result;
}

function isComingSoonRequest(req: NextRequest): boolean {
  try {
    const p = req.nextUrl.pathname;
    return p === COMING_SOON_PATH || p.startsWith(COMING_SOON_PATH + '/');
  } catch {
    return false;
  }
}

async function gateInner(req: NextRequest, opts: SiteGateOptions): Promise<Response | null> {
  try {
    const { domain, platformUrl } = opts;
    if (!domain || !platformUrl) return null;
    const pathname = req.nextUrl.pathname;
    if (isSiteGateSkipped(pathname)) return null;
    if (opts.extraSkip && opts.extraSkip(pathname)) return null;
    const fetchImpl = opts.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));

    const forceVisitor = req.nextUrl.searchParams.get(VIEW_PARAM) === 'visitor';
    const previewParamRaw = forceVisitor ? null : req.nextUrl.searchParams.get(PREVIEW_PARAM);

    // 1. A preview link click: verify the token alone, then cookie + 302 without the param.
    if (previewParamRaw !== null) {
      const candidate = validPreview(previewParamRaw);
      if (candidate) {
        const tokens: Tokens = { preview: candidate };
        const answer = await getTokened(await sha256Hex(`${domain}\n\n${candidate}`), domain, platformUrl, tokens, fetchImpl);
        if (answer && !answer.on) return offResponse(req, pathname);
        if (answer && answer.view !== 'visitor') {
          const target = req.nextUrl.clone();
          target.searchParams.delete(PREVIEW_PARAM);
          const o = requestOrigin(req, domain);
          const res = NextResponse.redirect(`${o.proto}://${o.host}${target.pathname}${target.search}`, 302);
          res.headers.set('Cache-Control', 'no-store');
          res.headers.set('Referrer-Policy', 'no-referrer');
          res.cookies.set(PREVIEW_COOKIE, candidate, SECURE_HOST_COOKIE); // session cookie: no maxAge
          return res;
        }
        if (answer) return visitorResponse(req, answer, []); // invalid/turned-off link: visitor view, no cookie
        return unreachable(req, domain);
      }
      // malformed value: nothing is forwarded; fall through as an ordinary request
    }

    // 2. Ordinary request: cookies decide which tokens (if any) go to the dashboard.
    const tokens: Tokens = {};
    if (!forceVisitor) {
      tokens.pass = validPass(req.cookies.get(PASS_COOKIE)?.value);
      tokens.preview = validPreview(req.cookies.get(PREVIEW_COOKIE)?.value);
    }
    const hasTokens = Boolean(tokens.pass || tokens.preview);

    if (!hasTokens) {
      const answer = await getTokenless(domain, platformUrl, fetchImpl);
      if (!answer) return null; // cold start with the dashboard down: open
      if (!answer.on) return offResponse(req, pathname);
      return visitorResponse(req, answer, []);
    }

    const key = await sha256Hex(`${domain}\n${tokens.pass ?? ''}\n${tokens.preview ?? ''}`);
    const answer = await getTokened(key, domain, platformUrl, tokens, fetchImpl);
    if (!answer) return unreachable(req, domain);
    if (!answer.on) return offResponse(req, pathname);
    if (answer.view === 'visitor') {
      // A definitive 2xx "invalid" answer: the only time a cookie is deleted.
      const del: string[] = [];
      if (tokens.pass) del.push(PASS_COOKIE);
      if (tokens.preview) del.push(PREVIEW_COOKIE);
      return visitorResponse(req, answer, del);
    }
    return insideResponse(req, answer.view, domain);
  } catch {
    return null;
  }
}

/**
 * The dashboard could not give a token-bearing request an answer (down, slow, 429, malformed, over the cap).
 * Visitor view, unless the last TOKENLESS answer on record was "off" (then open). The cookie is kept.
 */
function unreachable(req: NextRequest, domain: string): Response | null {
  const last = tokenless.get(domain)?.answer ?? null;
  if (last && !last.on) return null;
  return visitorResponse(req, last ?? { variant: 'centered', businessName: '' }, []);
}
