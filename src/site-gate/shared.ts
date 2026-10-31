// Constants shared by the server gate and the client bar/pill (no imports: safe in both bundles).

/** Cookie the site's /api/site-pass route sets (host-only). The gate only reads it. */
export const PASS_COOKIE = '__Host-tus_site_pass';
/** Cookie the gate sets after a valid ?tus_preview= (host-only, session). */
export const PREVIEW_COOKIE = '__Host-tus_site_preview';
/** Readable cookie ("team" | "preview") that drives only the bar/pill. */
export const VIEW_COOKIE = 'tus_site_view';
/** Query key of the owner's preview link. NEVER `preview` (that is the draft share link). */
export const PREVIEW_PARAM = 'tus_preview';
/** Query key that narrows a team member to the visitor view. */
export const VIEW_PARAM = 'tus_view';

export type SiteGateView = 'visitor' | 'team' | 'preview';
export type SiteGateVariant = 'centered' | 'split' | 'banner';
