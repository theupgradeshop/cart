/**
 * Bundle builder presets (D8/D10, `2026-09-27-course-bundles-storefront-and-pe-block.md`
 * Round 2, Unit R3). Pure helpers mirroring the presets design reference exactly
 * (`cowork/design-references/design_handoff_bundle_builder_presets/README.md`,
 * "Derived state" / "Actions", and `BundleBuilder.jsx`'s `BB_same`,
 * `BundleBuilderBlock`'s `act`/`locked`/`pSel`/`mine`/`take`/`buildOwn`).
 *
 * A preset carries NO price of its own (D10, the presets README: "Presets have no
 * price field") — its price is always `quote()`/`quoteOne()` against the resolved
 * owned set, never a new price path.
 */

import { CoursesById, OfferPreset, Quote, RuleOffer, quote } from './bundle-engine';

export type { OfferPreset };

/** Set equality by membership, order-independent — mirrors `BB_same`. */
export function sameSet(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every(x => b.includes(x));
}

/** A preset's own selection with owned courses removed — mirrors `pSel` (`p.ids minus owned`). */
export function presetSelection(preset: OfferPreset, owned: string[]): string[] {
  return preset.ids.filter(id => !owned.includes(id));
}

/**
 * The owned set to price a preset against (README "owned'"): a NON-swappable preset
 * prices against `owned ∩ preset.ids` (a set is a set); a swappable preset prices
 * against the full `owned` list, exactly like manual picking.
 */
export function presetOwned(preset: OfferPreset, owned: string[]): string[] {
  return preset.swap ? owned : owned.filter(id => preset.ids.includes(id));
}

export interface PresetDerivedState {
  /** The active preset object, or `null` when building your own. */
  act: OfferPreset | null;
  /** A non-swappable preset is active — tray/toggles hidden, only its own courses shown. */
  locked: boolean;
  /** The active preset's selection with owned removed (`[]` when no preset is active). */
  pSel: string[];
  /** A swappable preset was taken, then the shopper edited away from its exact set. */
  mine: boolean;
}

/**
 * Derived state for the active preset against the current selection — mirrors the
 * README's "Derived state" block field-for-field (`act`, `locked`, `pSel`, `mine`).
 * `mine` is derived, never stored: editing back to exactly the preset's set makes it
 * read as the preset again.
 */
export function derivePresetState(params: {
  presets: OfferPreset[];
  preset: string | null;
  sel: string[];
  owned: string[];
}): PresetDerivedState {
  const { presets, preset, sel, owned } = params;
  const act = presets.find(p => p.id === preset) ?? null;
  const locked = !!act && !act.swap;
  const pSel = act ? presetSelection(act, owned) : [];
  const mine = !!act && act.swap && !sameSet(sel, pSel);
  return { act, locked, pSel, mine };
}

/**
 * Price for a preset card/CTA — always `quote()` against the resolved owned set
 * (README: "Price is always `BB_quote(offer, alts, preset.ids, owned', courses)` —
 * identical to picking by hand"). Never a new price path.
 */
export function quotePreset(
  offer: RuleOffer,
  alts: RuleOffer[],
  preset: OfferPreset,
  owned: string[],
  courses: CoursesById
): Quote {
  return quote(offer, alts, preset.ids, presetOwned(preset, owned), courses);
}

/**
 * The course ids to send to checkout (D10): a locked (non-swappable) preset sends
 * its full `preset.ids` (owned courses included — the server prices owned via the
 * session contact via `composed-bundle.ts`'s checkout fragment); otherwise the same
 * combination the design's own CTA uses today — the picked (non-owned) selection
 * plus whichever owned courses are actually eligible on this offer (`filled =
 * [...q.own, ...q.picked]` in `BundleBuilder.jsx`). `quote` is the `Quote` already
 * computed for the current offer/alts/sel/owned (via `quote()` in `bundle-engine.ts`)
 * — its `own`/`picked` fields are THE one rule for how owned ids get included, so
 * this reuses them rather than re-deriving eligibility a second time.
 */
export function resolveCheckoutSelection(params: {
  presets: OfferPreset[];
  preset: string | null;
  sel: string[];
  owned: string[];
  quote: Quote;
}): string[] {
  const { act, locked } = derivePresetState(params);
  if (act && locked) return act.ids;
  return [...params.quote.own, ...params.quote.picked];
}
