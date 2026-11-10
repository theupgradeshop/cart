'use client';
// Headless cookie consent (`@upgradeshop/cart/consent`, 'use client'; spec websites-cookie-consent DRAFT 2, D1-D8).
// Draws nothing: the site draws its own banner and settings panel from `useConsent()`. See README "Cookie consent:
// drawing your own banner".

import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { configureTracking } from '@upgradeshop/cart/tracking';
import {
  CATEGORIES,
  bannerNeeded,
  clearCategoryCookies,
  effectiveChoices,
  explicitlyDeclined,
  fetchCountry,
  gpcSignal,
  inUse,
  isUSCountry,
  isEmbeddedOrPreview,
  pageActions,
  readStored,
  resolveMode,
  writeStored,
  type ConsentCategory,
  type ConsentChoices,
  type ConsentConfig,
  type ConsentMode,
  type StoredConsent,
} from './logic';
import {
  injectConsentScripts,
  consentToolsLoaded,
  isCapabilityUrl,
  loadGoogleAnalytics,
  loadMetaPixel,
  onCapabilityPage,
  sendGaPageView,
  sendMetaPageView,
  type ConsentScriptItem,
} from './loaders';

export * from './logic';
export {
  injectConsentScripts,
  consentToolsLoaded,
  sendGaPageView,
  sendMetaPageView,
  loadGoogleAnalytics,
  loadMetaPixel,
  scriptCategory,
  type ConsentScriptItem,
} from './loaders';

/** Fired on `window` after the choice changes in this tab (the `storage` event only reaches OTHER tabs). */
export const CONSENT_CHANGE_EVENT = 'tus-cookie-consent-change';

export interface CookieConsentProviderProps {
  children?: ReactNode;
  /** REQUIRED: the site's localStorage key (keep the key its old banner used). */
  storageKey: string;
  /** REQUIRED: what the site's OLD banner asked; an old "accepted" turns exactly these on. */
  legacyAcceptedMeans: ConsentCategory[];
  /** The server snapshot (dashboard website-config `cookieConsent` + `googleAnalyticsId` / `metaPixelId`). */
  config: ConsentConfig;
  /** Origin of the dashboard for the region call. Absent = no call, the visitor is asked first. */
  dashboardUrl?: string;
  /**
   * True when the site ships its own Notice-banner words. A Notice banner without them is refused (spec D4): the
   * provider is then inactive (no banner, nothing loads) and logs ONE console.error. Absent = not supplied.
   */
  hasNoticeWords?: boolean | (() => boolean);
}

export interface ConsentState {
  /** The region answer (or its failure) is in; the banner may draw. */
  ready: boolean;
  /** Banner / settings link / loaders are on: a category is in use, not embedded or /preview, notice words present. */
  active: boolean;
  mode: ConsentMode;
  /** Categories that have a tool in use (one switch each in the settings panel). */
  categories: ConsentCategory[];
  /** What may run right now. */
  choices: ConsentChoices;
  bannerOpen: boolean;
  settingsOpen: boolean;
  /** Privacy page path from the snapshot. */
  privacyPath: string | null;
  /** The browser sent Global Privacy Control: Analytics and Marketing are off in every region, no banner asks, switches stay off. */
  gpc: boolean;
  /** The resolved visitor country (null = unknown / call failed). */
  country: string | null;
  /** The visitor is in the US (resolved country `US`): the settings control reads "Do not sell or share my info". */
  isUS: boolean;
  acceptAll: () => void;
  declineAll: () => void;
  save: (choices: Partial<ConsentChoices>) => void;
  openSettings: () => void;
  closeSettings: () => void;
}

const OFF: ConsentChoices = { analytics: false, marketing: false };
const INERT: ConsentState = {
  ready: false,
  active: false,
  mode: 'ask',
  categories: [],
  choices: OFF,
  bannerOpen: false,
  settingsOpen: false,
  privacyPath: null,
  gpc: false,
  country: null,
  isUS: false,
  acceptAll: () => {},
  declineAll: () => {},
  save: () => {},
  openSettings: () => {},
  closeSettings: () => {},
};

