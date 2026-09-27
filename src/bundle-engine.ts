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

// ---------------------------------------------------------------------------
// Offer / course shapes — mirror the U2 contract
// (`src/app/api/public/courses/bundles/[kind]/[id]/route.ts`) exactly.
// ---------------------------------------------------------------------------

export interface CountTier {
  count: number;
  percentOff: number;
}

export interface FixedPriceTier {
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

export type RuleOffer =
  | (RuleOfferBase & { scheme: 'tiered_by_count'; tiers: CountTier[] })
  | (RuleOfferBase & { scheme: 'flat_percentage'; percentOff: number })
  | (RuleOfferBase & { scheme: 'fixed_price_per_tier'; tiers: FixedPriceTier[] })
  | (RuleOfferBase & {
      scheme: 'per_course_contribution';
      coursePricesMinor: Record<string, number | null | undefined>;
    });

export interface FixedOffer {
  kind: 'fixed';
  id: string;
  name: string;
  title: string;
  description: string | null;
  ids: string[];
  priceMinor: number;
  productSlug: string;
}

export type BundleOffer = RuleOffer | FixedOffer;

export interface CourseDetail {
  id: string;
  title: string;
  slug: string;
  imageUrl: string | null;
  listPriceMinor: number;
  productSlug: string | null;
}

export type CoursesById = Record<string, CourseDetail>;

// ---------------------------------------------------------------------------
// Basis — mirrors `EvaluationBasis` in the dashboard evaluator, item-scoped.
// ---------------------------------------------------------------------------

export interface MatchedTierBasis {
  scheme: 'tiered_by_count' | 'fixed_price_per_tier';
  tier: CountTier | FixedPriceTier | null;
}

export interface FlatPercentageBasis {
  scheme: 'flat_percentage';
  percentOff: number;
}

export interface PerItemBasis {
  scheme: 'per_course_contribution';
  perItemMinor: Record<string, number>;
}

export type EvaluationBasis = MatchedTierBasis | FlatPercentageBasis | PerItemBasis;

// ---------------------------------------------------------------------------
// Quote — the storefront's per-selection result.
// ---------------------------------------------------------------------------

export interface Gap {
  lo: FixedPriceTier | null;
  hi: FixedPriceTier | null;
}

export interface Quote {
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

interface RawCandidate {
  ruleId: string;
  totalMinor: number;
  discountMinor: number;
  basis: EvaluationBasis;
}

function isEligible(offer: RuleOffer, id: string): boolean {
  return offer.eligible.includes(id);
}

/** Highest tier whose count <= size (tiered_by_count — "highest at or below"). */
function pickHighestTier<T extends { count: number }>(tiers: T[], size: number): T | null {
  let best: T | null = null;
  for (const tier of tiers) {
    if (tier.count <= size && (best === null || tier.count > best.count)) best = tier;
  }
  return best;
}

/** Tier whose count === size exactly (fixed_price_per_tier, D1: EXACT-COUNT). */
function pickExactTier<T extends { count: number }>(tiers: T[], size: number): T | null {
  return tiers.find(t => t.count === size) ?? null;
}

/**
 * Raw (unguarded) candidate for ONE offer against a fixed picked/owned set.
 * Returns null when the offer doesn't apply at all (out of range, not
 * eligible) or — fixed_price_per_tier only — when in range but no exact
 * tier matches (the caller surfaces that as `gap`, not as "no candidate").
 */
function rawCandidate(
  offer: RuleOffer,
  pickedIds: string[],
  ownIds: string[],
  coursesById: CoursesById
): RawCandidate | Gap | null {
  const size = pickedIds.length + ownIds.length;
  if (size < offer.min || size > offer.max) return null;
  if (![...pickedIds, ...ownIds].every(id => isEligible(offer, id))) return null;

  const fullMinor = pickedIds.reduce((sum, id) => sum + coursesById[id].listPriceMinor, 0);

  switch (offer.scheme) {
    case 'tiered_by_count': {
      const tier = pickHighestTier(offer.tiers, size);
      const discountMinor = tier ? Math.round((fullMinor * tier.percentOff) / 100) : 0;
      return {
        ruleId: offer.id,
        totalMinor: fullMinor - discountMinor,
        discountMinor,
        basis: { scheme: 'tiered_by_count', tier },
      };
    }
    case 'flat_percentage': {
      const discountMinor = Math.round((fullMinor * offer.percentOff) / 100);
      return {
        ruleId: offer.id,
        totalMinor: fullMinor - discountMinor,
        discountMinor,
        basis: { scheme: 'flat_percentage', percentOff: offer.percentOff },
      };
    }
    case 'fixed_price_per_tier': {
      const tier = pickExactTier(offer.tiers, size);
      if (!tier) {
        const lo = offer.tiers.filter(t => t.count < size).sort((a, b) => b.count - a.count)[0] ?? null;
        const hi =
          offer.tiers.filter(t => t.count > size && t.count <= offer.max).sort((a, b) => a.count - b.count)[0] ??
          null;
        return { lo, hi };
      }
      return {
        ruleId: offer.id,
        totalMinor: tier.fixedPriceMinor,
        discountMinor: fullMinor - tier.fixedPriceMinor,
        basis: { scheme: 'fixed_price_per_tier', tier },
      };
    }
    case 'per_course_contribution': {
      const perItemMinor: Record<string, number> = {};
      let totalMinor = 0;
      for (const id of pickedIds) {
        const price = offer.coursePricesMinor[id] ?? coursesById[id].listPriceMinor;
        perItemMinor[id] = price;
        totalMinor += price;
      }
      return {
        ruleId: offer.id,
        totalMinor,
        discountMinor: fullMinor - totalMinor,
        basis: { scheme: 'per_course_contribution', perItemMinor },
      };
    }
  }
}

function isGap(x: RawCandidate | Gap | null): x is Gap {
  return x !== null && !('ruleId' in x);
}

/** Applies `guardNonPositiveDiscount`'s exact predicate to the winning raw candidate. */
function guard(
  winner: RawCandidate | null,
  fullMinor: number
): { totalMinor: number; discountMinor: number; appliedRuleId: string | null; basis: EvaluationBasis | null } {
  if (winner === null) {
    return { totalMinor: fullMinor, discountMinor: 0, appliedRuleId: null, basis: null };
  }
  if (winner.totalMinor < 0 || winner.discountMinor <= 0) {
    return { totalMinor: fullMinor, discountMinor: 0, appliedRuleId: null, basis: null };
  }
  return {
    totalMinor: winner.totalMinor,
    discountMinor: winner.discountMinor,
    appliedRuleId: winner.ruleId,
    basis: winner.basis,
  };
}

/**
 * Quote for exactly one offer against a selection — mirrors `BB_quoteOne`.
 * Used both standalone (to detect a `fixed_price_per_tier` gap on the
 * primary offer) and as the anchor for `quote()`'s cross-offer comparison.
 */
export function quoteOne(offer: RuleOffer, sel: string[], owned: string[], coursesById: CoursesById): Quote {
  const own = owned.filter(id => isEligible(offer, id));
  const picked = sel.filter(id => isEligible(offer, id) && !own.includes(id));
  const count = picked.length + own.length;
  const fullMinor = picked.reduce((sum, id) => sum + coursesById[id].listPriceMinor, 0);
  const short = Math.max(0, offer.min - count);
  const atMax = count >= offer.max;

  const base: Quote = {
    count,
    own,
    picked,
    fullMinor,
    payMinor: fullMinor,
    offMinor: 0,
    pct: 0,
    valid: false,
    short,
    atMax,
    noSaving: false,
    basis: null,
    wonOfferId: null,
    gap: null,
  };

  if (count < offer.min || count > offer.max) return base;

  const raw = rawCandidate(offer, picked, own, coursesById);
  if (isGap(raw)) return { ...base, gap: raw };

  const guarded = guard(raw as RawCandidate | null, fullMinor);
  const noSaving = guarded.appliedRuleId === null;
  return {
    ...base,
    valid: true,
    basis: guarded.basis,
    noSaving,
    payMinor: guarded.totalMinor,
    offMinor: fullMinor - guarded.totalMinor,
    pct: fullMinor > 0 ? Math.round(((fullMinor - guarded.totalMinor) / fullMinor) * 100) : 0,
  };
}

/**
 * Quote for the primary offer, then checks `alts` and swaps in whichever
 * live rule (primary or alt) prices the same selection cheapest — mirrors
 * `BB_quote`. When the primary offer's own quote is invalid (below min,
 * above max, or a fixed-scheme gap) alternates are never consulted.
 */
export function quote(offer: RuleOffer, alts: RuleOffer[], sel: string[], owned: string[], coursesById: CoursesById): Quote {
  const own = owned.filter(id => isEligible(offer, id));
  const picked = sel.filter(id => isEligible(offer, id) && !own.includes(id));
  const count = picked.length + own.length;
  const fullMinor = picked.reduce((sum, id) => sum + coursesById[id].listPriceMinor, 0);
  const short = Math.max(0, offer.min - count);
  const atMax = count >= offer.max;

  const base: Quote = {
    count,
    own,
    picked,
    fullMinor,
    payMinor: fullMinor,
    offMinor: 0,
    pct: 0,
    valid: false,
    short,
    atMax,
    noSaving: false,
    basis: null,
    wonOfferId: null,
    gap: null,
  };

  if (count < offer.min || count > offer.max) return base;

  const primaryRaw = rawCandidate(offer, picked, own, coursesById);
  if (isGap(primaryRaw)) return { ...base, gap: primaryRaw };

  const allSelected = [...picked, ...own];
  const candidates: RawCandidate[] = [];
  if (primaryRaw !== null) candidates.push(primaryRaw);

  for (const alt of alts) {
    if (!allSelected.every(id => isEligible(alt, id))) continue;
    const altRaw = rawCandidate(alt, picked, own, coursesById);
    if (altRaw !== null && !isGap(altRaw)) candidates.push(altRaw);
  }

  let winner: RawCandidate | null = null;
  for (const candidate of candidates) {
    if (
      winner === null ||
      candidate.totalMinor < winner.totalMinor ||
      (candidate.totalMinor === winner.totalMinor && candidate.ruleId < winner.ruleId)
    ) {
      winner = candidate;
    }
  }

  const guarded = guard(winner, fullMinor);
  const noSaving = guarded.appliedRuleId === null;
  const wonOfferId = guarded.appliedRuleId !== null && guarded.appliedRuleId !== offer.id ? guarded.appliedRuleId : null;

  return {
    ...base,
    valid: true,
    basis: guarded.basis,
    noSaving,
    payMinor: guarded.totalMinor,
    offMinor: fullMinor - guarded.totalMinor,
    pct: fullMinor > 0 ? Math.round(((fullMinor - guarded.totalMinor) / fullMinor) * 100) : 0,
    wonOfferId,
  };
}

// ---------------------------------------------------------------------------
// Nudge — "add N more for X% off" — mirrors `BB_next`.
// ---------------------------------------------------------------------------

export type Nudge =
  | { kind: 'tier'; add: number; to: number; n: number; mMinor: number | null }
  | { kind: 'set'; add: number; n: number; priceMinor: number };

export function next(
  offer: RuleOffer,
  alts: RuleOffer[],
  q: Quote,
  sel: string[],
  owned: string[],
  coursesById: CoursesById
): Nudge | null {
  if (!q.valid || q.atMax) return null;

  if (offer.scheme === 'tiered_by_count') {
    const nx = offer.tiers.filter(t => t.count > q.count && t.count <= offer.max).sort((a, b) => a.count - b.count)[0];
    if (!nx) return null;
    const add = nx.count - q.count;
    let mMinor: number | null = null;
    if (add === 1) {
      const rest = offer.eligible.filter(id => !sel.includes(id) && !owned.includes(id));
      const costs = rest.map(id => {
        const withId = quote(offer, alts, [...sel, id], owned, coursesById);
        return withId.payMinor - q.payMinor;
      });
      if (costs.length > 0) mMinor = Math.min(...costs);
    }
    return { kind: 'tier', add, to: nx.percentOff, n: nx.count, mMinor };
  }

  if (offer.scheme === 'fixed_price_per_tier') {
    const nx = offer.tiers.filter(t => t.count > q.count && t.count <= offer.max).sort((a, b) => a.count - b.count)[0];
    if (!nx) return null;
    return { kind: 'set', add: nx.count - q.count, n: nx.count, priceMinor: nx.fixedPriceMinor };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Fixed bundle — mirrors `BB_fixedQuote`.
// ---------------------------------------------------------------------------

export interface FixedQuote {
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

export function fixedQuote(offer: FixedOffer, coursesById: CoursesById): FixedQuote {
  const fullMinor = offer.ids.reduce((sum, id) => sum + coursesById[id].listPriceMinor, 0);
  const payMinor = Math.min(offer.priceMinor, fullMinor);
  const offMinor = fullMinor - payMinor;
  return {
    fixed: true,
    count: offer.ids.length,
    picked: offer.ids,
    fullMinor,
    payMinor,
    offMinor,
    pct: fullMinor > 0 ? Math.round((offMinor / fullMinor) * 100) : 0,
    valid: true,
    noSaving: payMinor >= fullMinor,
  };
}
