import { ComposedCourseBundleCartItem } from './types';

/**
 * Turns the cart's composed-course-bundle line (if any) into the checkout body fragment
 * the dashboard's checkout route expects — `{ composedBundle: { courseIds } }`. Returns
 * `undefined` when there is no such line, so a caller can spread the result straight into
 * its checkout request body (`{ ...otherFields, ...toComposedBundleCheckoutFragment(bundle) }`)
 * without an `if` at the call site.
 */
export function toComposedBundleCheckoutFragment(
  composedBundle: ComposedCourseBundleCartItem | null | undefined
): { composedBundle: { courseIds: string[] } } | undefined {
  if (!composedBundle) return undefined;
  return { composedBundle: { courseIds: composedBundle.courseIds } };
}
