'use client';
"use client";

// src/consent/index.tsx
import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { configureTracking } from "@upgradeshop/cart/tracking";

// src/consent/logic.ts
var CATEGORIES = ["analytics", "marketing"];
var EU27 = [
  "AT",
  "BE",
  "BG",
  "HR",
  "CY",
  "CZ",
  "DK",
  "EE",
  "FI",
  "FR",
  "DE",
  "GR",
  "HU",
  "IE",
  "IT",
  "LV",
  "LT",
  "LU",
  "MT",
  "NL",
  "PL",
  "PT",
  "RO",
  "SK",
  "SI",
  "ES",
  "SE"
];
var EUROPE = /* @__PURE__ */ new Set([...EU27, "IS", "LI", "NO", "GB", "CH"]);
function regionGroupOf(country) {
  if (typeof country !== "string") return null;
  const cc = country.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(cc) || cc === "XX" || cc === "T1") return null;
  if (EUROPE.has(cc)) return "europe";
  if (cc === "IL") return "israel";
  return "rest";
}
function resolveMode(country, config) {
  const group = regionGroupOf(country);
  return group ? config.regions[group] : "ask";
}
function inUse(config) {
  return CATEGORIES.filter((c) => config.categoriesInUse.includes(c));
}
function normaliseCategories(value) {
  return Array.isArray(value) ? CATEGORIES.filter((c) => value.includes(c)) : [];
}
function readStored(storageKey, legacyAcceptedMeans) {
  let raw = null;
  try {
    raw = window.localStorage.getItem(storageKey);
  } catch {
    return null;
  }
  if (raw === null) return null;
  const legacy = CATEGORIES.filter((c) => legacyAcceptedMeans.includes(c));
  if (raw === "accepted" || raw === "declined") {
    const on = raw === "accepted";
    return {
      mode: "ask",
      asked: legacy,
      choices: { analytics: on && legacy.includes("analytics"), marketing: on && legacy.includes("marketing") },
      at: 0
    };
  }
  try {
    const p = JSON.parse(raw);
    if (!p || typeof p !== "object") return null;
    const c = p.choices ?? {};
    return {
      mode: p.mode === "notice" ? "notice" : "ask",
      asked: normaliseCategories(p.asked),
      choices: { analytics: c.analytics === true, marketing: c.marketing === true },
      at: typeof p.at === "number" ? p.at : 0
    };
  } catch {
    return null;
  }
}
function writeStored(storageKey, value) {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(value));
  } catch {
  }
}
function effectiveChoices(stored, mode, used) {
  const out = { analytics: false, marketing: false };
  for (const c of used) {
    if (!stored) {
      out[c] = mode === "notice";
    } else if (stored.mode === "notice" && mode === "ask") {
      out[c] = false;
    } else if (stored.asked.includes(c)) {
      out[c] = stored.choices[c];
    } else {
      out[c] = mode === "notice";
    }
  }
  return out;
}
function bannerNeeded(stored, mode, used) {
  if (used.length === 0) return false;
  if (!stored) return true;
  if (stored.mode === "notice" && mode === "ask") return true;
  return used.some((c) => !stored.asked.includes(c));
}
function explicitlyDeclined(stored, category) {
  return !!stored && stored.asked.includes(category) && stored.choices[category] === false;
}
function gpcSignal() {
  return typeof navigator !== "undefined" && navigator.globalPrivacyControl === true;
}
function isUSCountry(country) {
  return typeof country === "string" && country.trim().toUpperCase() === "US";
}
var COOKIES = {
  analytics: /^(_ga|_gid|_ga_.+)$/,
  marketing: /^(_fbp|_fbc)$/
};
function cookieDomainCandidates(host) {
  const labels = host.split(".").filter(Boolean);
  if (labels.length < 2 || /^[\d.]+$/.test(host) || host.includes(":")) return [];
  const out = [];
  for (let i = 0; i <= labels.length - 2; i += 1) out.push(labels.slice(i).join("."));
  return out;
}
function clearCategoryCookies(category) {
  if (typeof document === "undefined") return;
  const names = document.cookie.split(";").map((part) => part.split("=")[0].trim()).filter((name) => COOKIES[category].test(name));
  if (names.length === 0) return;
  const domains = cookieDomainCandidates(window.location.hostname);
  const expire = "expires=Thu, 01 Jan 1970 00:00:00 GMT; max-age=0; path=/";
  for (const name of names) {
    document.cookie = `${name}=; ${expire}`;
    for (const domain of domains) {
      document.cookie = `${name}=; ${expire}; domain=${domain}`;
      document.cookie = `${name}=; ${expire}; domain=.${domain}`;
    }
  }
}
var pageActions = {
  reload: () => window.location.reload(),
  /** A hard navigation (the page is replaced, nothing of the old document keeps running). */
  assign: (url) => window.location.assign(url)
};
function isEmbeddedOrPreview() {
  if (typeof window === "undefined") return true;
  if (window.location.pathname.startsWith("/preview")) return true;
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}
var GEO_TIMEOUT_MS = 1500;
function countryOverride() {
  try {
    const v = new URLSearchParams(window.location.search).get("ck_country");
    return v !== null && /^[A-Za-z]{2}$/.test(v) ? v.toUpperCase() : null;
  } catch {
    return null;
  }
}
async function fetchCountry(dashboardUrl, storageKey) {
  const cacheKey = `${storageKey}:geo`;
  const override = countryOverride();
  try {
    if (override) throw new Error("override: skip the cache");
    const cached = window.sessionStorage.getItem(cacheKey);
    if (cached !== null) {
      const parsed = JSON.parse(cached);
      return typeof parsed.country === "string" ? parsed.country : null;
    }
  } catch {
  }
  if (!dashboardUrl) return null;
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(null);
    }, GEO_TIMEOUT_MS);
  });
  const call = (async () => {
    const res = await fetch(`${dashboardUrl.replace(/\/+$/, "")}/api/public/visitor-geo${override ? `?ck_country=${override}` : ""}`, {
      method: "GET",
      cache: "no-store",
      signal: controller.signal
    });
    if (!res.ok) return void 0;
    const body = await res.json();
    return typeof body.country === "string" ? body.country : null;
  })().catch(() => void 0);
  const result = await Promise.race([call, timeout]);
  if (timer) clearTimeout(timer);
  if (result === void 0 || result === null && controller.signal.aborted) return null;
  if (override) return result;
  try {
    window.sessionStorage.setItem(cacheKey, JSON.stringify({ country: result }));
  } catch {
  }
  return result;
}

