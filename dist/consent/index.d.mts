import * as react from 'react';
import { ReactNode } from 'react';

type ConsentCategory = 'analytics' | 'marketing';
type ConsentMode = 'ask' | 'notice';
type RegionGroup = 'europe' | 'israel' | 'rest';
type ConsentChoices = Record<ConsentCategory, boolean>;
/** Third-party embeds (Google Maps): ask first for visitors from Europe (default), or load right away everywhere. */
type EmbedsMode = 'europe_ask' | 'always_load';
declare const CATEGORIES: readonly ConsentCategory[];
interface ConsentConfig {
    /** The owner's mode per region group (server snapshot, dashboard website-config). */
    regions: Record<RegionGroup, ConsentMode>;
    privacyPath?: string | null;
    /** Categories that have at least one tool in use (GA, Meta Pixel, a site script). Empty = no banner at all. */
    categoriesInUse: ConsentCategory[];
    googleAnalyticsId?: string | null;
    metaPixelId?: string | null;
    /** Embeds setting from the snapshot. Absent (or any unknown value) = 'europe_ask'. */
    embeds?: EmbedsMode;
}
interface StoredConsent {
    mode: ConsentMode;
    /** Categories the visitor was shown (and so answered, explicitly or by the notice OK). */
    asked: ConsentCategory[];
    choices: ConsentChoices;
    at: number;
}
/** Country code -> region group. Null / unknown / malformed -> null (the caller asks first). */
declare function regionGroupOf(country: string | null | undefined): RegionGroup | null;
/** The mode for a visitor: an unknown country is ALWAYS ask first, in code, not editable. */
declare function resolveMode(country: string | null | undefined, config: ConsentConfig): ConsentMode;
/** Type guard for the embeds setting. */
declare function isEmbedsMode(value: unknown): value is EmbedsMode;
/**
 * True when an embed must wait for the visitor's yes. `always_load` -> false. Otherwise (`europe_ask`, absent or an
 * unknown value) -> true for a European visitor AND for an unknown country (fail-safe), false for Israel and the rest.
 */
declare function embedAskFirst(embeds: EmbedsMode | null | undefined, country: string | null | undefined): boolean;
declare function inUse(config: ConsentConfig): ConsentCategory[];
/**
 * Reads the stored choice. Old string values migrate: "accepted" -> each category in `legacyAcceptedMeans` on, the
 * others off; "declined" -> all off; both count as asked for exactly the `legacyAcceptedMeans` categories (what the old
 * banner asked), stored mode ask. Unreadable / unknown -> null (never answered).
 */
declare function readStored(storageKey: string, legacyAcceptedMeans: ConsentCategory[]): StoredConsent | null;
declare function writeStored(storageKey: string, value: StoredConsent): void;
/**
 * What may run right now, per category (D5):
 * - never answered: ask -> off, notice -> on;
 * - answered for that category: the stored choice (an older explicit off stays off);
 * - a category in use that was not asked: ask -> off until answered, notice -> on;
 * - stored mode notice but the visitor is now in an ask region: off until they answer here (a notice OK was never
 *   an opt-in), so an explicit off stays off and a previous on is re-asked.
 */
declare function effectiveChoices(stored: StoredConsent | null, mode: ConsentMode, used: ConsentCategory[]): ChoicesState;
type ChoicesState = ConsentChoices;
/** True when the banner should show: nothing stored, an in-use category not in `asked`, or notice stored and ask now. */
declare function bannerNeeded(stored: StoredConsent | null, mode: ConsentMode, used: ConsentCategory[]): boolean;
/** True only for an explicit "off" the visitor chose for a category. */
declare function explicitlyDeclined(stored: StoredConsent | null, category: ConsentCategory): boolean;
/** True only when the browser sends Global Privacy Control (`navigator.globalPrivacyControl === true`). */
declare function gpcSignal(): boolean;
/** US visitor (resolved country `US`). Unknown / malformed country = not US. */
declare function isUSCountry(country: string | null | undefined): boolean;
/** `a.b.example.com` -> [`a.b.example.com`, `b.example.com`, `example.com`] (never a bare top-level label). */
declare function cookieDomainCandidates(host: string): string[];
/** Expires the category's cookies for the current host and every parent domain, path `/`. */
declare function clearCategoryCookies(category: ConsentCategory): void;
/** Page-level actions behind an object so a test can watch the reload and the hard navigation. */
declare const pageActions: {
    reload: () => void;
    /** A hard navigation (the page is replaced, nothing of the old document keeps running). */
    assign: (url: string) => void;
};
/** The page editor shows the site in an iframe and /preview is editor chrome, not a visit: nothing renders or loads. */
declare function isEmbeddedOrPreview(): boolean;
declare const GEO_TIMEOUT_MS = 1500;
/**
 * `GET <dashboardUrl>/api/public/visitor-geo` (plus `?ck_country=<CC>` when the page carries a valid override; then the
 * sessionStorage cache is neither read nor written) with a hard 1.5 s timeout; the answer is kept in sessionStorage for the
 * visit (one call per visit). Any failure, block or timeout -> null (ask first). Failures are not cached.
 */