const ConsentContext = createContext<ConsentState | null>(null);

export function useConsent(): ConsentState {
  return useContext(ConsentContext) ?? INERT;
}

/** For a footer "Cookie settings" link: `visible` is false where the banner is off (nothing to reopen). No markup. */
export function useCookieSettingsLink(): { visible: boolean; open: () => void; isUS: boolean } {
  const c = useConsent();
  return { visible: c.active && c.ready, open: c.openSettings, isUS: c.isUS };
}

let warnedNoticeWords = false;

export function CookieConsentProvider(props: CookieConsentProviderProps) {
  const { children, storageKey, legacyAcceptedMeans, config, dashboardUrl, hasNoticeWords } = props;
  const [embedded, setEmbedded] = useState(true); // until mounted: nothing draws on the server
  const [stored, setStored] = useState<StoredConsent | null>(null);
  const [geo, setGeo] = useState<{ done: boolean; country: string | null }>({ done: false, country: null });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [gpc, setGpc] = useState(false);
  const legacyKey = legacyAcceptedMeans.join(',');

  const used = useMemo(() => inUse(config), [config]);
  const mode: ConsentMode = geo.done ? resolveMode(geo.country, config) : 'ask';
  const noticeWords = typeof hasNoticeWords === 'function' ? hasNoticeWords() : hasNoticeWords === true;
  const noticeRefused = geo.done && mode === 'notice' && !noticeWords;
  const active = !embedded && used.length > 0 && !noticeRefused;
  const ready = !embedded && geo.done;

  useEffect(() => {
    if (noticeRefused && used.length > 0 && !warnedNoticeWords) {
      warnedNoticeWords = true;
      console.error(
        '[@upgradeshop/cart/consent] mode is "notice" but the site supplied no notice words (hasNoticeWords): the banner is refused and nothing is loaded.',
      );
    }
  }, [noticeRefused, used.length]);

  // mount: embedded check, stored choice, region
  useEffect(() => {
    if (isEmbeddedOrPreview()) return;
    setEmbedded(false);
    setGpc(gpcSignal());
    const legacy = legacyKey ? (legacyKey.split(',') as ConsentCategory[]) : [];
    setStored(readStored(storageKey, legacy));
    let cancelled = false;
    void fetchCountry(dashboardUrl, storageKey).then((country) => {
      if (!cancelled) setGeo({ done: true, country });
    });
    const resync = () => setStored(readStored(storageKey, legacy));
    window.addEventListener('storage', resync);
    window.addEventListener(CONSENT_CHANGE_EVENT, resync);
    return () => {
      cancelled = true;
      window.removeEventListener('storage', resync);
      window.removeEventListener(CONSENT_CHANGE_EVENT, resync);
    };
  }, [storageKey, legacyKey, dashboardUrl]);

  const choices = useMemo(
    () => (active && ready && !gpc ? effectiveChoices(stored, mode, used) : OFF),
    [active, ready, gpc, stored, mode, used],
  );
  // GPC leaves only Necessary, so nothing is left to ask for
  const bannerOpen = active && ready && !gpc && bannerNeeded(stored, mode, used);

  // refs read by the cart's tracking module (Purchase / Lead fire only with MARKETING on)
  const live = useRef({ marketing: false, declined: false });
  live.current = { marketing: choices.marketing, declined: gpc || explicitlyDeclined(stored, 'marketing') };
  useEffect(() => {
    configureTracking({ hasConsent: () => live.current.marketing, hasDeclined: () => live.current.declined });
  }, []);

  // loaders: only when the category is allowed
  useEffect(() => {
    if (!active || !ready) return;
    if (gpc) return;
    if (choices.analytics) loadGoogleAnalytics(config.googleAnalyticsId);
    if (choices.marketing) loadMetaPixel(config.metaPixelId);
  }, [active, ready, gpc, choices.analytics, choices.marketing, config.googleAnalyticsId, config.metaPixelId]);

  // route changes: manual GA page_view + Meta PageView off capability pages. A soft navigation onto a capability page is
  // stopped earlier (the history patch below hard-navigates BEFORE the address changes); only a back/forward (popstate)
  // gets here, and it can't be cancelled, so it reloads.
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

  // a category the visitor explicitly turned off never keeps its cookies, even ones written just before a reload
  useEffect(() => {
    if (!active || !ready) return;
    for (const c of used) if (explicitlyDeclined(stored, c) && !choices[c]) clearCategoryCookies(c);
  }, [active, ready, stored, choices, used]);

  // GPC: whatever was stored, the cookies of both categories go once (no reload: nothing was started in this page)
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
    (partial: Partial<ConsentChoices>) => {
      const prev = choicesRef.current;
      const base = storedRef.current;
      const next: ConsentChoices = { ...(base?.choices ?? OFF) };
      for (const c of used) next[c] = gpc ? false : typeof partial[c] === 'boolean' ? (partial[c] as boolean) : prev[c];
      const asked = CATEGORIES.filter((c) => used.includes(c) || (base?.asked ?? []).includes(c));
      const value: StoredConsent = { mode: modeRef.current, asked, choices: next, at: Date.now() };
      writeStored(storageKey, value);
      setStored(value);
      setSettingsOpen(false);
      let withdrawn = false;
      for (const c of CATEGORIES) {
        if (prev[c] && !next[c]) {
          clearCategoryCookies(c);
          withdrawn = true;
        }
      }
      window.dispatchEvent(new Event(CONSENT_CHANGE_EVENT));
      // a tool already running in this page only stops on a reload
      if (withdrawn) pageActions.reload();
    },
    [storageKey, used, gpc],
  );

  const acceptAll = useCallback(() => save({ analytics: true, marketing: true }), [save]);
  const declineAll = useCallback(() => save({ analytics: false, marketing: false }), [save]);
  const openSettings = useCallback(() => setSettingsOpen(true), []);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);

  const value = useMemo<ConsentState>(
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
      closeSettings,
    }),
    [ready, active, mode, used, choices, bannerOpen, settingsOpen, config.privacyPath, gpc, geo, acceptAll, declineAll, save, openSettings, closeSettings],
  );

  return createElement(ConsentContext.Provider, { value }, children);
}

