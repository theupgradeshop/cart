// tests/bundle-presets.test.ts
//
// Pure-helper tests for bundle presets (D8/D10, `2026-09-27-course-bundles-storefront-
// and-pe-block.md` Round 2, Unit R3). Mirrors the presets design reference's "Derived
// state" / "Actions" (`cowork/design-references/design_handoff_bundle_builder_presets/
// README.md`) exactly.
import { describe, it, expect } from 'vitest';
import {
  sameSet,
  presetSelection,
  presetOwned,
  derivePresetState,
  quotePreset,
  resolveCheckoutSelection,
  OfferPreset,
} from '../src/bundle-presets';
import { quote, CoursesById, RuleOffer } from '../src/bundle-engine';

const course = (id: string, listPriceMinor: number) => ({
  id,
  title: id,
  slug: id,
  imageUrl: null,
  listPriceMinor,
  productSlug: null,
});

const coursesById: CoursesById = {
  a: course('a', 1000),
  b: course('b', 1000),
  c: course('c', 1000),
  d: course('d', 1000),
  e: course('e', 1000),
};

const offer: RuleOffer = {
  kind: 'rule',
  id: 'rule-1',
  name: 'rule-1',
  title: 'Bundle',
  description: null,
  eligible: ['a', 'b', 'c', 'd', 'e'],
  min: 2,
  max: 4,
  scheme: 'tiered_by_count',
  tiers: [
    { count: 2, percentOff: 10 },
    { count: 3, percentOff: 20 },
    { count: 4, percentOff: 30 },
  ],
};

const swappablePreset: OfferPreset = { id: 'p-swap', name: 'Starter pick', ids: ['a', 'b', 'c'], swap: true };
const lockedPreset: OfferPreset = { id: 'p-locked', name: 'Set pick', ids: ['a', 'b', 'c'], swap: false };

describe('sameSet', () => {
  it('true for the same members in any order', () => {
    expect(sameSet(['a', 'b'], ['b', 'a'])).toBe(true);
  });
  it('false for different lengths', () => {
    expect(sameSet(['a', 'b'], ['a'])).toBe(false);
  });
  it('false for different members of the same length', () => {
    expect(sameSet(['a', 'b'], ['a', 'c'])).toBe(false);
  });
  it('true for two empty arrays', () => {
    expect(sameSet([], [])).toBe(true);
  });
});

describe('presetSelection (pSel = preset.ids minus owned)', () => {
  it('returns the full preset when nothing is owned', () => {
    expect(presetSelection(swappablePreset, [])).toEqual(['a', 'b', 'c']);
  });
  it('removes owned ids from the preset', () => {
    expect(presetSelection(swappablePreset, ['b'])).toEqual(['a', 'c']);
  });
  it('is empty when every preset course is owned', () => {
    expect(presetSelection(swappablePreset, ['a', 'b', 'c', 'd'])).toEqual([]);
  });
});

describe('presetOwned ("owned\'")', () => {
  it('non-swappable preset: owned intersected with the preset ids — owned course outside the preset is dropped', () => {
    expect(presetOwned(lockedPreset, ['b', 'd'])).toEqual(['b']);
  });
  it('non-swappable preset: no owned courses inside it means an empty owned-prime set', () => {
    expect(presetOwned(lockedPreset, ['d', 'e'])).toEqual([]);
  });
  it('swappable preset: the full owned list passes through unchanged, same as manual picking', () => {
    expect(presetOwned(swappablePreset, ['b', 'd'])).toEqual(['b', 'd']);
  });
});

