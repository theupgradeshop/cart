import { NextRequest } from 'next/server.js';

type SiteGateView = 'visitor' | 'team' | 'preview';
type SiteGateVariant = 'centered' | 'split' | 'banner';

interface SiteGateOptions {
    /** The site's public host, as registered in the dashboard (e.g. `camoflash.co.il`). */
    domain: string;
    /** Dashboard base URL (e.g. `https://app.upgradeshop.ai`). */
    platformUrl: string;
    /** The site's own extra skip (its thank-you route). Build it with `thankYouSkip`. */
    extraSkip?: (pathname: string) => boolean;
    /** Test seam; defaults to the global fetch. */
    fetchImpl?: typeof fetch;
    /**
     * Extra request headers for the visitor rewrite (e.g. the site's `x-tus-language`, which its own language
     * handling would have set after the gate). Applied after the gate strips `x-tus-site-*` / `x-tus-uc-*`; it can
     * never override `x-tus-uc-variant` / `x-tus-uc-business-name`. A throw is ignored (no extra headers).
     */
    rewriteRequestHeaders?: (req: NextRequest) => Record<string, string>;
}
interface SiteGateAnswer {
    on: boolean;
    view: SiteGateView;
    variant: SiteGateVariant;
    businessName: string;
}
/** Paths the gate never touches. Segment-boundary matches only: `/api-docs` and `/preview-x` are gated. */
declare function isSiteGateSkipped(pathname: string): boolean;
/**
 * Build a site's `extraSkip` for its thank-you route(s). `path` is the site's own path (`/thank-you`,
 * `/checkout/thank-you`) or a list of them (add the `/checkout-thank-you` CMS slug where the site has it).
 * Matches at a segment boundary, with or without a trailing slash, optionally behind one language prefix
 * (codes taken from the site's enabled languages, regex-escaped). `<path>-x` does NOT match.
 */
declare function thankYouSkip(path: string | string[], enabledLanguages: string[]): (pathname: string) => boolean;
/** Test helper: forget every cache entry and refill the token bucket. */
declare function __resetSiteGateForTests(): void;
/** Test helper: how many entries each cache holds (the token LRU is bounded). */
declare function __siteGateCacheSizes(): {
    tokened: number;
    tokenless: number;
};
/** Copy of `headers` without any `x-tus-site-*` / `x-tus-uc-*` entry (for a site's own pass-through headers). */
declare function cleanGateRequestHeaders(headers: Headers): Headers;
declare function siteGate(req: NextRequest, opts: SiteGateOptions): Promise<Response | null>;

export { type SiteGateAnswer, type SiteGateOptions, type SiteGateVariant, type SiteGateView, __resetSiteGateForTests, __siteGateCacheSizes, cleanGateRequestHeaders, isSiteGateSkipped, siteGate, thankYouSkip };
