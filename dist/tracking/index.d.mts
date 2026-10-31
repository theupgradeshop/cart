interface TrackingConfig {
    /** The site's own cookie-consent check (e.g. its hasAnalyticsConsent). */
    hasConsent: () => boolean;
    /**
     * True when the visitor has explicitly declined cookies (not merely "not answered yet").
     * An event created while this is true is dropped at once and never queued; a waiting event is
     * dropped (and its stored copy removed) the moment this turns true, at any time before it is sent.
     */
    hasDeclined?: () => boolean;
}
/** What kind of form produced a Lead; sent as Meta's predefined `content_category`. */
type LeadFormKind = 'contact' | 'newsletter' | 'waitlist' | 'popup' | 'lesson' | 'product';
/** Minimal structural order: both OrderThin and a site's own order type satisfy it. */
interface TrackableOrder {
    orderId: string;
    financialStatus: string;
    total: number;
    currency?: string | null;
    paidAt?: string | null;
    items?: Array<{
        productId?: string | null;
        quantity?: number;
        price?: number;
    }> | null;
}
declare function configureTracking(next: TrackingConfig): void;
/**
 * Call in a consent accept handler that reloads the page, after the consent value is saved and just
 * before the reload. Stores the events still waiting for consent in sessionStorage (tab-scoped) so
 * the next page sends them. Writes nothing when consent is not given. Never throws.
 */
declare function persistPendingTracking(): void;
declare function trackPurchase(order: TrackableOrder): Promise<boolean>;
declare function trackLead(submissionId: string | null | undefined, formKind?: LeadFormKind): Promise<boolean>;
declare function trackCompleteRegistration(key: string, memberId?: string | null): Promise<boolean>;

export { type LeadFormKind, type TrackableOrder, type TrackingConfig, configureTracking, persistPendingTracking, trackCompleteRegistration, trackLead, trackPurchase };