declare function fetchCountry(dashboardUrl: string | undefined, storageKey: string): Promise<string | null>;

/** True once a pixel, GA or a site script was loaded in this page-life (only a full reload takes them away). */
declare function consentToolsLoaded(): boolean;
/** Meta Pixel: `autoConfig` off BEFORE init (no click hrefs / page metadata sent), then PageView. Returns true if started. */
declare function loadMetaPixel(pixelId: string | null | undefined): boolean;
/** One manual Meta PageView for the current address. No-op when the pixel is not ours or on a capability page. */
declare function sendMetaPageView(): boolean;
/** Google Analytics (gtag.js). Returns true if started. */
declare function loadGoogleAnalytics(gaId: string | null | undefined): boolean;
/** One manual GA page_view for the current address. No-op when GA is not running or on a capability page. */
declare function sendGaPageView(): boolean;
interface ConsentScriptItem {
    /** Stable id of the script (a hash of placement + content is used when absent). */
    id?: string | number;
    /** `head`, `body_start`/`bodyStart`, `body_end`/`bodyEnd` (any other value lands at the body end). */
    placement: 'head' | 'body_start' | 'bodyStart' | 'body_end' | 'bodyEnd' | string;
    content: string;
    /** necessary | analytics | marketing | null (null counts as marketing). */
    category?: 'necessary' | ConsentCategory | null;
}
declare function scriptCategory(item: ConsentScriptItem): 'necessary' | ConsentCategory;
/**
 * Injects the site scripts whose category is allowed (`necessary` always), and nothing at all on a capability page. `allowed` is the effective choice map.
 * Each item is injected once per page. Returns the items injected by this call.
 */
declare function injectConsentScripts(items: ConsentScriptItem[] | null | undefined, allowed: Record<ConsentCategory, boolean>): ConsentScriptItem[];

/** Fired on `window` after the choice changes in this tab (the `storage` event only reaches OTHER tabs). */
declare const CONSENT_CHANGE_EVENT = "tus-cookie-consent-change";
interface CookieConsentProviderProps {
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
interface ConsentState {
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
    /** The embeds setting from the snapshot (absent = 'europe_ask'). Read by `useEmbedConsent`. */
    embeds: EmbedsMode;
    acceptAll: () => void;
    declineAll: () => void;
    save: (choices: Partial<ConsentChoices>) => void;
    openSettings: () => void;
    closeSettings: () => void;
}
declare function useConsent(): ConsentState;
/** For a footer "Cookie settings" link: `visible` is false where the banner is off (nothing to reopen). No markup. */
declare function useCookieSettingsLink(): {
    visible: boolean;
    open: () => void;
    isUS: boolean;
};
/**
 * What a third-party embed (Google Maps) may do right now: 'load' (draw it), 'ask' (draw the face and wait for a click)
 * or 'pending' (same face; the visitor's country is not known yet). `editing` is the caller's own editing flag (the
 * template's `useIsEditing()`): true -> 'load'. The package never tests for a frame or /preview here. Outside a
 * CookieConsentProvider -> 'ask'. Server render, before mount, and a site framed by a foreign page (which never
 * resolves a country) stay 'pending'; once the country is resolved -> `embedAskFirst(embeds, country)`.
 */
declare function useEmbedConsent(editing: boolean): 'load' | 'ask' | 'pending';
declare function CookieConsentProvider(props: CookieConsentProviderProps): react.FunctionComponentElement<react.ProviderProps<ConsentState | null>>;
/**
 * Injects the public site scripts (`/api/public/scripts` items with `{ placement, content, category }`) whose
 * category is allowed; `necessary` always, a null category counts as marketing. Nothing in an iframe or on /preview.
 * Call it once, in a component under the provider.
 */
declare function useConsentScripts(items: ConsentScriptItem[] | null | undefined): void;

export { CATEGORIES, CONSENT_CHANGE_EVENT, type ConsentCategory, type ConsentChoices, type ConsentConfig, type ConsentMode, type ConsentScriptItem, type ConsentState, CookieConsentProvider, type CookieConsentProviderProps, type EmbedsMode, GEO_TIMEOUT_MS, type RegionGroup, type StoredConsent, bannerNeeded, clearCategoryCookies, consentToolsLoaded, cookieDomainCandidates, effectiveChoices, embedAskFirst, explicitlyDeclined, fetchCountry, gpcSignal, inUse, injectConsentScripts, isEmbeddedOrPreview, isEmbedsMode, isUSCountry, loadGoogleAnalytics, loadMetaPixel, pageActions, readStored, regionGroupOf, resolveMode, scriptCategory, sendGaPageView, sendMetaPageView, useConsent, useConsentScripts, useCookieSettingsLink, useEmbedConsent, writeStored };
