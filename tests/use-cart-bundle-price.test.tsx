import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import { CartProvider } from '../src/cart-context';
import { useCartBundlePrice } from '../src/use-cart-bundle-price';

const priceResponse = {
  totalMinor: 9000,
  discountMinor: 1000,
  appliedRuleId: 'rule-1',
  appliedRuleName: 'Starter bundle discount',
  basis: { type: 'per_item_contribution', perItemMinor: 500 },
  suppressionReason: null,
};

// Seeds localStorage with a cart already containing the given items, in the same "new
// format" migrateCartStorage accepts (see tests/migrate-storage.test.ts) — this hook does
// not read/write the cart itself, so a composed line has to arrive via CartProvider's own
// hydration-on-mount path, exactly like a real page load.
function seedCart(storageKey: string, items: unknown[]) {
  localStorage.setItem(storageKey, JSON.stringify(items));
}

function makeWrapper(storageKey: string) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <CartProvider storageKey={storageKey} apiBaseUrl="https://api.test">
        {children}
      </CartProvider>
    );
  };
}

const ordinaryLine = { slug: 'plain-product', quantity: 2 };

const composedLine = {
  slug: 'starter-bundle',
  quantity: 1,
  composition: {
    bundleSlug: 'starter-bundle',
    includedItems: [
      { slug: 'widget-a', quantity: 1 },
      { slug: 'widget-b', quantity: 1 },
    ],
  },
};

