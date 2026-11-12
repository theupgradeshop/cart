import { describe, it, expect } from 'vitest';
import { toStoreBundlesCheckoutFragment } from '../src/store-bundles-checkout';
import { buildCartDoorBody } from '../src/checkout/bodies';
import type { CartItem } from '../src/types';
import type { CartBundlePriceEntry } from '../src/use-cart-bundle-price';
import type { StartCartCheckoutInput } from '../src/checkout/types';

const priced = (totalMinor: number): CartBundlePriceEntry => ({
  status: 'priced',
  result: { totalMinor, discountMinor: 0, appliedRuleId: null, appliedRuleName: null, basis: null, suppressionReason: null },
});
const composedLine = (over: Partial<CartItem> = {}): CartItem => ({
  slug: 'duo',
  quantity: 1,
  composition: { bundleSlug: 'duo', includedItems: [{ slug: 'mug', quantity: 3 }, { slug: 'cap', quantity: 1 }] },
  ...over,
});
const plain: CartItem = { slug: 'tee', quantity: 2 };

describe('toStoreBundlesCheckoutFragment', () => {
  it('a cart with no composed line is returned unchanged and sends nothing', () => {
    const items = [plain];
    const priceFor = () => {
      throw new Error('must not look up a price');
    };
    const r = toStoreBundlesCheckoutFragment(items, priceFor);
    expect(r).toEqual({ ok: true, items, storeBundles: undefined });
    if (r.ok) expect(r.items).toBe(items);
  });

  it('moves a composed line out of items into storeBundles with the shown total', () => {
    const r = toStoreBundlesCheckoutFragment([plain, composedLine()], (slug) => (slug === 'duo' ? priced(1750) : { status: 'not-composed' }));
    expect(r).toEqual({
      ok: true,
      items: [plain],
      storeBundles: [{ items: [{ productSlug: 'mug', quantity: 3 }, { productSlug: 'cap', quantity: 1 }], expectedTotalMinor: 1750 }],
    });
  });

  it('refuses to build a body without the figure (price not loaded)', () => {
    expect(toStoreBundlesCheckoutFragment([composedLine()], () => ({ status: 'not-loaded' }))).toEqual({ ok: false, reason: 'price_not_loaded' });
  });

  it('refuses a composed line whose quantity is not 1', () => {
    expect(toStoreBundlesCheckoutFragment([composedLine({ quantity: 2 })], () => priced(1))).toEqual({ ok: false, reason: 'composed_quantity_unsupported' });
  });
});

describe('buildCartDoorBody storeBundles', () => {
  const cart = (over: Partial<StartCartCheckoutInput> = {}): StartCartCheckoutInput => ({
    door: 'cart', domain: 'shop.test', apiBaseUrl: 'https://api.test',
    customer: { email: 'a@example.test', firstName: 'A' }, items: [{ productSlug: 'p', quantity: 1 }],
    successUrl: 'https://shop.test/ty', cancelUrl: 'https://shop.test/c', thankYouPath: '/ty', ...over,
  });

  it('absent or empty: bytes identical to a cart that never heard of storeBundles', () => {
    const base = JSON.stringify(buildCartDoorBody(cart()));
    expect(JSON.stringify(buildCartDoorBody(cart({ storeBundles: [] })))).toBe(base);
    expect(base).not.toContain('storeBundles');
  });

  it('present: sent right after items', () => {
    const sb = [{ items: [{ productSlug: 'mug', quantity: 2 }], expectedTotalMinor: 900 }];
    const body = buildCartDoorBody(cart({ storeBundles: sb }));
    expect(body.storeBundles).toEqual(sb);
    expect(Object.keys(body).indexOf('storeBundles')).toBe(Object.keys(body).indexOf('items') + 1);
  });
});
