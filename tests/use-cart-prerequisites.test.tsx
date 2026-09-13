import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import React from 'react';
import { CartProvider } from '../src/cart-context';
import { useCart } from '../src/cart-context';
import { useCartPrerequisites } from '../src/use-cart-prerequisites';

const prereqSummary = {
  id: 'prereq-id',
  name: 'Prerequisite Product',
  slug: 'prereq-product',
  price: 50,
  images: [],
};

const productSummary = {
  id: 'product-id',
  name: 'Main Product',
  slug: 'product-a',
  price: 200,
  images: [],
};

const dependentSummary = {
  id: 'dependent-id',
  name: 'Dependent Product',
  slug: 'dependent-product',
  price: 75,
  images: [],
};

function makeMissingResponse() {
  return {
    missing: [{ product: productSummary, prerequisite: prereqSummary }],
  };
}

function makeDependenciesResponse() {
  return {
    missing: [],
    dependencies: [{ product: dependentSummary, prerequisite: prereqSummary }],
  };
}

function makeWrapper(storageKey = 'test-cart-prereq') {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <CartProvider storageKey={storageKey} apiBaseUrl="https://api.test">
        {children}
      </CartProvider>
    );
  };
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useCartPrerequisites', () => {
  it('a consumer that never mounts the hook triggers no fetch at all', async () => {
    const { result } = renderHook(() => useCart(), { wrapper: makeWrapper('never-mounts') });
    act(() => { result.current.addItem('product-a', 1); });
    // Give any stray async work a tick to (not) happen.
    await new Promise(r => setTimeout(r, 0));
    expect(fetch).not.toHaveBeenCalled();
  });

  it('empty cart: no fetch, empty result', async () => {
    const { result } = renderHook(() => useCartPrerequisites('test.com'), { wrapper: makeWrapper('empty-cart') });
    expect(result.current.missing).toEqual([]);
    expect(result.current.autoAdded).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('no missing prerequisite: no add, empty result', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ missing: [] }),
    } as Response);

    const { result } = renderHook(
      () => ({ cart: useCart(), prereq: useCartPrerequisites('test-none.com') }),
      { wrapper: makeWrapper('no-missing') }
    );

    act(() => { result.current.cart.addItem('product-a', 1); });

    await waitFor(() => expect(result.current.prereq.isLoading).toBe(false));

    expect(result.current.prereq.missing).toEqual([]);
    expect(result.current.prereq.autoAdded).toEqual([]);
    expect(result.current.cart.items).toEqual([{ slug: 'product-a', quantity: 1 }]);
  });

  it('fails open on a non-ok response — no throw, no add, empty missing', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
    } as Response);

    const { result } = renderHook(
      () => ({ cart: useCart(), prereq: useCartPrerequisites('test-500.com') }),
      { wrapper: makeWrapper('fail-open-500') }
    );

    act(() => { result.current.cart.addItem('product-a', 1); });

    await waitFor(() => expect(result.current.prereq.isLoading).toBe(false));

    expect(result.current.prereq.error).toBeInstanceOf(Error);
    expect(result.current.prereq.missing).toEqual([]);
    expect(result.current.prereq.autoAdded).toEqual([]);
    // No auto-add happened — cart is unaffected beyond the caller's own add.
    expect(result.current.cart.items).toEqual([{ slug: 'product-a', quantity: 1 }]);
  });

  it('fails open on a thrown fetch — no throw, no add, empty missing', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(
      () => ({ cart: useCart(), prereq: useCartPrerequisites('test-throw.com') }),
      { wrapper: makeWrapper('fail-open-throw') }
    );

    act(() => { result.current.cart.addItem('product-a', 1); });

    await waitFor(() => expect(result.current.prereq.isLoading).toBe(false));

    expect(result.current.prereq.error).toBeInstanceOf(Error);
    expect(result.current.prereq.missing).toEqual([]);
    expect(result.current.cart.items).toEqual([{ slug: 'product-a', quantity: 1 }]);
  });

  it('auto-adds a missing prerequisite and reports it in autoAdded', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => makeMissingResponse(),
    } as Response);

    const { result } = renderHook(
      () => ({ cart: useCart(), prereq: useCartPrerequisites('test-add.com') }),
      { wrapper: makeWrapper('auto-add') }
    );

    act(() => { result.current.cart.addItem('product-a', 1); });

    await waitFor(() => {
      expect(result.current.cart.items.some(i => i.slug === 'prereq-product')).toBe(true);
    });

    expect(result.current.prereq.autoAdded).toHaveLength(1);
    expect(result.current.prereq.autoAdded[0].prerequisite.slug).toBe('prereq-product');
  });

  it('LOOP GUARD: a mock that keeps reporting the SAME missing prerequisite no matter what the cart contains results in exactly ONE addItem call', async () => {
    // Always answers with the same missing entry, regardless of the
    // productSlugs sent — this is the exact hazard the guard exists for:
    // auto-adding the prerequisite changes the cart, which re-triggers the
    // fetch, which (with this mock) reports the very same thing missing.
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => makeMissingResponse(),
    } as Response);

    const { result } = renderHook(
      () => ({ cart: useCart(), prereq: useCartPrerequisites('test-loop.com') }),
      { wrapper: makeWrapper('loop-guard') }
    );

    act(() => { result.current.cart.addItem('product-a', 1); });

    // Wait for the prerequisite to show up...
    await waitFor(() => {
      expect(result.current.cart.items.some(i => i.slug === 'prereq-product')).toBe(true);
    });

    // ...then wait a further beat to let any re-trigger from the cart
    // change above settle, and assert it never added a second time.
    await new Promise(r => setTimeout(r, 50));
    await waitFor(() => expect(result.current.prereq.isLoading).toBe(false));

    const prereqItem = result.current.cart.items.find(i => i.slug === 'prereq-product');
    // ADD_ITEM increments quantity on a repeat call for the same slug — a
    // quantity of exactly 1 is the direct, observable signature of exactly
    // one addItem('prereq-product', 1) call. Any runaway re-add would show
    // up here as quantity > 1.
    expect(prereqItem?.quantity).toBe(1);
    expect(result.current.prereq.autoAdded).toHaveLength(1);
  });

  it('DEPENDENCIES: a response carrying both missing and dependencies exposes dependencies without auto-adding them', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        missing: [{ product: productSummary, prerequisite: prereqSummary }],
        dependencies: [{ product: dependentSummary, prerequisite: prereqSummary }],
      }),
    } as Response);

    const { result } = renderHook(
      () => ({ cart: useCart(), prereq: useCartPrerequisites('test-deps.com') }),
      { wrapper: makeWrapper('deps-mixed') }
    );

    act(() => { result.current.cart.addItem('product-a', 1); });

    await waitFor(() => expect(result.current.prereq.isLoading).toBe(false));

    expect(result.current.prereq.dependencies).toEqual([
      { product: dependentSummary, prerequisite: prereqSummary },
    ]);
    // Only `missing`'s entry drove an add — `dependencies` never does.
    // The prereq item's quantity would exceed 1 if the dependencies entry
    // (which shares the same prerequisite slug) had also triggered an add.
    const prereqItem = result.current.cart.items.find(i => i.slug === 'prereq-product');
    expect(prereqItem?.quantity).toBe(1);
    expect(result.current.cart.items.some(i => i.slug === 'dependent-product')).toBe(false);
  });

  it('DEPENDENCIES: empty missing with populated dependencies — no add fires at all', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => makeDependenciesResponse(),
    } as Response);

    const { result } = renderHook(
      () => ({ cart: useCart(), prereq: useCartPrerequisites('test-deps-only.com') }),
      { wrapper: makeWrapper('deps-only') }
    );

    act(() => { result.current.cart.addItem('dependent-product', 1); });

    await waitFor(() => expect(result.current.prereq.isLoading).toBe(false));

    expect(result.current.prereq.missing).toEqual([]);
    expect(result.current.prereq.dependencies).toEqual([
      { product: dependentSummary, prerequisite: prereqSummary },
    ]);
    expect(result.current.prereq.autoAdded).toEqual([]);
    // Only the caller's own explicit add — nothing auto-added.
    expect(result.current.cart.items).toEqual([{ slug: 'dependent-product', quantity: 1 }]);
  });

  it('DEPENDENCIES: a response with no dependencies key at all yields dependencies: [] and does not throw', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => makeMissingResponse(), // no `dependencies` key
    } as Response);

    const { result } = renderHook(
      () => ({ cart: useCart(), prereq: useCartPrerequisites('test-no-deps-key.com') }),
      { wrapper: makeWrapper('no-deps-key') }
    );

    act(() => { result.current.cart.addItem('product-a', 1); });

    await waitFor(() => expect(result.current.prereq.isLoading).toBe(false));

    expect(() => result.current.prereq.dependencies).not.toThrow();
    expect(result.current.prereq.dependencies).toEqual([]);
  });

  it('DEPENDENCIES: missing and dependencies share ONE request — a slug-set change fetches exactly once', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => makeDependenciesResponse(),
    } as Response);

    const { result } = renderHook(
      () => ({ cart: useCart(), prereq: useCartPrerequisites('test-one-fetch.com') }),
      { wrapper: makeWrapper('one-fetch-per-change') }
    );

    act(() => { result.current.cart.addItem('product-a', 1); });
    await waitFor(() => expect(result.current.prereq.isLoading).toBe(false));
    expect(fetch).toHaveBeenCalledTimes(1);

    // Adding a second, distinct slug changes the slug-set → one more fetch,
    // not two (one for `missing`, one for `dependencies`) — they are read
    // off the SAME response.
    act(() => { result.current.cart.addItem('another-product', 1); });
    await waitFor(() => expect(result.current.prereq.isLoading).toBe(false));
    expect(fetch).toHaveBeenCalledTimes(2);

    // Same slug-set again (a re-render/quantity bump) — served from cache,
    // no additional fetch at all.
    act(() => { result.current.cart.addItem('another-product', 1); });
    await waitFor(() => expect(result.current.prereq.isLoading).toBe(false));
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  describe('dependentsOf', () => {
    const dependentSummary2 = {
      id: 'dependent-id-2',
      name: 'Second Dependent Product',
      slug: 'dependent-product-2',
      price: 90,
      images: [],
    };

    it('returns the dependent for a prerequisite slug named in `dependencies`', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => makeDependenciesResponse(),
      } as Response);

      const { result } = renderHook(
        () => ({ cart: useCart(), prereq: useCartPrerequisites('test-dependents-of.com') }),
        { wrapper: makeWrapper('dependents-of-basic') }
      );

      act(() => { result.current.cart.addItem('dependent-product', 1); });
      await waitFor(() => expect(result.current.prereq.isLoading).toBe(false));

      expect(result.current.prereq.dependentsOf('prereq-product')).toEqual([dependentSummary]);
    });

    it('returns [] for a slug nothing depends on, and for an unknown slug — never throws', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => makeDependenciesResponse(),
      } as Response);

      const { result } = renderHook(
        () => ({ cart: useCart(), prereq: useCartPrerequisites('test-dependents-of-empty.com') }),
        { wrapper: makeWrapper('dependents-of-empty') }
      );

      act(() => { result.current.cart.addItem('dependent-product', 1); });
      await waitFor(() => expect(result.current.prereq.isLoading).toBe(false));

      // A real prerequisite slug that nothing in this response depends on.
      expect(() => result.current.prereq.dependentsOf('dependent-product')).not.toThrow();
      expect(result.current.prereq.dependentsOf('dependent-product')).toEqual([]);
      // A slug that doesn't exist anywhere in this cart/catalogue at all.
      expect(() => result.current.prereq.dependentsOf('no-such-slug')).not.toThrow();
      expect(result.current.prereq.dependentsOf('no-such-slug')).toEqual([]);
    });

    it('returns both dependants of one prerequisite, and dedupes the same pair reported twice', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({
          missing: [],
          dependencies: [
            { product: dependentSummary, prerequisite: prereqSummary },
            { product: dependentSummary2, prerequisite: prereqSummary },
            // Same pair as the first entry, reported a second time.
            { product: dependentSummary, prerequisite: prereqSummary },
          ],
        }),
      } as Response);

      const { result } = renderHook(
        () => ({ cart: useCart(), prereq: useCartPrerequisites('test-dependents-of-multi.com') }),
        { wrapper: makeWrapper('dependents-of-multi') }
      );

      act(() => { result.current.cart.addItem('dependent-product', 1); });
      await waitFor(() => expect(result.current.prereq.isLoading).toBe(false));

      const dependents = result.current.prereq.dependentsOf('prereq-product');
      expect(dependents).toHaveLength(2);
      expect(dependents).toEqual(
        expect.arrayContaining([dependentSummary, dependentSummary2])
      );
    });

    it('keeps the same function identity across a re-render that does not change `dependencies`', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => makeDependenciesResponse(),
      } as Response);

      const { result, rerender } = renderHook(
        () => ({ cart: useCart(), prereq: useCartPrerequisites('test-dependents-of-stable.com') }),
        { wrapper: makeWrapper('dependents-of-stable') }
      );

      act(() => { result.current.cart.addItem('dependent-product', 1); });
      await waitFor(() => expect(result.current.prereq.isLoading).toBe(false));

      const firstIdentity = result.current.prereq.dependentsOf;
      rerender();
      expect(result.current.prereq.dependentsOf).toBe(firstIdentity);
    });
  });
});
