import * as react_jsx_runtime from 'react/jsx-runtime';
import { ReactNode } from 'react';

/**
 * A cart line's bundle composition. Optional and additive — absent on every line an
 * account that never touches bundles ever creates, and on every line stored before this
 * field existed (see migrate-storage.ts).
 *
 * `includedItems` carries a quantity per item rather than bare membership: a bundle item's
 * quantity in `product_bundle_items` can be greater than one, so `includedItemSlugs: string[]`
 * cannot represent it.
 */
interface CartItemComposition {
    bundleSlug: string;
    includedItems: Array<{
        slug: string;
        quantity: number;
    }>;
}
/** Stored in localStorage — identity only, no price snapshot */
interface CartItem {
    slug: string;
    quantity: number;
    variantId?: string;
    composition?: CartItemComposition;
}
interface ProductVariant {
    id: string;
    title: string;
    price: number | null;
    salePrice: number | null;
    sku: string;
    stockQuantity: number;
    imageUrl: string;
}
/** Live product data merged with cart quantity — derived from API, never localStorage */
interface CartProduct {
    slug: string;
    name: string;
    price: number;
    salePrice: number | null;
    images: {
        url: string;
        alt: string;
    }[];
    status: 'active' | 'unavailable';
    variants?: ProductVariant[];
    quantity: number;
    variantId?: string;
}
/**
 * The cart's single composed-course-bundle line (courses-bundles storefront spec, U3).
 * At most ONE of these exists in a cart at a time -- setting a new one replaces the
 * previous, matching checkout's own contract, which accepts one `composedBundle`
 * (`{ courseIds }`) per order. Kept OUT of the `items` array on purpose: `items` holds
 * only ordinary product lines (`{ slug, quantity, ... }`), and every existing consumer of
 * `items` (use-cart-products, use-cart-prerequisites, use-cart-suggestions, the reducer's
 * slug/variantId keying) assumes exactly that shape -- folding a differently-shaped line
 * into the same array would silently break each of them for a slug-less entry. This is
 * "a sibling type", per the spec's own phrasing, not an extension of `CartItem`.
 */
interface ComposedCourseBundleCartItem {
    kind: 'composed-course-bundle';
    ruleId: string;
    courseIds: string[];
    title: string;
}
interface CartContextValue {
    items: CartItem[];
    composedBundle: ComposedCourseBundleCartItem | null;
    isOpen: boolean;
    itemCount: number;
    addItem: (slug: string, quantity?: number, variantId?: string) => void;
    removeItem: (slug: string, variantId?: string) => void;
    updateQuantity: (slug: string, quantity: number, variantId?: string) => void;
    clearCart: () => void;
    /** Replaces any existing composed-bundle line -- a cart holds at most one. */
    setComposedBundle: (bundle: ComposedCourseBundleCartItem) => void;
    clearComposedBundle: () => void;
    openCart: () => void;
    closeCart: () => void;
    toggleCart: () => void;
}
interface CartSuggestionProduct {
    id: string;
    slug: string;
    name: string;
    price: number;
    salePrice: number | null;
    image: string | null;
}
type CartSuggestionType = 'bundle_upgrade' | 'upsell' | 'cross_sell' | 'fallback';
interface CartSuggestion {
    type: CartSuggestionType;
    product: CartSuggestionProduct;
    sourceProductSlug?: string;
    bundleItemSlugs?: string[];
    savingsAmount?: number;
    savingsPercent?: number;
}
interface CartSuggestionsResponse {
    style: string;
    suggestions: CartSuggestion[];
}

interface CartProviderProps {
    children: ReactNode;
    storageKey: string;
    /**
     * Dashboard API base URL.
     * Defaults to 'https://app.upgradeshop.ai'.
     * Pass process.env.NEXT_PUBLIC_PLATFORM_URL so staging hits staging API.
     */
    apiBaseUrl?: string;
}
declare function CartProvider({ children, storageKey, apiBaseUrl, }: CartProviderProps): react_jsx_runtime.JSX.Element;
declare function useCart(): CartContextValue;

declare function useCartProducts(domain: string): {
    products: CartProduct[];
    isLoading: boolean;
    error: Error | null;
};

