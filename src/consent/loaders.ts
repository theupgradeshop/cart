// Tool loaders, called only when the tool's category is allowed. Plain browser code, idempotent per page.

import type { ConsentCategory } from './logic';

/** A Meta Pixel id is all digits; anything else is never put into the inline snippet. */
const PIXEL_ID = /^\d{1,20}$/;
/** A GA measurement id (G-XXXX, UA-..., AW-...) never contains anything outside these characters. */
const GA_ID = /^[A-Za-z0-9-]{3,40}$/;

// Pages whose address IS the capability (/s/<id>, /g/<code>, a language prefix allowed) or whose query carries one.
const CAPABILITY_PATH = /^\/(?:[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})?\/)?[sg]\/[^/]/;
const CAPABILITY_INSIDE = /\/(?:[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})?\/)?[sg]\/[0-9a-f]{32}(?![0-9a-f])/;

function decodeAll(value: string): string[] {
  const out = [value];
  let current = value;
  for (let i = 0; i < 3; i++) {
    let next: string;
    try {
      next = decodeURIComponent(current);
    } catch {
      break;
    }
    if (next === current) break;
    out.push(next);
    current = next;
  }
  return out;
}

export function isCapabilityPath(pathname: string | null | undefined): boolean {
  return typeof pathname === 'string' && CAPABILITY_PATH.test(pathname);
}

export function searchCarriesCapability(search: string | null | undefined): boolean {
  if (typeof search !== 'string' || search === '') return false;
  const values = [search.replace(/^\?/, '')];
  try {
    const params = new URLSearchParams(search);
    if (params.has('booking')) return true;
    params.forEach((v) => values.push(v));
  } catch {
    // the raw string is still checked
  }
  return values.some((v) => decodeAll(v).some((d) => CAPABILITY_INSIDE.test(d)));
}

/** No pixel / analytics on a capability address, nor on a page whose query carries one. */
export function onCapabilityPage(): boolean {
  return isCapabilityPath(window.location.pathname) || searchCarriesCapability(window.location.search);
}

type Win = Window & { fbq?: unknown; dataLayer?: unknown[]; gtag?: (...a: unknown[]) => void; __tusConsentGa?: string };

/** Meta Pixel: `autoConfig` off BEFORE init (no click hrefs / page metadata sent), then PageView. Returns true if started. */
export function loadMetaPixel(pixelId: string | null | undefined): boolean {
  if (!pixelId || !PIXEL_ID.test(pixelId) || onCapabilityPage()) return false;
  const w = window as Win;
  if (w.fbq) return false;
  const f = w as unknown as Record<string, any>;
  const n: any = function (...args: unknown[]) {
    if (n.callMethod) n.callMethod.apply(n, args);
    else n.queue.push(args);
  };
  f.fbq = n;
  if (!f._fbq) f._fbq = n;
  n.push = n;
  n.loaded = true;
  n.version = '2.0';
  n.queue = [];
  const s = document.createElement('script');
  s.async = true;
  s.src = 'https://connect.facebook.net/en_US/fbevents.js';
  (document.head || document.documentElement).appendChild(s);
  n('set', 'autoConfig', false, pixelId);
  n('init', pixelId);
  n('track', 'PageView');
  return true;
}

/** Google Analytics (gtag.js). Returns true if started. */
export function loadGoogleAnalytics(gaId: string | null | undefined): boolean {
  if (!gaId || !GA_ID.test(gaId) || onCapabilityPage()) return false;
  const w = window as Win;
  if (w.__tusConsentGa === gaId) return false;
  w.__tusConsentGa = gaId;
  w.dataLayer = w.dataLayer || [];
  w.gtag =
    w.gtag ||
    function gtag(...args: unknown[]) {
      // gtag.js reads the `arguments` object, not an array
      (w.dataLayer as unknown[]).push(arguments.length ? arguments : args);
    };
  const s = document.createElement('script');
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(gaId)}`;
  (document.head || document.documentElement).appendChild(s);
  w.gtag('js', new Date());
  w.gtag('config', gaId);
  return true;
}

export interface ConsentScriptItem {
  /** Stable id of the script (a hash of placement + content is used when absent). */
  id?: string | number;
  /** `head`, `body_start`/`bodyStart`, `body_end`/`bodyEnd` (any other value lands at the body end). */
  placement: 'head' | 'body_start' | 'bodyStart' | 'body_end' | 'bodyEnd' | string;
  content: string;
  /** necessary | analytics | marketing | null (null counts as marketing). */
  category?: 'necessary' | ConsentCategory | null;
}

export function scriptCategory(item: ConsentScriptItem): 'necessary' | ConsentCategory {
  return item.category === 'necessary' || item.category === 'analytics' ? item.category : 'marketing';
}

function normalizePlacement(placement: string): 'head' | 'bodyStart' | 'bodyEnd' {
  if (placement === 'head') return 'head';
  if (placement === 'body_start' || placement === 'bodyStart') return 'bodyStart';
  return 'bodyEnd';
}

/** FNV-1a 32-bit hash, base 36: a stable key for an item that has no id. */
function hashScript(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

/**
 * Injects the site scripts whose category is allowed (`necessary` always). `allowed` is the effective choice map.
 * Each item is injected once per page. Returns the items injected by this call.
 */
export function injectConsentScripts(
  items: ConsentScriptItem[] | null | undefined,
  allowed: Record<ConsentCategory, boolean>,
): ConsentScriptItem[] {
  const done: ConsentScriptItem[] = [];
  if (!Array.isArray(items) || typeof document === 'undefined') return done;
  items.forEach((item) => {
    if (!item || typeof item.content !== 'string' || !item.content.trim()) return;
    const cat = scriptCategory(item);
    if (cat !== 'necessary' && !allowed[cat]) return;
    const placement = normalizePlacement(item.placement);
    const key = `${placement}:${item.id ?? hashScript(`${placement}\n${item.content}`)}`;
    const marks = ((window as unknown as { __tusConsentScripts?: Set<string> }).__tusConsentScripts ??= new Set());
    if (marks.has(key)) return;
    marks.add(key);
    const host = placement === 'head' ? document.head : document.body;
    if (!host) return;
    const tpl = document.createElement('template');
    tpl.innerHTML = item.content;
    const nodes = Array.from(tpl.content.childNodes).map((node) => {
      if (node.nodeName !== 'SCRIPT') return node;
      // a parsed <script> never runs: rebuild it
      const old = node as HTMLScriptElement;
      const fresh = document.createElement('script');
      for (const a of Array.from(old.attributes)) fresh.setAttribute(a.name, a.value);
      fresh.text = old.text;
      return fresh;
    });
    if (placement === 'bodyStart') {
      for (const n of nodes.reverse()) host.insertBefore(n, host.firstChild);
    } else {
      for (const n of nodes) host.appendChild(n);
    }
    done.push(item);
  });
  return done;
}
