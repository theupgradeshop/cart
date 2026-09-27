// Public API — only these are accessible to consumers
export { CartProvider, useCart } from './cart-context';
export { useCartProducts } from './use-cart-products';
export { useCartSuggestions } from './use-cart-suggestions';
export { useCartPrerequisites } from './use-cart-prerequisites';
export type { MissingPrerequisite, PrerequisiteProduct } from './use-cart-prerequisites';
export { useCartBundlePrice } from './use-cart-bundle-price';
export type { CartBundlePriceResult, CartBundlePriceEntry } from './use-cart-bundle-price';
export type {
  CartItem,
  CartItemComposition,
  ComposedCourseBundleCartItem,
  CartProduct,
  CartContextValue,
  ProductVariant,
  CartSuggestion,
  CartSuggestionProduct,
  CartSuggestionType,
  CartSuggestionsResponse,
} from './types';
export { toComposedBundleCheckoutFragment } from './composed-bundle';

// Bundle pricing engine (courses-bundles storefront spec, U3) — pure, mirrors the
// dashboard's server evaluator + guard exactly. See src/bundle-engine.ts.
export {
  quoteOne,
  quote,
  next,
  fixedQuote,
} from './bundle-engine';
export type {
  CountTier,
  FixedPriceTier,
  RuleOffer,
  FixedOffer,
  BundleOffer,
  CourseDetail,
  CoursesById,
  MatchedTierBasis,
  FlatPercentageBasis,
  PerItemBasis,
  EvaluationBasis,
  Gap,
  Quote as BundleQuote,
  Nudge as BundleNudge,
  FixedQuote as BundleFixedQuote,
} from './bundle-engine';

export { useBundleOffer } from './use-bundle-offer';
export type {
  BundleOfferStatus,
  BundleOfferResponse,
  UseBundleOfferResult,
} from './use-bundle-offer';

// Bundle builder presets (D8/D10, courses-bundles storefront spec Round 2, Unit R3) —
// pure helpers mirroring the presets design reference's derived state and actions.
// See src/bundle-presets.ts.
export {
  sameSet,
  presetSelection,
  presetOwned,
  derivePresetState,
  quotePreset,
  resolveCheckoutSelection,
} from './bundle-presets';
export type { OfferPreset, PresetDerivedState } from './bundle-presets';