declare function useCartSuggestions(domain: string): {
    suggestions: CartSuggestion[];
    suggestionsStyle: string;
    isLoading: boolean;
    error: Error | null;
    applySuggestion: (s: CartSuggestion) => void;
};

interface PrerequisiteProduct {
    id: string;
    name: string;
    slug: string;
    price: number;
    images: unknown;
}
interface MissingPrerequisite {
    product: PrerequisiteProduct;
    prerequisite: PrerequisiteProduct;
}
declare function useCartPrerequisites(domain: string, buyerEmail?: string): {
    missing: MissingPrerequisite[];
    autoAdded: MissingPrerequisite[];
    dependencies: MissingPrerequisite[];
    dependentsOf: (slug: string) => PrerequisiteProduct[];
    isLoading: boolean;
    error: Error | null;
};

/** Shape of a successful `POST /api/public/store/bundle-rules/price` response. */
interface CartBundlePriceResult {
    totalMinor: number;
    discountMinor: number;
    appliedRuleId: string | null;
    appliedRuleName: string | null;
    basis: unknown;
    suppressionReason: string | null;
}
type CartBundlePriceEntry = {
    status: 'not-composed';
} | {
    status: 'unpriceable';
    reason: string;
} | {
    status: 'not-loaded';
} | {
    status: 'priced';
    result: CartBundlePriceResult;
};
/**
 * Fetches a server-computed price for every cart line carrying a `composition` (an edited
 * bundle line — see `CartItemComposition` in `src/types.ts`), from
 * `POST /api/public/store/bundle-rules/price`.
 *
 * A cart with no composed line issues NO request at all — this is deliberate, not an
 * optimization: an account that never touches bundles must not acquire a network call on
 * every cart render. Read-only: never calls `addItem` or `removeItem`.
 *
 * `priceFor(slug, variantId?)` looks up a line's price by its cart identity (the same
 * `slug`+`variantId` key `cart-reducer.ts` uses):
 * - `{ status: 'not-composed' }` — the line has no `composition`, or doesn't exist.
 * - `{ status: 'unpriceable', reason }` — the composition has an included item with
 *   `quantity > 1`; see the evaluator limitation above. No request was made for it.
 * - `{ status: 'not-loaded' }` — priceable, but the request hasn't resolved yet (or the
 *   last attempt failed — fail-open, so a failure looks the same as "still pending" and never
 *   renders a stale or partial figure).
 * - `{ status: 'priced', result }` — a server-computed price is available.
 */
declare function useCartBundlePrice(domain: string): {
    priceFor: (slug: string, variantId?: string) => CartBundlePriceEntry;
    isLoading: boolean;
    error: Error | null;
};

/**
 * Turns the cart's composed-course-bundle line (if any) into the checkout body fragment
 * the dashboard's checkout route expects — `{ composedBundle: { courseIds } }`. Returns
 * `undefined` when there is no such line, so a caller can spread the result straight into
 * its checkout request body (`{ ...otherFields, ...toComposedBundleCheckoutFragment(bundle) }`)
 * without an `if` at the call site.
 */
declare function toComposedBundleCheckoutFragment(composedBundle: ComposedCourseBundleCartItem | null | undefined): {
    composedBundle: {
        courseIds: string[];
    };
} | undefined;

