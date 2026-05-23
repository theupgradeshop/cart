import { CartItem } from './types';

/**
 * Reads a raw localStorage string and returns CartItem[] in the current format.
 * Handles two legacy formats:
 *   - Bomdia/HealthisCreation: [{ product: { slug, price, ... }, quantity, itemKey }]
 *   - Camoflash: [{ slug, name, price, image, quantity }]
 * If the data is already in new format [{ slug, quantity }], passes through unchanged.
 */
export function migrateCartStorage(raw: string | null): CartItem[] {
  if (!raw) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed) || parsed.length === 0) return [];

  const first = parsed[0] as Record<string, unknown>;

  // Bomdia/HealthisCreation: { product: { slug, price, variantId? }, quantity, itemKey }
  if (first.product && typeof (first.product as Record<string, unknown>).slug === 'string') {
    return (parsed as Array<Record<string, unknown>>)
      .filter(item => {
        const product = item.product as Record<string, unknown>;
        return typeof product?.slug === 'string' && typeof item.quantity === 'number' && (item.quantity as number) > 0;
      })
      .map(item => {
        const product = item.product as Record<string, unknown>;
        const result: CartItem = {
          slug: product.slug as string,
          quantity: item.quantity as number,
        };
        if (typeof product.variantId === 'string') result.variantId = product.variantId;
        return result;
      });
  }

  // Camoflash: { slug, name, price, image, quantity }
  if (typeof first.slug === 'string' && typeof first.price === 'number') {
    return (parsed as Array<Record<string, unknown>>)
      .filter(item => typeof item.slug === 'string' && typeof item.quantity === 'number' && (item.quantity as number) > 0)
      .map(item => ({ slug: item.slug as string, quantity: item.quantity as number }));
  }

  // New format: { slug, quantity, variantId? }
  if (typeof first.slug === 'string' && typeof first.quantity === 'number') {
    return (parsed as Array<Record<string, unknown>>)
      .filter(item => typeof item.slug === 'string' && typeof item.quantity === 'number' && (item.quantity as number) > 0)
      .map(item => {
        const result: CartItem = { slug: item.slug as string, quantity: item.quantity as number };
        if (typeof item.variantId === 'string') result.variantId = item.variantId;
        return result;
      });
  }

  return [];
}