describe('derivePresetState', () => {
  it('no active preset: act null, locked false, pSel empty, mine false', () => {
    const state = derivePresetState({ presets: [swappablePreset, lockedPreset], preset: null, sel: ['a'], owned: [] });
    expect(state).toEqual({ act: null, locked: false, pSel: [], mine: false });
  });

  it('non-swappable preset active: locked true, pSel = preset ids minus owned', () => {
    const state = derivePresetState({
      presets: [lockedPreset],
      preset: 'p-locked',
      sel: [],
      owned: [],
    });
    expect(state.act).toEqual(lockedPreset);
    expect(state.locked).toBe(true);
    expect(state.pSel).toEqual(['a', 'b', 'c']);
    expect(state.mine).toBe(false); // mine only ever applies to a swappable preset
  });

  it('owned course inside a locked (non-swappable) preset: pSel is preset.ids minus that owned course', () => {
    const state = derivePresetState({
      presets: [lockedPreset],
      preset: 'p-locked',
      sel: [],
      owned: ['b'],
    });
    expect(state.locked).toBe(true);
    expect(state.pSel).toEqual(['a', 'c']);
  });

  it('swappable preset taken, selection untouched: mine is false', () => {
    const pSel = presetSelection(swappablePreset, []);
    const state = derivePresetState({ presets: [swappablePreset], preset: 'p-swap', sel: pSel, owned: [] });
    expect(state.locked).toBe(false);
    expect(state.mine).toBe(false);
  });

  it('swappable preset taken, then the shopper edits the selection: mine is true', () => {
    const state = derivePresetState({
      presets: [swappablePreset],
      preset: 'p-swap',
      sel: ['a', 'b'], // dropped 'c' from the preset's own selection
      owned: [],
    });
    expect(state.mine).toBe(true);
  });

  it('mine flips back to the preset when the shopper edits back to exactly the preset\'s set', () => {
    const pSel = presetSelection(swappablePreset, []);
    // Edited away, then back — same object identity is not required, only set equality.
    const edited = derivePresetState({ presets: [swappablePreset], preset: 'p-swap', sel: ['a', 'b'], owned: [] });
    expect(edited.mine).toBe(true);

    const backToExact = derivePresetState({
      presets: [swappablePreset],
      preset: 'p-swap',
      sel: [...pSel].reverse(), // order-independent
      owned: [],
    });
    expect(backToExact.mine).toBe(false);
  });
});

describe('quotePreset — always the plain quote() engine, never a new price path', () => {
  it('non-swappable preset prices against owned ∩ preset.ids, matching a manual quote() call with the same owned\' set', () => {
    const got = quotePreset(offer, [], lockedPreset, ['b', 'd'], coursesById);
    const expected = quote(offer, [], lockedPreset.ids, presetOwned(lockedPreset, ['b', 'd']), coursesById);
    expect(got).toEqual(expected);
    // 'd' is not part of the locked preset, so it must not be treated as owned/free here.
    expect(got.own).toEqual(['b']);
  });

  it('swappable preset prices against the full owned list, same as manual picking', () => {
    const got = quotePreset(offer, [], swappablePreset, ['b', 'd'], coursesById);
    const expected = quote(offer, [], swappablePreset.ids, ['b', 'd'], coursesById);
    expect(got).toEqual(expected);
  });
});

describe('resolveCheckoutSelection', () => {
  it('locked (non-swappable) preset: sends preset.ids, owned included', () => {
    const q = quotePreset(offer, [], lockedPreset, ['b'], coursesById);
    const ids = resolveCheckoutSelection({ presets: [lockedPreset], preset: 'p-locked', sel: [], owned: ['b'], quote: q });
    expect(ids).toEqual(lockedPreset.ids);
    expect(ids).toContain('b'); // the owned course stays in, priced free by the server via the session contact
  });

  it('swappable preset (untouched): resolves to quote.own + quote.picked, not preset.ids directly', () => {
    const sel = presetSelection(swappablePreset, ['b']);
    const q = quote(offer, [], sel, ['b'], coursesById);
    const ids = resolveCheckoutSelection({ presets: [swappablePreset], preset: 'p-swap', sel, owned: ['b'], quote: q });
    expect(ids.sort()).toEqual([...q.own, ...q.picked].sort());
    expect(ids.sort()).toEqual(['a', 'b', 'c'].sort());
  });

  it('no preset active (manual build): resolves to quote.own + quote.picked for the current sel/owned', () => {
    const sel = ['a', 'c'];
    const owned = ['d'];
    const q = quote(offer, [], sel, owned, coursesById);
    const ids = resolveCheckoutSelection({ presets: [], preset: null, sel, owned, quote: q });
    expect(ids.sort()).toEqual([...q.own, ...q.picked].sort());
    expect(ids.sort()).toEqual(['a', 'c', 'd'].sort());
  });
});
