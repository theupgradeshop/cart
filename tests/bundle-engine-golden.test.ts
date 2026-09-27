// tests/bundle-engine-golden.test.ts
//
// Golden parity test (D3, courses-bundles storefront spec, Unit U3). See the sibling
// test in the dashboard repo (`src/lib/store/__tests__/bundle-pricing-golden.test.ts`)
// for the full explanation of how `tests/fixtures/bundle-pricing-golden.json` was
// generated (by running the REAL server evaluator + guard, never hand-computed).
//
// This test converts each case's `rules`/`chosenCourses` (the dashboard evaluator's own
// input shape) into this engine's `RuleOffer[]`/`sel`/`owned`/`coursesById` (the U2 route's
// shape) and asserts `quote()` reproduces the same total/discount/applied-rule outcome.
// The first rule in each case is treated as the "primary" offer (the one a storefront
// block would be built around); every other rule is an "alt". This is a faithful
// reproduction for every case in this fixture: every case's `chosenCourses` set is a
// subset of the PRIMARY rule's own eligible set (an "all" sentinel, or an explicit list
// that covers the whole selection) -- exactly the invariant the real storefront upholds,
// since a shopper can only ever pick courses from one bundle's own picker at a time.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { quote } from '../src/bundle-engine';
import type { RuleOffer, CoursesById, CountTier, FixedPriceTier } from '../src/bundle-engine';

// If this fails: the fixture file's bytes no longer match this constant. Regenerate it
// from the dashboard's real evaluator + guard, then copy it BYTE-FOR-BYTE here AND to
// /var/www/apps/app.upgradeshop.ai/src/lib/store/__fixtures__/bundle-pricing-golden.json,
// updating the sha256 constant in BOTH this test and the dashboard's golden test.
const EXPECTED_SHA256 = '6f74a0e07e8beb73de3200d173270be31d127a14dfaedd4724b1078e13ac26b9';

const fixturePath = join(__dirname, 'fixtures', 'bundle-pricing-golden.json');
const fixtureRaw = readFileSync(fixturePath, 'utf8');

interface DashboardRule {
  id: string;
  minItems: number;
  maxItems: number;
  eligibleCourseIds: string[] | 'all';
  scheme: 'tiered_by_count' | 'flat_percentage' | 'fixed_price_per_tier' | 'per_course_contribution';
  tiers?: CountTier[] | FixedPriceTier[];
  percentOff?: number;
  coursePricesMinor?: Record<string, number | null | undefined>;
}

interface ChosenCourse {
  id: string;
  listPriceMinor: number;
  owned: boolean;
}

interface GoldenCase {
  name: string;
  rules: DashboardRule[];
  chosenCourses: ChosenCourse[];
  expected: {
    totalMinor: number;
    discountMinor: number;
    appliedRuleId: string | null;
    suppressed: boolean;
  };
}

// `eligible: "all"` isn't expressible in the U2 route's concrete-list contract (that
// resolution happens upstream, per the route's own doc comment) -- for this test, every
// fixture case using the "all" sentinel selects from a small, fully-enumerated course
// set, so "all" is reproduced here as "every course id this case ever mentions".
function buildOffer(rule: DashboardRule, allCourseIds: string[]): RuleOffer {
  const eligible = rule.eligibleCourseIds === 'all' ? allCourseIds : rule.eligibleCourseIds;
  const common = {
    kind: 'rule' as const,
    id: rule.id,
    name: rule.id,
    title: rule.id,
    description: null,
    eligible,
    min: rule.minItems,
    max: rule.maxItems,
  };
  switch (rule.scheme) {
    case 'tiered_by_count':
      return { ...common, scheme: 'tiered_by_count', tiers: rule.tiers as CountTier[] };
    case 'flat_percentage':
      return { ...common, scheme: 'flat_percentage', percentOff: rule.percentOff as number };
    case 'fixed_price_per_tier':
      return { ...common, scheme: 'fixed_price_per_tier', tiers: rule.tiers as FixedPriceTier[] };
    case 'per_course_contribution':
      return {
        ...common,
        scheme: 'per_course_contribution',
        coursePricesMinor: rule.coursePricesMinor as Record<string, number | null | undefined>,
      };
  }
}

describe('bundle-pricing-golden fixture integrity', () => {
  it('the fixture file bytes match the pinned sha256 constant', () => {
    const actual = createHash('sha256').update(fixtureRaw).digest('hex');
    expect(
      actual,
      `bundle-pricing-golden.json sha256 mismatch (expected ${EXPECTED_SHA256}, got ${actual}). ` +
        'Regenerate the fixture from the dashboard\'s real evaluator + guard, then copy it ' +
        'BYTE-FOR-BYTE to src/lib/store/__fixtures__/bundle-pricing-golden.json in the dashboard ' +
        'repo and update the sha256 constant in BOTH this test and the dashboard\'s golden test.'
    ).toBe(EXPECTED_SHA256);
  });

  it('has at least 25 cases', () => {
    const fixture: { cases: GoldenCase[] } = JSON.parse(fixtureRaw);
    expect(fixture.cases.length).toBeGreaterThanOrEqual(25);
  });
});

describe('bundle-engine quote() reproduces every golden case', () => {
  const fixture: { cases: GoldenCase[] } = JSON.parse(fixtureRaw);

  for (const goldenCase of fixture.cases) {
    it(goldenCase.name, () => {
      const allCourseIds = goldenCase.chosenCourses.map(c => c.id);
      const offers = goldenCase.rules.map(r => buildOffer(r, allCourseIds));
      const [primary, ...alts] = offers;

      const coursesById: CoursesById = {};
      for (const c of goldenCase.chosenCourses) {
        coursesById[c.id] = {
          id: c.id,
          title: c.id,
          slug: c.id,
          imageUrl: null,
          listPriceMinor: c.listPriceMinor,
          productSlug: null,
        };
      }

      const sel = goldenCase.chosenCourses.filter(c => !c.owned).map(c => c.id);
      const owned = goldenCase.chosenCourses.filter(c => c.owned).map(c => c.id);

      const q = quote(primary, alts, sel, owned, coursesById);
      const derivedAppliedRuleId = q.basis === null ? null : (q.wonOfferId ?? primary.id);

      expect(q.payMinor).toBe(goldenCase.expected.totalMinor);
      expect(q.offMinor).toBe(goldenCase.expected.discountMinor);
      expect(derivedAppliedRuleId).toBe(goldenCase.expected.appliedRuleId);
      if (goldenCase.expected.suppressed) {
        expect(q.noSaving).toBe(true);
      }
    });
  }
});
