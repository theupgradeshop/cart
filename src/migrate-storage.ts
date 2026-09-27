import { CartItem, CartItemComposition, ComposedCourseBundleCartItem } from './types';

/**
 * Runtime guard for a stored `composition` value — a stored cart line is untrusted input,
 * so a shape that doesn't match `CartItemComposition` (missing/legacy/corrupted) is dropped
 * rather than passed through as-is.
 */
function isValidComposition(value: unknown): value is CartItemComposition {
  if (typeof value !== 'object' || value === null) return false;
  const composition = value as Record<string, unknown>;
  if (typeof composition.bundleSlug !== 'string') return false;
  if (!Array.isArray(composition.includedItems)) return false;
  return composition.includedItems.every(
    item =>
      typeof item === 'object' &&
      item !== null &&
      typeof (item as Record<string, unknown>).slug === 'string' &&
      typeof (item as Record<string, unknown>).quantity === 'number'
  );
}

/** Runtime guard for a stored `composedBundle` value — same untrusted-input posture as above. */
function isValidComposedBundle(value: unknown): value is ComposedCourseBundleCartItem {
  if (typeof value !== 'object' || value === null) return false;
  const bundle = value as Record<string, unknown>;
  if (bundle.kind !== 'composed-course-bundle') return false;
  if (typeof bundle.ruleId !== 'string') return false;
  if (typeof bundle.title !== 'string') return false;
  if (!Array.isArray(bundle.courseIds)) return false;
  return bundle.courseIds.every(id => typeof id === 'string');
}

/** Migrates one raw item-array (any of the three known array formats) into current-format `CartItem[]`. */
function migrateItemsArray(parsed: Array<Record<string, unknown>>): CartItem[] {
  if (parsed.length === 0) return [];
  const first = parsed[0];

  // Bomdia/HealthisCreation: { product: { slug, price, variantId? }, quantity, itemKey }
  if (first.product && typeof (first.product as Record<string, unknown>).slug === 'string') {
    return parsed
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
    return parsed
      .filter(item => typeof item.slug === 'string' && typeof item.quantity === 'number' && (item.quantity as number) > 0)
      .map(item => ({ slug: item.slug as string, quantity: item.quantity as number }));
  }

  // New format: { slug, quantity, variantId?, composition? }
  if (typeof first.slug === 'string' && typeof first.quantity === 'number') {
    return parsed
      .filter(item => typeof item.slug === 'string' && typeof item.quantity === 'number' && (item.quantity as number) > 0)
      .map(item => {
        const result: CartItem = { slug: item.slug as string, quantity: item.quantity as number };
        if (typeof item.variantId === 'string') result.variantId = item.variantId;
        if (isValidComposition(item.composition)) result.composition = item.composition;
        return result;
      });
  }

  return [];
}

export interface MigratedCart {
  items: CartItem[];
  composedBundle: ComposedCourseBundleCartItem | null;
}

/**
 * Reads a raw localStorage string and returns `{ items, composedBundle }` in the current
 * format. Handles two legacy array formats plus the current one:
 *   - Bomdia/HealthisCreation: [{ product: { slug, price, ... }, quantity, itemKey }]
 *   - Camoflash: [{ slug, name, price, image, quantity }]
 *   - Pre-composed-bundle current format: [{ slug, quantity, variantId?, composition? }]
 * Every one of the above is a bare JSON ARRAY at the top level, written before the
 * composed-course-bundle cart line (U3) existed — none of them ever carried one, so each
 * always migrates to `composedBundle: null`. This is the backward-compatibility guarantee:
 * an old stored cart loads with exactly the items it always had, nothing more.
 *
 * The current format (courses-bundles storefront spec, U3 onward) is a top-level OBJECT,
 * `{ items: [...], composedBundle: {...}|null }` -- `composedBundle` lives outside `items`
 * (see the doc comment on `ComposedCourseBundleCartItem` in `src/types.ts` for why it's a
 * sibling rather than folded into the items array), so an already-current cart just needs
 * its `composedBundle` picked out and validated the same way `composition` is above.
 */
export function migrateCartStorage(raw: string | null): MigratedCart {
  if (!raw) return { items: [], composedBundle: null };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { items: [], composedBundle: null };
  }

  // Current envelope format: { items: [...], composedBundle: {...}|null }
  if (
    !Array.isArray(parsed) &&
    typeof parsed === 'object' &&
    parsed !== null &&
    Array.isArray((parsed as Record<string, unknown>).items)
  ) {
    const envelope = parsed as Record<string, unknown>;
    const items = migrateItemsArray(envelope.items as Array<Record<string, unknown>>);
    const composedBundle = isValidComposedBundle(envelope.composedBundle) ? envelope.composedBundle : null;
    return { items, composedBundle };
  }

  if (!Array.isArray(parsed) || parsed.length === 0) return { items: [], composedBundle: null };

  return { items: migrateItemsArray(parsed as Array<Record<string, unknown>>), composedBundle: null };
}