/**
 * Pure, framework-free bundle pricing engine for course bundles (D3,
 * `2026-09-27-course-bundles-storefront-and-pe-block.md`, Unit U3).
 *
 * Mirrors the dashboard's server pricing EXACTLY:
 *  - `src/lib/store/bundle-rule-evaluator.ts` (`evaluateBundleRules`) — rule
 *    selection, per-scheme math, rounding, ties.
 *  - `src/lib/courses/bundle-discount-guard.ts` (`guardNonPositiveDiscount`)
 *    — suppression of a non-positive discount or a negative total to full
 *    price, applied ONLY to the winning candidate, never per-rule.
 *  - D1 (2026-09-27): `fixed_price_per_tier` is EXACT-COUNT — a tier applies
 *    only when the selection size equals its `count` exactly. Any other
 *    size inside [min, max] is a "gap": no candidate from that rule.
 *
 * All money is in MINOR units throughout. No React, no fetch, no storage.
 *
 * The storefront UI-facing shape (`Quote`, `Nudge`, `FixedQuote`) follows
 * the generic design reference's pricing functions
 * (`design_handoff_bundle_builder/BundleBuilder.jsx`: `BB_quoteOne`,
 * `BB_quote`, `BB_next`, `BB_fixedQuote`) field-for-field, ported directly
 * per that README ("Port this logic directly — it encodes confirmed
 * pricing rules"). One deliberate refinement over the prototype: the
 * prototype applies its "pay >= full -> show full price" fallback PER
 * OFFER, before comparing against alternates; this engine instead computes
 * the RAW candidate (allowing a non-positive discount or a negative total)
 * for the primary offer and every eligible alternate, picks the cheapest
 * raw total (ties -> lowest id, matching the evaluator's own tie rule),
 * and applies the guard's suppression ONCE, to that single winner — the
 * same order of operations as the real server. In every case the fixture
 * can construct with a positive, sane discount the two produce an
 * identical externally-visible result (a non-positive-discount rule's raw
 * total is never lower than full price, so it can never spuriously win
 * over a real alternate); they diverge only for a misconfigured rule whose
 * percentOff exceeds 100 and drives the total negative, which is exactly
 * the case the guard exists to catch, so following the guard's real
 * predicate rather than the prototype's incidental shortcut is the
 * correct — and D3-mandated — choice.
 *
 * The primary offer anchors the block: like the prototype, when the
 * PRIMARY offer's own candidate is invalid (below min, above max, not
 * eligible, or — fixed_price_per_tier only — a "gap") alternates are never
 * consulted at all, even if one of them would price the same selection.
 * This is the storefront UX decision the design reference encodes (the
 * block is about completing THIS bundle), not a server pricing rule.
 */
interface CountTier {
    count: number;
    percentOff: number;
}
interface FixedPriceTier {
    count: number;
    fixedPriceMinor: number;
}
interface RuleOfferBase {
    kind: 'rule';
    id: string;
    name: string;
    title: string;
    description: string | null;
    eligible: string[];
    min: number;
    max: number;
}
type RuleOffer = (RuleOfferBase & {
    scheme: 'tiered_by_count';
    tiers: CountTier[];
}) | (RuleOfferBase & {
    scheme: 'flat_percentage';
    percentOff: number;
}) | (RuleOfferBase & {
    scheme: 'fixed_price_per_tier';
    tiers: FixedPriceTier[];
}) | (RuleOfferBase & {
    scheme: 'per_course_contribution';
    coursePricesMinor: Record<string, number | null | undefined>;
});
interface FixedOffer {
    kind: 'fixed';
    id: string;
    name: string;
    title: string;
    description: string | null;
    ids: string[];
    priceMinor: number;
    productSlug: string;
}
type BundleOffer = RuleOffer | FixedOffer;
interface CourseDetail {
    id: string;
    title: string;
    slug: string;
    imageUrl: string | null;
    listPriceMinor: number;
    productSlug: string | null;
}
type CoursesById = Record<string, CourseDetail>;
interface MatchedTierBasis {
    scheme: 'tiered_by_count' | 'fixed_price_per_tier';
    tier: CountTier | FixedPriceTier | null;
}
interface FlatPercentageBasis {
    scheme: 'flat_percentage';
    percentOff: number;
}
interface PerItemBasis {
    scheme: 'per_course_contribution';
    perItemMinor: Record<string, number>;
}
type EvaluationBasis = MatchedTierBasis | FlatPercentageBasis | PerItemBasis;
interface Gap {
    lo: FixedPriceTier | null;
    hi: FixedPriceTier | null;
}
interface Quote {
    count: number;
    own: string[];
    picked: string[];
    fullMinor: number;
    payMinor: number;
    offMinor: number;
    pct: number;
    valid: boolean;
    short: number;
    atMax: boolean;
    noSaving: boolean;
    basis: EvaluationBasis | null;
    /** Set only when a rule other than the primary offer produced the winning price. */
    wonOfferId: string | null;
    /** Set only for `fixed_price_per_tier` when the size is in range but matches no exact tier. */
    gap: Gap | null;
}
/**
 * Quote for exactly one offer against a selection — mirrors `BB_quoteOne`.
 * Used both standalone (to detect a `fixed_price_per_tier` gap on the
 * primary offer) and as the anchor for `quote()`'s cross-offer comparison.
 */
