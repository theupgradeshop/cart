interface TrackingConfig {
    /** The site's own cookie-consent check (e.g. its hasAnalyticsConsent). */
    hasConsent: () => boolean;
}
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
declare function trackPurchase(order: TrackableOrder): Promise<boolean>;
declare function trackLead(submissionId: string | null | undefined): Promise<boolean>;
declare function trackCompleteRegistration(key: string, memberId?: string | null): Promise<boolean>;

export { type TrackableOrder, type TrackingConfig, configureTracking, trackCompleteRegistration, trackLead, trackPurchase };