// src/consent/loaders.ts
var PIXEL_ID = /^\d{1,20}$/;
var GA_ID = /^[A-Za-z0-9-]{3,40}$/;
var CAPABILITY_PATH = /^\/(?:[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})?\/)?[sg]\/[^/]/;
var CAPABILITY_INSIDE = /\/(?:[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})?\/)?[sg]\/[0-9a-f]{32}(?![0-9a-f])/;
function decodeAll(value) {
  const out = [value];
  let current = value;
  for (let i = 0; i < 3; i++) {
    let next;
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
function isCapabilityPath(pathname) {
  return typeof pathname === "string" && CAPABILITY_PATH.test(pathname);
}
function searchCarriesCapability(search) {
  if (typeof search !== "string" || search === "") return false;
  const values = [search.replace(/^\?/, "")];
  try {
    const params = new URLSearchParams(search);
    if (params.has("booking")) return true;
    if (params.has("t")) return true;
    params.forEach((v) => values.push(v));
  } catch {
  }
  return values.some((v) => decodeAll(v).some((d) => CAPABILITY_INSIDE.test(d)));
}
function onCapabilityPage() {
  return isCapabilityPath(window.location.pathname) || searchCarriesCapability(window.location.search);
}
function isCapabilityUrl(target) {
  if (target === null || target === void 0) return false;
  try {
    const u = new URL(String(target), window.location.href);
    if (u.origin !== window.location.origin) return false;
    return isCapabilityPath(u.pathname) || searchCarriesCapability(u.search);
  } catch {
    return false;
  }
}
function consentToolsLoaded() {
  return window.__tusConsentLoaded === true;
}
function markLoaded() {
  window.__tusConsentLoaded = true;
}
function loadMetaPixel(pixelId) {
  if (!pixelId || !PIXEL_ID.test(pixelId) || onCapabilityPage()) return false;
  const w = window;
  if (w.fbq) return false;
  const f = w;
  const n = function(...args) {
    if (n.callMethod) n.callMethod.apply(n, args);
    else n.queue.push(args);
  };
  n.disablePushState = true;
  f.fbq = n;
  if (!f._fbq) f._fbq = n;
  n.push = n;
  n.loaded = true;
  n.version = "2.0";
  n.queue = [];
  const s = document.createElement("script");
  s.async = true;
  s.src = "https://connect.facebook.net/en_US/fbevents.js";
  (document.head || document.documentElement).appendChild(s);
  n("set", "autoConfig", false, pixelId);
  n("init", pixelId);
  n("track", "PageView");
  w.__tusConsentPixel = true;
  markLoaded();
  return true;
}
function sendMetaPageView() {
  const w = window;
  if (!w.__tusConsentPixel || typeof w.fbq !== "function" || onCapabilityPage()) return false;
  w.fbq("track", "PageView");
  return true;
}
function loadGoogleAnalytics(gaId) {
  if (!gaId || !GA_ID.test(gaId) || onCapabilityPage()) return false;
  const w = window;
  if (w.__tusConsentGa === gaId) return false;
  w.__tusConsentGa = gaId;
  w.dataLayer = w.dataLayer || [];
  w.gtag = w.gtag || function gtag(...args) {
    w.dataLayer.push(arguments.length ? arguments : args);
  };
  const s = document.createElement("script");
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(gaId)}`;
  (document.head || document.documentElement).appendChild(s);
  w.gtag("js", /* @__PURE__ */ new Date());
  w.gtag("config", gaId, { send_page_view: false });
  markLoaded();
  sendGaPageView();
  return true;
}
function sendGaPageView() {
  const w = window;
  if (!w.__tusConsentGa || typeof w.gtag !== "function" || onCapabilityPage()) return false;
  w.gtag("event", "page_view", {
    page_location: window.location.href.split("#")[0],
    // never the hash
    page_path: window.location.pathname + window.location.search,
    page_title: document.title,
    send_to: w.__tusConsentGa
  });
  return true;
}
function scriptCategory(item) {
  return item.category === "necessary" || item.category === "analytics" ? item.category : "marketing";
}
function normalizePlacement(placement) {
  if (placement === "head") return "head";
  if (placement === "body_start" || placement === "bodyStart") return "bodyStart";
  return "bodyEnd";
}
function hashScript(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(36);
}
function injectConsentScripts(items, allowed) {
  const done = [];
  if (!Array.isArray(items) || typeof document === "undefined") return done;
  if (onCapabilityPage()) return done;
  items.forEach((item) => {
    if (!item || typeof item.content !== "string" || !item.content.trim()) return;
    const cat = scriptCategory(item);
    if (cat !== "necessary" && !allowed[cat]) return;
    const placement = normalizePlacement(item.placement);
    const key = `${placement}:${item.id ?? hashScript(`${placement}
${item.content}`)}`;
    const marks = window.__tusConsentScripts ?? (window.__tusConsentScripts = /* @__PURE__ */ new Set());
    if (marks.has(key)) return;
    marks.add(key);
    const host = placement === "head" ? document.head : document.body;
    if (!host) return;
    const tpl = document.createElement("template");
    tpl.innerHTML = item.content;
    const nodes = Array.from(tpl.content.childNodes).map((node) => {
      if (node.nodeName !== "SCRIPT") return node;
      const old = node;
      const fresh = document.createElement("script");
      for (const a of Array.from(old.attributes)) fresh.setAttribute(a.name, a.value);
      fresh.text = old.text;
      return fresh;
    });
    if (placement === "bodyStart") {
      for (const n of nodes.reverse()) host.insertBefore(n, host.firstChild);
    } else {
      for (const n of nodes) host.appendChild(n);
    }
    done.push(item);
    markLoaded();
  });
  return done;
}

// src/consent/index.tsx
var CONSENT_CHANGE_EVENT = "tus-cookie-consent-change";
var OFF = { analytics: false, marketing: false };
var INERT = {
  ready: false,
  active: false,
  mode: "ask",
  categories: [],
  choices: OFF,
  bannerOpen: false,
  settingsOpen: false,
  privacyPath: null,
  gpc: false,
  country: null,
  isUS: false,
  acceptAll: () => {
  },
  declineAll: () => {
  },
  save: () => {
  },
  openSettings: () => {
  },
  closeSettings: () => {
  }
};
var ConsentContext = createContext(null);
function useConsent() {
  return useContext(ConsentContext) ?? INERT;
}
function useCookieSettingsLink() {
  const c = useConsent();
  return { visible: c.active && c.ready, open: c.openSettings, isUS: c.isUS };
}
var warnedNoticeWords = false;
function CookieConsentProvider(props) {
  const { children, storageKey, legacyAcceptedMeans, config, dashboardUrl, hasNoticeWords } = props;
  const [embedded, setEmbedded] = useState(true);
  const [stored, setStored] = useState(null);
  const [geo, setGeo] = useState({ done: false, country: null });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [gpc, setGpc] = useState(false);
  const legacyKey = legacyAcceptedMeans.join(",");
  const used = useMemo(() => inUse(config), [config]);
  const mode = geo.done ? resolveMode(geo.country, config) : "ask";
  const noticeWords = typeof hasNoticeWords === "function" ? hasNoticeWords() : hasNoticeWords === true;
  const noticeRefused = geo.done && mode === "notice" && !noticeWords;
  const active = !embedded && used.length > 0 && !noticeRefused;
  const ready = !embedded && geo.done;
  useEffect(() => {
    if (noticeRefused && used.length > 0 && !warnedNoticeWords) {
      warnedNoticeWords = true;
      console.error(
        '[@upgradeshop/cart/consent] mode is "notice" but the site supplied no notice words (hasNoticeWords): the banner is refused and nothing is loaded.'
      );
    }
  }, [noticeRefused, used.length]);
  useEffect(() => {
    if (isEmbeddedOrPreview()) return;
    setEmbedded(false);
    setGpc(gpcSignal());
    const legacy = legacyKey ? legacyKey.split(",") : [];
    setStored(readStored(storageKey, legacy));
    let cancelled = false;
    void fetchCountry(dashboardUrl, storageKey).then((country) => {
      if (!cancelled) setGeo({ done: true, country });
    });
    const resync = () => setStored(readStored(storageKey, legacy));
    window.addEventListener("storage", resync);
    window.addEventListener(CONSENT_CHANGE_EVENT, resync);
    return () => {
      cancelled = true;
      window.removeEventListener("storage", resync);
      window.removeEventListener(CONSENT_CHANGE_EVENT, resync);
    };
  }, [storageKey, legacyKey, dashboardUrl]);
  const choices = useMemo(
    () => active && ready && !gpc ? effectiveChoices(stored, mode, used) : OFF,
    [active, ready, gpc, stored, mode, used]
  );
  const bannerOpen = active && ready && !gpc && bannerNeeded(stored, mode, used);
  const live = useRef({ marketing: false, declined: false });
  live.current = { marketing: choices.marketing, declined: gpc || explicitlyDeclined(stored, "marketing") };
  useEffect(() => {
    configureTracking({ hasConsent: () => live.current.marketing, hasDeclined: () => live.current.declined });
  }, []);
  useEffect(() => {
    if (!active || !ready) return;
    if (gpc) return;
    if (choices.analytics) loadGoogleAnalytics(config.googleAnalyticsId);
    if (choices.marketing) loadMetaPixel(config.metaPixelId);
  }, [active, ready, gpc, choices.analytics, choices.marketing, config.googleAnalyticsId, config.metaPixelId]);
  const address = useAddress();
  const lastAddress = useRef(address);
  useEffect(() => {
    if (lastAddress.current === address) return;
    lastAddress.current = address;
    if (!active || !ready || isEmbeddedOrPreview()) return;
    if (onCapabilityPage()) {
      if (consentToolsLoaded()) pageActions.reload();
      return;
    }
    sendGaPageView();
    sendMetaPageView();
  }, [address, active, ready]);
  useEffect(() => {
    if (!active || !ready) return;
    for (const c of used) if (explicitlyDeclined(stored, c) && !choices[c]) clearCategoryCookies(c);
  }, [active, ready, stored, choices, used]);
  useEffect(() => {
    if (!active || !ready || !gpc) return;
    for (const c of used) clearCategoryCookies(c);
  }, [active, ready, gpc, used]);
  const choicesRef = useRef(choices);
  choicesRef.current = choices;
  const storedRef = useRef(stored);
  storedRef.current = stored;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const save = useCallback(
    (partial) => {
      const prev = choicesRef.current;
      const base = storedRef.current;
      const next = { ...base?.choices ?? OFF };
      for (const c of used) next[c] = gpc ? false : typeof partial[c] === "boolean" ? partial[c] : prev[c];
      const asked = CATEGORIES.filter((c) => used.includes(c) || (base?.asked ?? []).includes(c));
      const value2 = { mode: modeRef.current, asked, choices: next, at: Date.now() };
      writeStored(storageKey, value2);
      setStored(value2);
      setSettingsOpen(false);
      let withdrawn = false;
      for (const c of CATEGORIES) {
        if (prev[c] && !next[c]) {
          clearCategoryCookies(c);
          withdrawn = true;
        }
      }
      window.dispatchEvent(new Event(CONSENT_CHANGE_EVENT));
      if (withdrawn) pageActions.reload();
    },
    [storageKey, used, gpc]
  );
  const acceptAll = useCallback(() => save({ analytics: true, marketing: true }), [save]);
  const declineAll = useCallback(() => save({ analytics: false, marketing: false }), [save]);
  const openSettings = useCallback(() => setSettingsOpen(true), []);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);
  const value = useMemo(
    () => ({
      ready,
      active,
      mode,
      categories: used,
      choices,
      bannerOpen,
      settingsOpen: active && settingsOpen,
      privacyPath: config.privacyPath ?? null,
      gpc,
      country: geo.done ? geo.country : null,
      isUS: geo.done && isUSCountry(geo.country),
      acceptAll,
      declineAll,
      save,
      openSettings,
      closeSettings
    }),
    [ready, active, mode, used, choices, bannerOpen, settingsOpen, config.privacyPath, gpc, geo, acceptAll, declineAll, save, openSettings, closeSettings]
  );
  return createElement(ConsentContext.Provider, { value }, children);
}
function useConsentScripts(items) {
  const { active, ready, choices } = useConsent();
  const address = useAddress();
  useEffect(() => {
    if (isEmbeddedOrPreview()) return;
    injectConsentScripts(items, active && ready ? choices : OFF);
  }, [items, active, ready, choices, address]);
}
function useAddress() {
  const read = () => typeof window === "undefined" ? "" : window.location.pathname + window.location.search;
  const [address, setAddress] = useState(read);
  useEffect(() => {
    const w = window;
    if (!w.__tusConsentHistoryPatched) {
      w.__tusConsentHistoryPatched = true;
      for (const name of ["pushState", "replaceState"]) {
        const original = window.history[name];
        window.history[name] = function(...args) {
          if (consentToolsLoaded() && isCapabilityUrl(args[2])) {
            pageActions.assign(new URL(String(args[2]), window.location.href).href);
            return;
          }
          const result = original.apply(this, args);
          window.dispatchEvent(new Event("tus-consent-navigate"));
          return result;
        };
      }
    }
    const update = () => setAddress(read());
    window.addEventListener("popstate", update);
    window.addEventListener("tus-consent-navigate", update);
    update();
    return () => {
      window.removeEventListener("popstate", update);
      window.removeEventListener("tus-consent-navigate", update);
    };
  }, []);
  return address;
}
export {
  CATEGORIES,
  CONSENT_CHANGE_EVENT,
  CookieConsentProvider,
  GEO_TIMEOUT_MS,
  bannerNeeded,
  clearCategoryCookies,
  consentToolsLoaded,
  cookieDomainCandidates,
  effectiveChoices,
  explicitlyDeclined,
  fetchCountry,
  gpcSignal,
  inUse,
  injectConsentScripts,
  isEmbeddedOrPreview,
  isUSCountry,
  loadGoogleAnalytics,
  loadMetaPixel,
  pageActions,
  readStored,
  regionGroupOf,
  resolveMode,
  scriptCategory,
  sendGaPageView,
  sendMetaPageView,
  useConsent,
  useConsentScripts,
  useCookieSettingsLink,
  writeStored
};
