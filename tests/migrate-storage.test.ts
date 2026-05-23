// tests/migrate-storage.test.ts
import { describe, it, expect } from 'vitest';
import { migrateCartStorage } from '../src/migrate-storage';

describe('migrateCartStorage', () => {
  it('returns [] for null', () => {
    expect(migrateCartStorage(null)).toEqual([]);
  });

  it('returns [] for invalid JSON', () => {
    expect(migrateCartStorage('not-json')).toEqual([]);
  });

  it('returns [] for empty array', () => {
    expect(migrateCartStorage('[]')).toEqual([]);
  });

  it('migrates Bomdia/HealthisCreation format — { product: { slug, price }, quantity, itemKey }', () => {
    const raw = JSON.stringify([
      { product: { slug: 'south-portugal-10-days', price: 180, name: 'דרום פורטוגל' }, quantity: 2, itemKey: 'south-portugal-10-days' },
      { product: { slug: 'lisbon-guide', price: 50, name: 'מדריך ליסבון' }, quantity: 1, itemKey: 'lisbon-guide' },
    ]);
    expect(migrateCartStorage(raw)).toEqual([
      { slug: 'south-portugal-10-days', quantity: 2 },
      { slug: 'lisbon-guide', quantity: 1 },
    ]);
  });

  it('migrates Bomdia format — preserves variantId when present', () => {
    const raw = JSON.stringify([
      { product: { slug: 'tour-a', price: 200, variantId: 'v-small' }, quantity: 1, itemKey: 'tour-a::v-small' },
    ]);
    expect(migrateCartStorage(raw)).toEqual([{ slug: 'tour-a', quantity: 1, variantId: 'v-small' }]);
  });

  it('migrates Camoflash format — { slug, name, price, image, quantity }', () => {
    const raw = JSON.stringify([
      { slug: 'necklace-gold', name: 'שרשרת זהב', price: 250, image: '/img.jpg', quantity: 1 },
      { slug: 'ring-silver', name: 'טבעת כסף', price: 180, image: '/ring.jpg', quantity: 2 },
    ]);
    expect(migrateCartStorage(raw)).toEqual([
      { slug: 'necklace-gold', quantity: 1 },
      { slug: 'ring-silver', quantity: 2 },
    ]);
  });

  it('passes through new format unchanged', () => {
    const raw = JSON.stringify([
      { slug: 'product-a', quantity: 3 },
      { slug: 'product-b', quantity: 1, variantId: 'v1' },
    ]);
    expect(migrateCartStorage(raw)).toEqual([
      { slug: 'product-a', quantity: 3 },
      { slug: 'product-b', quantity: 1, variantId: 'v1' },
    ]);
  });

  it('filters out items with quantity <= 0', () => {
    const raw = JSON.stringify([
      { product: { slug: 'a', price: 100 }, quantity: 0, itemKey: 'a' },
      { product: { slug: 'b', price: 50 }, quantity: 1, itemKey: 'b' },
    ]);
    expect(migrateCartStorage(raw)).toEqual([{ slug: 'b', quantity: 1 }]);
  });

  it('filters out items with missing slug', () => {
    const raw = JSON.stringify([
      { product: { price: 100 }, quantity: 1, itemKey: 'no-slug' },
    ]);
    expect(migrateCartStorage(raw)).toEqual([]);
  });
});