/**
 * Injects the public site scripts (`/api/public/scripts` items with `{ placement, content, category }`) whose
 * category is allowed; `necessary` always, a null category counts as marketing. Nothing in an iframe or on /preview.
 * Call it once, in a component under the provider.
 */
export function useConsentScripts(items: ConsentScriptItem[] | null | undefined): void {
  const { active, ready, choices } = useConsent();
  const address = useAddress();
  useEffect(() => {
    if (isEmbeddedOrPreview()) return;
    injectConsentScripts(items, active && ready ? choices : OFF);
  }, [items, active, ready, choices, address]);
}

/** The current path + query, re-read on back/forward and on client-side navigation (history.pushState / replaceState). */
function useAddress(): string {
  const read = () => (typeof window === 'undefined' ? '' : window.location.pathname + window.location.search);
  const [address, setAddress] = useState(read);
  useEffect(() => {
    const w = window as unknown as { __tusConsentHistoryPatched?: boolean };
    if (!w.__tusConsentHistoryPatched) {
      w.__tusConsentHistoryPatched = true;
      for (const name of ['pushState', 'replaceState'] as const) {
        const original = window.history[name];
        window.history[name] = function (this: History, ...args: Parameters<History['pushState']>) {
          // a capability target while a tool or site script is live: leave through a hard navigation BEFORE the history
          // change, so no tool (pixel, GA, site script) ever sees the address. Nothing loaded = nothing to leak.
          if (consentToolsLoaded() && isCapabilityUrl(args[2])) {
            pageActions.assign(new URL(String(args[2]), window.location.href).href);
            return;
          }
          const result = original.apply(this, args);
          window.dispatchEvent(new Event('tus-consent-navigate'));
          return result;
        };
      }
    }
    const update = () => setAddress(read());
    window.addEventListener('popstate', update);
    window.addEventListener('tus-consent-navigate', update);
    update();
    return () => {
      window.removeEventListener('popstate', update);
      window.removeEventListener('tus-consent-navigate', update);
    };
  }, []);
  return address;
}