const overQuantityLine = {
  slug: 'deluxe-bundle',
  quantity: 1,
  composition: {
    bundleSlug: 'deluxe-bundle',
    includedItems: [
      { slug: 'widget-a', quantity: 2 },
      { slug: 'widget-b', quantity: 1 },
    ],
  },
};

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useCartBundlePrice', () => {
  it('NEGATIVE (with request spy): a cart of ordinary lines, no composition anywhere, triggers no request', async () => {
    seedCart('no-composition', [ordinaryLine, { slug: 'another-plain', quantity: 1 }]);

    const { result } = renderHook(() => useCartBundlePrice('test.com'), {
      wrapper: makeWrapper('no-composition'),
    });

    // Give hydration + any stray async work a tick to (not) happen.
    await new Promise(r => setTimeout(r, 0));

    expect(fetch).not.toHaveBeenCalled();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.priceFor('plain-product')).toEqual({ status: 'not-composed' });
  });

  it('POSITIVE CONTROL for the spy above: a cart with one composed line (all quantities 1) makes exactly one request with the correct body and exposes the total', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => priceResponse,
    } as Response);

    seedCart('one-composed', [composedLine]);

    const { result } = renderHook(() => useCartBundlePrice('test-positive.com'), {
      wrapper: makeWrapper('one-composed'),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await waitFor(() =>
      expect(result.current.priceFor('starter-bundle').status).toBe('priced')
    );

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith('https://api.test/api/public/store/bundle-rules/price', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain: 'test-positive.com', productSlugs: ['widget-a', 'widget-b'] }),
    });

    const entry = result.current.priceFor('starter-bundle');
    expect(entry).toEqual({ status: 'priced', result: priceResponse });
  });

  it('REFUSAL: a composition with an included item of quantity 2 issues no request and is distinguishable from "not loaded yet"', async () => {
    seedCart('over-quantity', [overQuantityLine]);

    const { result } = renderHook(() => useCartBundlePrice('test-refusal.com'), {
      wrapper: makeWrapper('over-quantity'),
    });

    // Give any effect a tick to (not) fire a request.
    await new Promise(r => setTimeout(r, 0));

    expect(fetch).not.toHaveBeenCalled();
    expect(result.current.isLoading).toBe(false);

    const entry = result.current.priceFor('deluxe-bundle');
    expect(entry.status).toBe('unpriceable');
    if (entry.status === 'unpriceable') {
      expect(entry.reason).toMatch(/quantity/i);
    }
    // Distinct from the "still pending" state a priceable-but-unresolved line would report.
    expect(entry.status).not.toBe('not-loaded');
  });

  it('REFUSAL vs PENDING: an unpriceable line and a still-loading priceable line report different statuses side by side', async () => {
    // Never resolves during this test — the priceable line stays pending.
    vi.mocked(fetch).mockReturnValue(new Promise(() => {}));

    seedCart('mixed-refusal-pending', [overQuantityLine, composedLine]);

    const { result } = renderHook(() => useCartBundlePrice('test-mixed.com'), {
      wrapper: makeWrapper('mixed-refusal-pending'),
    });

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));

    expect(result.current.priceFor('deluxe-bundle')).toEqual({
      status: 'unpriceable',
      reason: expect.stringMatching(/quantity/i),
    });
    expect(result.current.priceFor('starter-bundle')).toEqual({ status: 'not-loaded' });
    expect(result.current.isLoading).toBe(true);

    // Only the priceable composition's items were requested — the refused one never
    // contributed to the request body.
    expect(fetch).toHaveBeenCalledWith(
      'https://api.test/api/public/store/bundle-rules/price',
      expect.objectContaining({
        body: JSON.stringify({ domain: 'test-mixed.com', productSlugs: ['widget-a', 'widget-b'] }),
      })
    );
  });

  it('CACHING/DEDUP: two lines sharing the same composition content issue exactly one request', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => priceResponse,
    } as Response);

    const secondLineSameContent = {
      slug: 'starter-bundle-gift',
      quantity: 1,
      composition: {
        bundleSlug: 'starter-bundle',
        includedItems: [
          { slug: 'widget-a', quantity: 1 },
          { slug: 'widget-b', quantity: 1 },
        ],
      },
    };

    seedCart('dedup-two-lines', [composedLine, secondLineSameContent]);

    const { result } = renderHook(() => useCartBundlePrice('test-dedup.com'), {
      wrapper: makeWrapper('dedup-two-lines'),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await waitFor(() => expect(result.current.priceFor('starter-bundle').status).toBe('priced'));

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result.current.priceFor('starter-bundle-gift')).toEqual({
      status: 'priced',
      result: priceResponse,
    });
  });

  it('CACHING/DEDUP: rendering the same composition again after a re-render does not refetch', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => priceResponse,
    } as Response);

    seedCart('dedup-rerender', [composedLine]);

    const { result, rerender } = renderHook(() => useCartBundlePrice('test-dedup-rerender.com'), {
      wrapper: makeWrapper('dedup-rerender'),
    });

    await waitFor(() => expect(result.current.priceFor('starter-bundle').status).toBe('priced'));
    expect(fetch).toHaveBeenCalledTimes(1);

    rerender();
    await new Promise(r => setTimeout(r, 0));

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('CACHING/DEDUP: a second, separately-mounted hook instance pricing the SAME composition reuses the module-scoped cache — no second request', async () => {
    // Distinct from the two tests above: those dedupe WITHIN one effect run
    // (two lines in one mount) or across a re-render of the SAME mount.
    // This exercises the module-scoped `bundlePriceCache` directly — the
    // mechanism that survives a second component mounting the hook (e.g.
    // two cart summaries on one page, or React StrictMode's double-mount)
    // — by mounting a wholly separate hook instance for the same content.
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => priceResponse,
    } as Response);

    seedCart('cross-mount-a', [composedLine]);
    seedCart('cross-mount-b', [composedLine]);

    const first = renderHook(() => useCartBundlePrice('test-cross-mount.com'), {
      wrapper: makeWrapper('cross-mount-a'),
    });
    await waitFor(() => expect(first.result.current.priceFor('starter-bundle').status).toBe('priced'));
    expect(fetch).toHaveBeenCalledTimes(1);

    const second = renderHook(() => useCartBundlePrice('test-cross-mount.com'), {
      wrapper: makeWrapper('cross-mount-b'),
    });
    await waitFor(() => expect(second.result.current.priceFor('starter-bundle').status).toBe('priced'));

    // Same apiBaseUrl + domain + composition content as the first mount — served from the
    // module cache, not a second network call.
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('FAIL-OPEN: a non-ok response yields no price and no thrown error', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
    } as Response);

    seedCart('fail-open-500', [composedLine]);

    const { result } = renderHook(() => useCartBundlePrice('test-500.com'), {
      wrapper: makeWrapper('fail-open-500'),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.priceFor('starter-bundle')).toEqual({ status: 'not-loaded' });
  });

  it('FAIL-OPEN: a thrown fetch yields no price and no thrown error', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('Network error'));

    seedCart('fail-open-throw', [composedLine]);

    const { result } = renderHook(() => useCartBundlePrice('test-throw.com'), {
      wrapper: makeWrapper('fail-open-throw'),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.priceFor('starter-bundle')).toEqual({ status: 'not-loaded' });
  });

  it('FAIL-OPEN: an unparseable body yields no price and no thrown error', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => {
        throw new SyntaxError('Unexpected token in JSON');
      },
    } as unknown as Response);

    seedCart('fail-open-unparseable', [composedLine]);

    const { result } = renderHook(() => useCartBundlePrice('test-unparseable.com'), {
      wrapper: makeWrapper('fail-open-unparseable'),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.priceFor('starter-bundle')).toEqual({ status: 'not-loaded' });
  });

  it('never calls addItem or removeItem', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => priceResponse,
    } as Response);

    seedCart('read-only', [composedLine]);

    const { result } = renderHook(
      () => ({ bundlePrice: useCartBundlePrice('test-read-only.com') }),
      { wrapper: makeWrapper('read-only') }
    );

    await waitFor(() => expect(result.current.bundlePrice.isLoading).toBe(false));

    // The hook's return value carries no addItem/removeItem of its own.
    expect((result.current.bundlePrice as Record<string, unknown>).addItem).toBeUndefined();
    expect((result.current.bundlePrice as Record<string, unknown>).removeItem).toBeUndefined();
  });

  it('an unknown slug reports not-composed rather than throwing', async () => {
    seedCart('unknown-slug', [ordinaryLine]);

    const { result } = renderHook(() => useCartBundlePrice('test-unknown.com'), {
      wrapper: makeWrapper('unknown-slug'),
    });

    expect(() => result.current.priceFor('no-such-slug')).not.toThrow();
    expect(result.current.priceFor('no-such-slug')).toEqual({ status: 'not-composed' });
  });
});