declare function quoteOne(offer: RuleOffer, sel: string[], owned: string[], coursesById: CoursesById): Quote;
/**
 * Quote for the primary offer, then checks `alts` and swaps in whichever
 * live rule (primary or alt) prices the same selection cheapest — mirrors
 * `BB_quote`. When the primary offer's own quote is invalid (below min,
 * above max, or a fixed-scheme gap) alternates are never consulted.
 */
declare function quote(offer: RuleOffer, alts: RuleOffer[], sel: string[], owned: string[], coursesById: CoursesById): Quote;
type Nudge = {
    kind: 'tier';
    add: number;
    to: number;
    n: number;
    mMinor: number | null;
} | {
    kind: 'set';
    add: number;
    n: number;
    priceMinor: number;
};
declare function next(offer: RuleOffer, alts: RuleOffer[], q: Quote, sel: string[], owned: string[], coursesById: CoursesById): Nudge | null;
interface FixedQuote {
    fixed: true;
    count: number;
    picked: string[];
    fullMinor: number;
    payMinor: number;
    offMinor: number;
    pct: number;
    valid: true;
    noSaving: boolean;
}
declare function fixedQuote(offer: FixedOffer, coursesById: CoursesById): FixedQuote;

type BundleOfferStatus = 'live' | 'draft' | 'gone';
/**
 * The site route's response shape (contract:
 * `2026-09-27-course-bundles-storefront-and-pe-block.md` "Camoflash server
 * route"): the U2 dashboard read, PLUS `owned` — course ids the logged-in
 * shopper already owns, added server-side from the session's `contactId`,
 * never client-supplied.
 */
interface BundleOfferResponse {
    status: BundleOfferStatus;
    currency: string;
    offer: BundleOffer | null;
    courses: CourseDetail[];
    alts: RuleOffer[];
    owned: string[];
}
interface UseBundleOfferResult {
    status: 'loading' | 'error' | 'live' | 'draft' | 'gone';
    currency: string | null;
    offer: BundleOffer | null;
    courses: CoursesById;
    alts: RuleOffer[];
    owned: string[];
    sel: string[];
    setSel: (next: string[]) => void;
    toggle: (id: string) => void;
    /** Non-null only for a `rule` offer (a `fixed` offer has no picking — see `fixedQuote`). */
    quote: Quote | null;
    next: Nudge | null;
    loading: boolean;
    error: Error | null;
}
/**
 * Fetches a single bundle offer from the site's own route (`url`, e.g.
 * `/api/bundles/rule/<id>` or `/api/bundles/fixed/<id>`) and holds the
 * shopper's current selection (`sel`), resetting it whenever `url` changes
 * (a different bundle starts from an empty selection, never carries over
 * the previous bundle's picks).
 *
 * No UI. `setSel`/`toggle` respect `owned` (never toggle-able) and the
 * offer's `max` (a full selection ignores further adds, same guard the
 * storefront design encodes — `BundleBuilder.jsx`'s `toggle`).
 */
declare function useBundleOffer(url: string): UseBundleOfferResult;

export { type FixedQuote as BundleFixedQuote, type Nudge as BundleNudge, type BundleOffer, type BundleOfferResponse, type BundleOfferStatus, type Quote as BundleQuote, type CartBundlePriceEntry, type CartBundlePriceResult, type CartContextValue, type CartItem, type CartItemComposition, type CartProduct, CartProvider, type CartSuggestion, type CartSuggestionProduct, type CartSuggestionType, type CartSuggestionsResponse, type ComposedCourseBundleCartItem, type CountTier, type CourseDetail, type CoursesById, type EvaluationBasis, type FixedOffer, type FixedPriceTier, type FlatPercentageBasis, type Gap, type MatchedTierBasis, type MissingPrerequisite, type PerItemBasis, type PrerequisiteProduct, type ProductVariant, type RuleOffer, type UseBundleOfferResult, fixedQuote, next, quote, quoteOne, toComposedBundleCheckoutFragment, useBundleOffer, useCart, useCartBundlePrice, useCartPrerequisites, useCartProducts, useCartSuggestions };
