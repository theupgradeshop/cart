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

function makeMissingResponse() {
  return {
    missing: [{ product: productSummary, prerequisite: prereqSummary }],
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
});
