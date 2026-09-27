import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BundleOffer, CourseDetail, CoursesById, Quote, Nudge, RuleOffer, quote, next } from './bundle-engine';

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
  const requestIdRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const requestId = ++requestIdRef.current;
    setState({ status: 'loading' });
    setSelState([]);

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
  };
}
