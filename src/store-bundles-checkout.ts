import type { CartItem } from './types';
import type { CartBundlePriceEntry } from './use-cart-bundle-price';
import type { StoreBundleCheckoutEntry } from './checkout/types';

export type StoreBundlesFragmentRefusal =
  /** A composed line's server price is not loaded (pending, or its last attempt failed): never send a body without the figure. */
  | 'price_not_loaded'
  /** A composed line with a quantity other than 1: a composition is one bundle, copies are not defined. */
  | 'composed_quantity_unsupported';

export type StoreBundlesCheckoutFragment =
  | {
      ok: true;
      /** The cart lines that are NOT composed: these are the checkout request's `items`. The same array when there is no composed line. */
      items: CartItem[];
      /** One entry per composed line, or undefined when the cart has none (nothing is sent). */
      storeBundles: StoreBundleCheckoutEntry[] | undefined;
    }
  | { ok: false; reason: StoreBundlesFragmentRefusal };

/**
 * Splits a cart into the checkout body's `items` and `storeBundles` (v1.11.0). A line carrying a `composition` (an
 * edited store bundle) leaves `items` and becomes `{ items: [{ productSlug, quantity }], expectedTotalMinor }`, where
 * the figure is the server price `useCartBundlePrice`'s `priceFor` returned for that line. The dashboard re-prices the
 * selection itself and refuses the order if its total differs, so this figure is a guard against a changed rule, never
 * a price. A cart with no composed line comes back unchanged.
 */
export function toStoreBundlesCheckoutFragment(
  cartItems: CartItem[],
  priceFor: (slug: string, variantId?: string) => CartBundlePriceEntry
): StoreBundlesCheckoutFragment {
  const composed = cartItems.filter((i) => i.composition);
  if (composed.length === 0) return { ok: true, items: cartItems, storeBundles: undefined };

  const storeBundles: StoreBundleCheckoutEntry[] = [];
  for (const line of composed) {
    if (line.quantity !== 1) return { ok: false, reason: 'composed_quantity_unsupported' };
    const priced = priceFor(line.slug, line.variantId);
    if (priced.status !== 'priced') return { ok: false, reason: 'price_not_loaded' };
    storeBundles.push({
      items: line.composition!.includedItems.map((i) => ({ productSlug: i.slug, quantity: i.quantity })),
      expectedTotalMinor: priced.result.totalMinor,
    });
  }
  return { ok: true, items: cartItems.filter((i) => !i.composition), storeBundles };
}
