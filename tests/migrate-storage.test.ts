// tests/migrate-storage.test.ts
import { describe, it, expect } from 'vitest';
import { migrateCartStorage } from '../src/migrate-storage';

describe('migrateCartStorage', () => {
  it('returns { items: [], composedBundle: null } for null', () => {
    expect(migrateCartStorage(null)).toEqual({ items: [], composedBundle: null });
  });

  it('returns { items: [], composedBundle: null } for invalid JSON', () => {
    expect(migrateCartStorage('not-json')).toEqual({ items: [], composedBundle: null });
  });

  it('returns { items: [], composedBundle: null } for empty array', () => {
    expect(migrateCartStorage('[]')).toEqual({ items: [], composedBundle: null });
  });

  it('migrates Bomdia/HealthisCreation format — { product: { slug, price }, quantity, itemKey }', () => {
    const raw = JSON.stringify([
      { product: { slug: 'south-portugal-10-days', price: 180, name: 'דרום פורטוגל' }, quantity: 2, itemKey: 'south-portugal-10-days' },
      { product: { slug: 'lisbon-guide', price: 50, name: 'מדריך ליסבון' }, quantity: 1, itemKey: 'lisbon-guide' },
    ]);
    expect(migrateCartStorage(raw)).toEqual({
      items: [
        { slug: 'south-portugal-10-days', quantity: 2 },
        { slug: 'lisbon-guide', quantity: 1 },
      ],
      composedBundle: null,
    });
  });

  it('migrates Bomdia format — preserves variantId when present', () => {
    const raw = JSON.stringify([
      { product: { slug: 'tour-a', price: 200, variantId: 'v-small' }, quantity: 1, itemKey: 'tour-a::v-small' },
    ]);
    expect(migrateCartStorage(raw)).toEqual({
      items: [{ slug: 'tour-a', quantity: 1, variantId: 'v-small' }],
      composedBundle: null,
    });
  });

  it('migrates Camoflash format — { slug, name, price, image, quantity }', () => {
    const raw = JSON.stringify([
      { slug: 'necklace-gold', name: 'שרשרת זהב', price: 250, image: '/img.jpg', quantity: 1 },
      { slug: 'ring-silver', name: 'טבעת כסף', price: 180, image: '/ring.jpg', quantity: 2 },
    ]);
    expect(migrateCartStorage(raw)).toEqual({
      items: [
        { slug: 'necklace-gold', quantity: 1 },
        { slug: 'ring-silver', quantity: 2 },
      ],
      composedBundle: null,
    });
  });

  it('passes through new format unchanged', () => {
    const raw = JSON.stringify([
      { slug: 'product-a', quantity: 3 },
      { slug: 'product-b', quantity: 1, variantId: 'v1' },
    ]);
    expect(migrateCartStorage(raw)).toEqual({
      items: [
        { slug: 'product-a', quantity: 3 },
        { slug: 'product-b', quantity: 1, variantId: 'v1' },
      ],
      composedBundle: null,
    });
  });

  it('filters out items with quantity <= 0', () => {
    const raw = JSON.stringify([
      { product: { slug: 'a', price: 100 }, quantity: 0, itemKey: 'a' },
      { product: { slug: 'b', price: 50 }, quantity: 1, itemKey: 'b' },
    ]);
    expect(migrateCartStorage(raw)).toEqual({ items: [{ slug: 'b', quantity: 1 }], composedBundle: null });
  });

  it('filters out items with missing slug', () => {
    const raw = JSON.stringify([
      { product: { price: 100 }, quantity: 1, itemKey: 'no-slug' },
    ]);
    expect(migrateCartStorage(raw)).toEqual({ items: [], composedBundle: null });
  });

  // --- composition (U6.1 / D2 as amended) ---------------------------------------------
  //
  // The published version (commit 92033c3f) never wrote a `composition` key — it stored
  // exactly `{ slug, quantity, variantId? }` via `localStorage.setItem(storageKey,
  // JSON.stringify(items))`. This is a LITERAL fixture of that shape, not a round-trip
  // through the new code — a round-trip can't prove the new code still reads the old one.
  it('deserializes a literal fixture of the published (pre-composition) format with no error, no lost line, and composition undefined', () => {
    const raw = '[{"slug":"product-a","quantity":2},{"slug":"product-b","quantity":1,"variantId":"v1"}]';
    const result = migrateCartStorage(raw);

    expect(result.items).toHaveLength(2);
    expect(result.items[0].composition).toBeUndefined();
    expect(result.items[1].composition).toBeUndefined();
    expect(result).toEqual({
      items: [
        { slug: 'product-a', quantity: 2 },
        { slug: 'product-b', quantity: 1, variantId: 'v1' },
      ],
      composedBundle: null,
    });
  });

  // The reverse direction (plan objection 10): a cart the NEW code wrote, carrying a
  // composition, must also survive migrateCartStorage without losing the composition or
  // its per-included-item quantities.
  it('preserves a composition, including per-included-item quantity, through the new-format branch (reverse direction)', () => {
    const composition = {
      bundleSlug: 'starter-bundle',
      includedItems: [
        { slug: 'item-a', quantity: 2 },
        { slug: 'item-b', quantity: 1 },
      ],
    };
    const raw = JSON.stringify([{ slug: 'starter-bundle', quantity: 1, composition }]);
    const result = migrateCartStorage(raw);

    expect(result.items[0].composition?.includedItems).toEqual(composition.includedItems);
    expect(result).toEqual({ items: [{ slug: 'starter-bundle', quantity: 1, composition }], composedBundle: null });
  });

  it('drops a malformed composition (missing includedItems) rather than passing it through', () => {
    const raw = JSON.stringify([{ slug: 'bad', quantity: 1, composition: { bundleSlug: 'x' } }]);
    const result = migrateCartStorage(raw);

    expect(result.items[0].composition).toBeUndefined();
  });

  // --- composedBundle (U3, courses-bundles storefront spec) ---------------------------

  it('a stored cart with no composedBundle (pre-U3 current format) still loads its items unchanged, composedBundle null', () => {
    const raw = JSON.stringify({ items: [{ slug: 'product-a', quantity: 1 }] });
    expect(migrateCartStorage(raw)).toEqual({
      items: [{ slug: 'product-a', quantity: 1 }],
      composedBundle: null,
    });
  });

  it('round-trips a valid composedBundle through the envelope format', () => {
    const composedBundle = {
      kind: 'composed-course-bundle' as const,
      ruleId: 'rule-1',
      courseIds: ['course-a', 'course-b'],
      title: 'Starter track',
    };
    const raw = JSON.stringify({ items: [], composedBundle });
    expect(migrateCartStorage(raw)).toEqual({ items: [], composedBundle });
  });

  it('keeps ordinary items and composedBundle side by side in the envelope format', () => {
    const composedBundle = {
      kind: 'composed-course-bundle' as const,
      ruleId: 'rule-1',
      courseIds: ['course-a'],
      title: 'Starter track',
    };
    const raw = JSON.stringify({ items: [{ slug: 'product-a', quantity: 2 }], composedBundle });
    expect(migrateCartStorage(raw)).toEqual({
      items: [{ slug: 'product-a', quantity: 2 }],
      composedBundle,
    });
  });

  it('drops a malformed composedBundle (missing courseIds) rather than passing it through', () => {
    const raw = JSON.stringify({ items: [], composedBundle: { kind: 'composed-course-bundle', ruleId: 'r1', title: 't' } });
    expect(migrateCartStorage(raw)).toEqual({ items: [], composedBundle: null });
  });

  it('drops a composedBundle with the wrong kind discriminator', () => {
    const raw = JSON.stringify({
      items: [],
      composedBundle: { kind: 'something-else', ruleId: 'r1', title: 't', courseIds: ['a'] },
    });
    expect(migrateCartStorage(raw)).toEqual({ items: [], composedBundle: null });
  });

  it('treats a null composedBundle in the envelope format as no composed bundle', () => {
    const raw = JSON.stringify({ items: [{ slug: 'product-a', quantity: 1 }], composedBundle: null });
    expect(migrateCartStorage(raw)).toEqual({
      items: [{ slug: 'product-a', quantity: 1 }],
      composedBundle: null,
    });
  });
});
