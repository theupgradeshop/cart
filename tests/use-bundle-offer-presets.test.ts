// tests/use-bundle-offer-presets.test.ts
//
// Hook-level tests for the preset actions `useBundleOffer` exposes (D8, R3):
// `preset`, `setPreset`, `takePreset`, `buildOwn`, `undoChanges`. Pricing/derived-state
// math itself is covered by tests/bundle-presets.test.ts — this asserts the wiring:
// state transitions, and the reset on `url` change.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useBundleOffer } from '../src/use-bundle-offer';
import type { BundleOfferResponse } from '../src/use-bundle-offer';

const course = (id: string, listPriceMinor: number) => ({
  id,
  title: id,
  slug: id,
  imageUrl: null,
  listPriceMinor,
  productSlug: null,
});

const swapPreset = { id: 'p-swap', name: 'Starter pick', ids: ['a', 'b', 'c'], swap: true };
const lockedPreset = { id: 'p-locked', name: 'Set pick', ids: ['a', 'b', 'c'], swap: false };

function liveResponse(overrides: Partial<BundleOfferResponse> = {}): BundleOfferResponse {
  return {
    status: 'live',
    currency: 'ILS',
    offer: {
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
      presets: [swapPreset, lockedPreset],
    },
    courses: [course('a', 1000), course('b', 1000), course('c', 1000), course('d', 1000), course('e', 1000)],
    alts: [],
    owned: [],
    ...overrides,
  } as BundleOfferResponse;
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useBundleOffer — presets', () => {
  it('exposes the presets from the fetched rule offer', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => liveResponse() } as Response);

    const { result } = renderHook(() => useBundleOffer('/api/bundles/rule/rule-1'));

    await waitFor(() => expect(result.current.status).toBe('live'));
    expect(result.current.presets).toEqual([swapPreset, lockedPreset]);
    expect(result.current.preset).toBeNull();
  });

  it('takePreset on a swappable preset: sets preset and seeds sel to preset.ids minus owned', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => liveResponse({ owned: ['b'] }),
    } as Response);

    const { result } = renderHook(() => useBundleOffer('/api/bundles/rule/rule-1'));
    await waitFor(() => expect(result.current.status).toBe('live'));

    act(() => { result.current.takePreset('p-swap'); });
    expect(result.current.preset).toBe('p-swap');
    expect(result.current.sel.slice().sort()).toEqual(['a', 'c']); // 'b' dropped — already owned
  });

  it('takePreset on a non-swappable (locked) preset: sets preset and clears sel to []', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => liveResponse() } as Response);

    const { result } = renderHook(() => useBundleOffer('/api/bundles/rule/rule-1'));
    await waitFor(() => expect(result.current.status).toBe('live'));

    act(() => { result.current.takePreset('p-locked'); });
    expect(result.current.preset).toBe('p-locked');
    expect(result.current.sel).toEqual([]);
  });

  it('buildOwn on an untouched preset clears both preset and sel', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => liveResponse() } as Response);

    const { result } = renderHook(() => useBundleOffer('/api/bundles/rule/rule-1'));
    await waitFor(() => expect(result.current.status).toBe('live'));

    act(() => { result.current.takePreset('p-swap'); });
    expect(result.current.sel.length).toBe(3);

    act(() => { result.current.buildOwn(); });
    expect(result.current.preset).toBeNull();
    expect(result.current.sel).toEqual([]);
  });

  it('buildOwn keeps an edited (mine) selection instead of clearing it', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => liveResponse() } as Response);

    const { result } = renderHook(() => useBundleOffer('/api/bundles/rule/rule-1'));
    await waitFor(() => expect(result.current.status).toBe('live'));

    act(() => { result.current.takePreset('p-swap'); });
    expect(result.current.sel.length).toBe(3);

    // Edit away from the preset's exact selection — now "mine".
    act(() => { result.current.setSel(['a', 'b']); });
    expect(result.current.sel).toEqual(['a', 'b']);

    act(() => { result.current.buildOwn(); });
    expect(result.current.preset).toBeNull();
    // The edited selection survives — buildOwn only clears an UNTOUCHED preset's sel.
    expect(result.current.sel).toEqual(['a', 'b']);
  });

  it('buildOwn is a no-op when no preset is active', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => liveResponse() } as Response);

    const { result } = renderHook(() => useBundleOffer('/api/bundles/rule/rule-1'));
    await waitFor(() => expect(result.current.status).toBe('live'));

    act(() => { result.current.setSel(['d', 'e']); });
    expect(result.current.sel).toEqual(['d', 'e']);

    act(() => { result.current.buildOwn(); });
    expect(result.current.preset).toBeNull();
    expect(result.current.sel).toEqual(['d', 'e']); // untouched, not cleared
  });

  it('undoChanges resets sel back to the preset\'s own selection when the selection is "mine"', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => liveResponse() } as Response);

    const { result } = renderHook(() => useBundleOffer('/api/bundles/rule/rule-1'));
    await waitFor(() => expect(result.current.status).toBe('live'));

    act(() => { result.current.takePreset('p-swap'); });
    expect(result.current.sel.length).toBe(3);

    act(() => { result.current.setSel(['a']); });
    expect(result.current.sel).toEqual(['a']);

    act(() => { result.current.undoChanges(); });
    expect(result.current.sel.slice().sort()).toEqual(['a', 'b', 'c']);
    expect(result.current.preset).toBe('p-swap'); // preset itself was never cleared
  });

  it('undoChanges is a no-op when the selection is not "mine" (e.g. no preset active)', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => liveResponse() } as Response);

    const { result } = renderHook(() => useBundleOffer('/api/bundles/rule/rule-1'));
    await waitFor(() => expect(result.current.status).toBe('live'));

    act(() => { result.current.setSel(['d']); });
    expect(result.current.sel).toEqual(['d']);

    act(() => { result.current.undoChanges(); });
    expect(result.current.sel).toEqual(['d']); // unchanged
  });

  it('resets preset and sel when the url changes', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => liveResponse() } as Response);

    const { result, rerender } = renderHook(({ url }) => useBundleOffer(url), {
      initialProps: { url: '/api/bundles/rule/rule-1' },
    });
    await waitFor(() => expect(result.current.status).toBe('live'));

    act(() => { result.current.takePreset('p-swap'); });
    expect(result.current.preset).toBe('p-swap');

    rerender({ url: '/api/bundles/rule/rule-2' });
    await waitFor(() => expect(result.current.status).toBe('live'));
    expect(result.current.preset).toBeNull();
    expect(result.current.sel).toEqual([]);
  });
});
