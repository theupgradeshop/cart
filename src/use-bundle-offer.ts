import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BundleOffer, CourseDetail, CoursesById, Quote, Nudge, OfferPreset, RuleOffer, quote, next } from './bundle-engine';
import { PresetDerivedState, derivePresetState } from './bundle-presets';

export type BundleOfferStatus = 'live' | 'draft' | 'gone';

/**
 * The site route's response shape (contract:
 * `2026-09-27-course-bundles-storefront-and-pe-block.md` "Camoflash server
 * route"): the U2 dashboard read, PLUS `owned` — course ids the logged-in
 * shopper already owns, added server-side from the session's `contactId`,
 * never client-supplied.
 */
export interface BundleOfferResponse {
  status: BundleOfferStatus;
  currency: string;
  offer: BundleOffer | null;
  courses: CourseDetail[];
  alts: RuleOffer[];
  owned: string[];
  /**
   * Ready-made picks for a rule offer (D8, R2 contract) — the R2 route nests these
   * under `offer.presets`; this mirrors the same list at the response's top level so
   * a consumer never has to narrow `offer` to `RuleOffer` just to read them. Always
   * `undefined`/absent for a fixed offer or when the offer has no presets.
   */
  presets?: OfferPreset[];
}

export type BundleOfferState =
  | { status: 'loading' }
  | { status: 'error'; error: Error }
  | (BundleOfferResponse & { status: 'live' | 'draft' | 'gone' });

export interface UseBundleOfferResult {
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
  /** Ready-made picks for the current rule offer (D8) — `[]` for a fixed offer or none. */
  presets: OfferPreset[];
  /** The active preset's id, or `null` when building your own. Resets when `url` changes. */
  preset: string | null;
  /** Controlled setter for `preset` — the README's raw `onPreset`. */
  setPreset: (id: string | null) => void;
  /** "Take preset" (README Actions): selects the preset and seeds `sel` per its `swap` flag. */
  takePreset: (id: string) => void;
  /** "Build your own" (README Actions): clears the active preset, keeping an edited (`mine`) selection. */
  buildOwn: () => void;
  /** "Undo changes" (README Actions): resets `sel` back to the active preset's own selection. Only meaningful when the current selection is `mine` (a no-op otherwise). */
  undoChanges: () => void;
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
export function useBundleOffer(url: string): UseBundleOfferResult {
  const [state, setState] = useState<BundleOfferState>({ status: 'loading' });
  const [sel, setSelState] = useState<string[]>([]);
  const [preset, setPresetState] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const requestId = ++requestIdRef.current;
    setState({ status: 'loading' });
    setSelState([]);
    setPresetState(null);

    fetch(url)
      .then(res => {
        if (!res.ok) throw new Error(`Bundle offer fetch failed: ${res.status}`);
        return res.json();
      })
      .then((json: BundleOfferResponse) => {
        if (cancelled || requestIdRef.current !== requestId) return;
        setState({ ...json, status: json.status });
      })
      .catch((err: unknown) => {
        if (cancelled || requestIdRef.current !== requestId) return;
        setState({ status: 'error', error: err instanceof Error ? err : new Error(String(err)) });
      });

    return () => {
      cancelled = true;
    };
  }, [url]);

  const coursesById: CoursesById = useMemo(() => {
    if (state.status !== 'live' && state.status !== 'draft' && state.status !== 'gone') return {};
    const map: CoursesById = {};
    for (const c of state.courses) map[c.id] = c;
    return map;
  }, [state]);

  const offer = state.status === 'live' || state.status === 'draft' || state.status === 'gone' ? state.offer : null;
  const alts = state.status === 'live' || state.status === 'draft' || state.status === 'gone' ? state.alts : [];
  const owned = state.status === 'live' || state.status === 'draft' || state.status === 'gone' ? state.owned : [];
  const currency = state.status === 'live' || state.status === 'draft' || state.status === 'gone' ? state.currency : null;

  const isRuleOffer = offer !== null && offer.kind === 'rule';
  const ruleOffer = isRuleOffer ? (offer as RuleOffer) : null;

  const setSel = useCallback(
    (nextSel: string[]) => {
      if (!ruleOffer) return;
      const capped =
        nextSel.length > ruleOffer.max
          ? [...owned.filter(id => nextSel.includes(id)), ...nextSel.filter(id => !owned.includes(id))].slice(
              0,
              ruleOffer.max
            )
          : nextSel;
      setSelState(capped);
    },
    [ruleOffer, owned]
  );

  const toggle = useCallback(
    (id: string) => {
      if (!ruleOffer) return;
      if (owned.includes(id)) return; // owned courses are never toggle-able
      setSelState(prev => {
        if (prev.includes(id)) return prev.filter(x => x !== id);
        const own = owned.filter(o => ruleOffer.eligible.includes(o));
        const atMax = prev.length + own.length >= ruleOffer.max;
        if (atMax) return prev;
        return [...prev, id];
      });
    },
    [ruleOffer, owned]
  );

  const computedQuote = ruleOffer ? quote(ruleOffer, alts as RuleOffer[], sel, owned, coursesById) : null;
  const computedNext = ruleOffer && computedQuote ? next(ruleOffer, alts as RuleOffer[], computedQuote, sel, owned, coursesById) : null;

  const presets: OfferPreset[] = ruleOffer?.presets ?? [];

  const derived: PresetDerivedState = useMemo(
    () => derivePresetState({ presets, preset, sel, owned }),
    [presets, preset, sel, owned]
  );

  const setPreset = useCallback((id: string | null) => {
    setPresetState(id);
  }, []);

  const takePreset = useCallback(
    (id: string) => {
      const p = presets.find(candidate => candidate.id === id);
      if (!p) return;
      setPresetState(p.id);
      setSelState(p.swap ? p.ids.filter(cid => !owned.includes(cid)) : []);
    },
    [presets, owned]
  );

  const buildOwn = useCallback(() => {
    if (!derived.act) return; // no-op when already building their own
    setPresetState(null);
    if (!derived.mine) setSelState([]); // keeps the shopper's edited (mine) selection
  }, [derived.act, derived.mine]);

  const undoChanges = useCallback(() => {
    if (!derived.mine) return;
    setSelState(derived.pSel);
  }, [derived.mine, derived.pSel]);

  return {
    status: state.status,
    currency,
    offer,
    courses: coursesById,
    alts: alts as RuleOffer[],
    owned,
    sel,
    setSel,
    toggle,
    quote: computedQuote,
    next: computedNext,
    loading: state.status === 'loading',
    error: state.status === 'error' ? state.error : null,
    presets,
    preset,
    setPreset,
    takePreset,
    buildOwn,
    undoChanges,
  };
}
