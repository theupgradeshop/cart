# @upgradeshop/cart

ID-only cart state management with live price fetching for Upgrade Shop
customer websites. The cart itself only ever stores product lines
(`{ slug, quantity, variantId?, composition? }`) plus, since U3, at most one
composed-course-bundle line, as `{ items, composedBundle }` in
`localStorage` — no price, no name, nothing that can go stale. Live product
data (price, name, images, availability) is fetched separately and merged in
at read time.

Consumed by pinned git ref from each customer site's `package.json` (e.g.
`github:theupgradeshop/cart#<sha>` or `#v1.0.1`) — see
`wiki/cross-cutting/customer-site-parent-addon-gate.md` for the current pin
table. **Bumping a site's pin is a separate, deliberate step per site — a
change landing here does not reach any site until that happens.**

## `CartItem.composition`

`composition` is an **optional** field on `CartItem` (`src/types.ts`). It is
absent on every ordinary line, and absent on every line stored before this
field existed — `migrateCartStorage` (`src/migrate-storage.ts`) only ever adds
it when the stored value already carries a valid one, so an old cart (or any
cart on a site that never touches bundles) deserializes with `composition:
undefined`, never `null` and never `{}`.

```ts
composition?: {
  bundleSlug: string;
  includedItems: Array<{ slug: string; quantity: number }>;
}
```

It records the actual contents of a bundle line when they differ from the
bundle's default definition — an item swapped out, removed, or added. Each
included item carries its own **quantity**, not bare membership
(`includedItemSlugs: string[]` was rejected for exactly this reason): a
bundle item's quantity in `product_bundle_items` is 1 on every row today, but
nothing about the schema guarantees that stays true, so the shape has to
express it from the start rather than needing a second migration later.

This unit (U6.1) only lands the shape and its backward compatibility —
nothing yet writes a `composition`. Building a bundle editor is still out of
scope; **U6.2 (`useCartBundlePrice`, below) adds read-only pricing for a line
that already carries one.**

## Exports

- `CartProvider`, `useCart` (`src/cart-context.tsx`) — the cart itself:
  `items`, `addItem`, `removeItem`, `updateQuantity`, `clearCart`,
  `openCart`/`closeCart`/`toggleCart`, `itemCount`.
- `useCartProducts(domain)` (`src/use-cart-products.ts`) — merges the cart's
  slugs with live product data from `GET /api/public/products`.
  Each product also carries `product_type` and `contains_physical_product`
  (v1.4.1; the list's snake_case names, the single-product fallback's camelCase
  read into the same shape), so a site can decide on a shipping-address block.
- `toComposedBundleCheckoutFragment(bundle)` (`src/composed-bundle.ts`) —
  see "Composed course bundle" below.
- Bundle pricing engine (`src/bundle-engine.ts`) and `useBundleOffer`
  (`src/use-bundle-offer.ts`) — see "Course bundle pricing engine" below.
- `useCartSuggestions(domain)` (`src/use-cart-suggestions.ts`) — cross-sell /
  upsell / bundle-upgrade suggestions from
  `GET /api/public/cart/suggestions`, plus `applySuggestion`.
- `useCartPrerequisites(domain, buyerEmail?)` (`src/use-cart-prerequisites.ts`)
  — see below.
- `useCartBundlePrice(domain)` (`src/use-cart-bundle-price.ts`) — see below.

All hooks must be used inside a `<CartProvider>` and throw if they aren't.

## `useCartPrerequisites(domain, buyerEmail?)`

Checks the cart's contents against `POST /api/public/cart/prerequisites`
(dashboard) and **auto-adds** any missing prerequisite product straight into
the cart, surfacing what it added so the consuming site can render a notice.

```ts
const { missing, autoAdded, dependencies, dependentsOf, isLoading, error } = useCartPrerequisites(domain, buyerEmail);
```

- `missing` — every `{ product, prerequisite }` pair the endpoint currently
  reports as unsatisfied (product summaries: `{ id, name, slug, price,
  images }`).
- `autoAdded` — the subset of `missing` this hook has actually added to the
  cart during this mounted instance. **This does not survive a remount** —
  it resets to `[]` on the next page load or navigation even though the
  prerequisite it added is still sitting in the cart, so it cannot answer
  "why is this in my cart" after a reload. Kept because it is still correct
  for the same-mount case (the notice a buyer sees right after the add
  happens).
- `dependencies` — one entry per product already in the cart whose required
  prerequisite is ALSO in the cart, `{ product, prerequisite }` where
  `product` is the dependent item and `prerequisite` is what it requires.
  This is a catalogue relation computed by the server from the cart's
  current contents on every request, not a record of who added what — so,
  unlike `autoAdded`, it is populated the same way on every mount, including
  after a reload or a fresh page load at checkout. **Render the "why is this
  here" notice off `dependencies`, not `autoAdded`**, for anything that must
  survive navigation. Never feeds `addItem` — it is derived from what's
  already in the cart, so surfacing it can't create a loop.
- `dependentsOf(slug)` — answers "if `slug` left the cart, which lines would
  lose their prerequisite?": the `product` side of every `dependencies` entry
  whose `prerequisite.slug` matches, deduplicated by product id, `[]` for a
  slug nothing depends on (including one that doesn't exist). Pure and
  derived from `dependencies` alone — no fetch, no extra state — and stable
  across re-renders that don't change `dependencies` (`useCallback`), so it's
  safe in a dependency array. **This is for a consumer to warn before
  removing a line that something else in the cart requires** — e.g. call it
  with the slug about to be removed before calling `removeItem`, and if it
  returns a non-empty array, confirm with the buyer (naming the dependants)
  before proceeding. This hook does not build that UI or call `removeItem`
  itself.
- Calls `addItem(prerequisite.slug, 1)` from the cart context itself — it
  does not require the consumer to wire anything beyond rendering the result.
  This only ever happens off `missing`; `dependencies` never triggers an add.

**Never a hard blocker.** The platform's own checkout
(`POST /api/public/checkout`) is the authoritative gate and independently
refuses an order with a genuinely missing prerequisite — this hook is
storefront UX only, so it fails open on any error (non-ok response, thrown
fetch, malformed body): `missing: []`, `autoAdded: []`, `dependencies: []`, no
add, no throw. A response body from an older platform build that omits the
`dependencies` key entirely is treated the same way — `dependencies: []`,
nothing throws. See
`wiki/cross-cutting/customer-site-parent-addon-gate.md` for the end-to-end
mechanism and why failing open here is safe.

**The loop guard.** Auto-adding a prerequisite changes the cart, which is
exactly the input this hook re-fetches on — naively, that add can re-trigger
the same add. A `useRef`-backed set of already-auto-added prerequisite slugs
(scoped to the mounted hook instance) makes sure a given slug is never
auto-added twice, even against a server that keeps reporting the same
`missing` payload no matter what's already in the cart. This is a *local*
guarantee — it does not depend on the server's `missing` response reflecting
the add. See the comment on `autoAddedSlugsRef` in
`src/use-cart-prerequisites.ts` and the loop-guard test in
`tests/use-cart-prerequisites.test.tsx`.

**Measured, not assumed: without this guard, the failure is bounded, not
runaway.** An implementer removed the guard and counted rather than
speculating — the result was exactly **two** `addItem` calls for a given slug,
not an infinite loop. The reason is the effect's dependency, `slugKey`, built
from `Array.from(new Set(items.map(i => i.slug))).sort()` — a **deduped**
sorted slug set. The first add changes that set (triggering one re-run of the
effect), but re-adding a slug already present in the cart does not change the
set again, so the effect does not fire a third time. **The guard is still
required**: two of a product a buyer never chose is a real defect on its own,
and the bound above only covers a single missing slug — several distinct
missing prerequisites, or a timing race between overlapping fetches, are the
cases the guard actually protects against.

Uses `productSlugs` (not `productIds`) against the endpoint, since the cart
only ever holds slugs — see the endpoint's own file header
(`src/app/api/public/cart/prerequisites/route.ts`, dashboard repo) for why
both forms exist and why slugs are the right choice for a `CartItem`-keyed
caller.

## `useCartBundlePrice(domain)` (U6.2)

Fetches a server-computed price for every cart line that carries a
`composition` (see `CartItem.composition` above) from
`POST /api/public/store/bundle-rules/price`. Read-only — it never calls
`addItem` or `removeItem`.

```ts
const { priceFor, isLoading, error } = useCartBundlePrice(domain);
const entry = priceFor(item.slug, item.variantId);
```

**A cart with no composed line issues no request at all.** This is
deliberate, not an incidental optimization — an account that never touches
bundles must not acquire a network call on every cart render. Only lines
whose `composition` is present are ever included in a fetch.

`priceFor(slug, variantId?)` looks a line up by its cart identity — the same
`slug`/`variantId` key `cart-reducer.ts`'s `itemKey` uses — and returns one
of:

- `{ status: 'not-composed' }` — the line has no `composition`, or no line
  with that identity exists.
- `{ status: 'unpriceable', reason }` — **the refusal.** See below.
- `{ status: 'not-loaded' }` — priceable, but the request hasn't resolved
  yet. A prior failed attempt for this exact composition also reports this
  state (fail-open — see below), so "still pending" and "last attempt
  failed" are intentionally indistinguishable from the outside: neither ever
  shows a price.
- `{ status: 'priced', result }` — a server-computed price is available:
  `result` is `{ totalMinor, discountMinor, appliedRuleId, appliedRuleName,
  basis, suppressionReason }`, passed straight through from the endpoint.

**The refusal — read this before touching the quantity check.** The pricing
engine behind this endpoint (`src/lib/store/bundle-rule-evaluator.ts` in the
dashboard) is **quantity-blind**: its `ChosenItem` type is `{ id,
listPriceMinor, owned }` — the word `quantity` does not appear anywhere in
that file, and the price route builds one `ChosenItem` per product row
regardless of how many units a composition asks for. A `CartItemComposition`
*can* express an included item with `quantity` greater than one. Sending such
a composition to this endpoint as-is would price it as though every item
were a single unit — **a total lower than what the buyer will actually be
charged.**

So: if any `includedItems` entry in a composition has `quantity > 1`, this
hook makes **no** request for it and reports `{ status: 'unpriceable',
reason }` instead — never a stale or partial figure. This is a deliberate
fail-closed stopgap on a money path, not an oversight; the evaluator gap
itself is filed in `cowork/backlog/commerce-payments.md`. **Do not remove
this refusal without first making the evaluator quantity-aware, and do not
work around it by computing a price client-side** — the evaluator (rule
selection, discount math, suppression) is the only place that can price a
bundle rule correctly.

**Fail open**, same register as `useCartPrerequisites`: a non-ok response, a
thrown fetch, or an unparseable body all resolve to no price and no thrown
error (`error` is set on the hook's return value, but nothing blocks and
nothing renders a partial result). A failed attempt is not cached, so the
next composition-set change retries it.

**Caching/dedup**: keyed by `apiBaseUrl` + `domain` + the composition's
`bundleSlug` + its `includedItems` (slug and quantity, order-independent) —
two different compositions never share an entry, and two cart lines (or two
separately mounted instances of this hook — e.g. two cart summaries on one
page, or React StrictMode's double-mount) pricing the *same* composition
content resolve from one request. Same module-scoped-cache /
in-flight-dedup / one-TTL shape as `useCartPrerequisites` and
`useCartProducts`.

Request body is `{ domain, productSlugs }` where `productSlugs` is the
composition's `includedItems` slugs (never the bundle's own slug) — the
generic bundle-rules price endpoint prices whatever chosen-item set it's
given, so it's the *included* items that need pricing, not the bundle
product itself.

## Composed course bundle (U3, courses-bundles storefront spec)

A cart holds at most **one** composed-course-bundle line at a time, kept
**out of** the `items` array on purpose — see the doc comment on
`ComposedCourseBundleCartItem` in `src/types.ts`. `items` holds only ordinary
product lines, and every existing consumer of `items` (`useCartProducts`,
`useCartPrerequisites`, `useCartSuggestions`, the reducer's slug/variantId
keying) assumes exactly that shape; folding a differently-shaped line into
the same array would silently break each of them for a slug-less entry.

```ts
composedBundle?: {
  kind: 'composed-course-bundle';
  ruleId: string;
  courseIds: string[];
  title: string;
} | null
```

`useCart()` exposes it alongside `items`: `composedBundle`,
`setComposedBundle(bundle)` (replaces any existing one — a cart holds at
most one), `clearComposedBundle()`. `clearCart()` clears both. It persists
in the same `storageKey` as `items`, under a top-level envelope,
`{ items, composedBundle }` — `migrateCartStorage` (`src/migrate-storage.ts`)
reads both this envelope AND every prior bare-array format (Bomdia,
Camoflash, pre-U3 current), always resolving `composedBundle: null` for the
latter, since none of them ever wrote one. An old stored cart therefore
loads with exactly the items it always had, nothing more.

`toComposedBundleCheckoutFragment(composedBundle)` (`src/composed-bundle.ts`)
turns the line into the checkout body fragment the dashboard's checkout
route expects, `{ composedBundle: { courseIds } }`, or `undefined` when there
is no such line — spread it straight into a checkout request body.

## Course bundle pricing engine (U3, courses-bundles storefront spec)

`src/bundle-engine.ts` is a pure, framework-free client mirror of the
dashboard's server pricing (`evaluateBundleRules` +
`guardNonPositiveDiscount`) for a course bundle rule — see that file's own
header for the exact behaviour it reproduces (all four schemes, D1's
exact-count `fixed_price_per_tier`, D2's non-positive-discount/negative-total
suppression, rounding, ties) and the one deliberate, documented divergence
from the generic design reference it otherwise ports directly (a "gap" or
below-minimum selection on the primary offer never falls through to check
alternates — the storefront's own UX decision, not a server pricing rule).
All money is in MINOR units. Exports: `quoteOne`, `quote`, `next`,
`fixedQuote`, plus the `RuleOffer`/`FixedOffer`/`BundleOffer`/`CourseDetail`/
`CoursesById`/`Quote`/`Nudge`/`FixedQuote`/`Gap`/`EvaluationBasis` types.

Parity with the server is enforced by a shared golden fixture
(`tests/fixtures/bundle-pricing-golden.json`, sha256-pinned in
`tests/bundle-engine-golden.test.ts`), generated from and byte-identical to
the dashboard's own copy (`src/lib/store/__fixtures__/bundle-pricing-golden.json`,
`src/lib/store/__tests__/bundle-pricing-golden.test.ts`) — regenerate both
together, never one alone.

`useBundleOffer(url)` (`src/use-bundle-offer.ts`) fetches a single bundle
offer from the site's own route (contract:
`2026-09-27-course-bundles-storefront-and-pe-block.md`), holds the shopper's
`sel` (resetting on `url` change), and returns `{ status, currency, offer,
courses, alts, owned, sel, setSel, toggle, quote, next, loading, error,
presets, preset, setPreset, takePreset, buildOwn, undoChanges }`.
No UI, no React-DOM rendering — that's per site (courses-bundles spec, U4).

## Bundle builder presets (D8/D10, courses-bundles storefront spec Round 2, Unit R3)

Pure helpers in `src/bundle-presets.ts` for a rule offer's ready-made picks
("presets" — `offer.presets: OfferPreset[]`, `{ id, name, ids, swap }`),
mirroring the presets design reference's derived state and actions exactly
(`cowork/design-references/design_handoff_bundle_builder_presets/README.md`
"Derived state" / "Actions", `BundleBuilder.jsx`'s `BB_same` and the
`BundleBuilderBlock`'s `act`/`locked`/`pSel`/`mine`/`take`/`buildOwn`).
**A preset carries no price of its own (D10)** — every price shown for a
preset comes from `quotePreset`, which is the same `quote()` engine every
manual selection uses, never a second price path.

- `sameSet(a, b)` — set equality by membership, order-independent.
- `presetSelection(preset, owned)` — the preset's own selection with owned
  courses removed (`pSel` in the README: `preset.ids minus owned`).
- `presetOwned(preset, owned)` — the owned set to price the preset against
  (README "owned'"): `owned ∩ preset.ids` for a non-swappable preset, the
  full `owned` list for a swappable one.
- `derivePresetState({ presets, preset, sel, owned })` — `{ act, locked,
  pSel, mine }`, field-for-field per the README's "Derived state". `mine` is
  derived, never stored: editing a swappable pick's selection back to
  exactly the preset's own set makes it read as the preset again.
- `quotePreset(offer, alts, preset, owned, courses)` — the card/CTA price
  for a preset: `quote()` against `presetOwned(preset, owned)`.
- `resolveCheckoutSelection({ presets, preset, sel, owned, quote })` — the
  course ids to send to checkout (D10): a locked (non-swappable) preset
  sends `preset.ids` (owned included — the server prices the owned courses
  via the session contact); otherwise it's `quote.own` + `quote.picked` —
  the SAME combination `BundleBuilder.jsx`'s own CTA (`filled = [...q.own,
  ...q.picked]`) already uses, reused rather than re-derived, so there is
  exactly one rule for how owned ids get included in a checkout selection.

`useBundleOffer` wires these in: it fetches `offer.presets` (mirrored at
`BundleOfferResponse.presets` too, so a caller never has to narrow `offer`
to `RuleOffer` just to read them) and exposes `presets`, the controlled
`preset` (resets to `null` whenever `url` changes, alongside `sel`),
`setPreset`, and the README's three actions as functions: `takePreset(id)`
(take), `buildOwn()` (build your own — clears an untouched preset's `sel`,
keeps an edited/"mine" one), `undoChanges()` (only meaningful when the
current selection is "mine"; a no-op otherwise).

## Checkout (`@upgradeshop/cart/checkout`, `@upgradeshop/cart/checkout/server`)

Headless checkout logic for template-built sites (customer-websites-6f52). Behaviour only: no visual
components, no visitor words (every failure is a stable key the site words itself), no gateway name.
It talks only to the store/payments public API: `POST /api/public/checkout` and
`POST /api/public/funnels/checkout` in contract 2, `GET /api/public/checkout-settings`,
`GET /api/public/orders/[orderId]`. Every site value (`apiBaseUrl`, `domain`, return URLs, the
thank-you path) is a REQUIRED parameter with no default.

Two entries, because a function exported from a `'use client'` module cannot be called from a
Server Component:

- `@upgradeshop/cart/checkout/server` (no directive, no React): `getCheckoutCapabilities(domain, apiBaseUrl)`
  -> `{ available, installmentsMax, installmentRules }` (invalid rules are dropped, absent -> `[]`; call it in the product page to decide Buy server-side, no cart JS),
  `maxInstallmentsFor(total, capabilities)` (pure; `total` is the post-coupon, post-shipping order total in
  major units, rounded like the checkout door; no rules -> `installmentsMax`; with rules -> the rule with the
  HIGHEST `minAmount` the total reaches decides (ties: first in array order), with no cap by `installmentsMax`,
  and no rule reached -> 1; per-product limits are not known to the site, so it never offers more than this
  gateway-level number; also re-exported from `./checkout`, and a total that is not finite gives 1; it trusts its input),
  `buildCartDoorBody`, `buildFunnelDoorBody`, `CheckoutError`, `isCheckoutError`, `checkoutErrorKey`,
  `CHECKOUT_ERROR_KEYS` (includes `shipping_address_required`, a dashboard follow-up not yet emitted), and the types.
  A request slower than `timeoutMs` (default 5000) reads as not available.
- `@upgradeshop/cart/checkout` (`'use client'`): `startCheckout`, `getOrderForThankYou`,
  `useThankYouOrder`, `useLinkCoupon`, and re-exports of the errors, body builders and types (NOT
  `getCheckoutCapabilities`). Import errors/types from one entry; capabilities only from `./checkout/server`. Use `isCheckoutError(e)`,
  not `instanceof`, since each entry bundles its own copy of the class.

```ts
const r = await startCheckout({ door: 'cart', domain, apiBaseUrl, customer, items,
  successUrl, cancelUrl, thankYouPath, selectedInstallments });
// paid: ownership token stored in sessionStorage (by orderId) then location.assign(pay url)
// free: token stored, goes to `${thankYouPath}?orderId=...`. successUrl and thankYouPath name the same page.
```

- `selectedInstallments` is sent only when it is an integer above 1.
- A 200 that is not the closed v2 shape (missing field, negative total, empty currency, non-https pay url)
  is a `generic` error: no token stored, no navigation. The result is rebuilt from the contract's fields only.
  An unsafe `funnelNextUrl` does not fail the order: it becomes `null`.
- Errors: `CheckoutError.key` is one of `CHECKOUT_ERROR_KEYS`; `product_unavailable` also carries `items`
  (the failing slugs).
- `getOrderForThankYou(orderId, { domain, apiBaseUrl, onPaid, onUpdate, signal, locale })` sends the stored token as
  `Authorization: Bearer` (never in a URL), polls every 4 s up to 12 requests while the status is not terminal
  (`paid`, `failed`, `cancelled`, `refunded`), ends a 429 in `not_received`, clears the token only after a
  terminal status, and calls `onPaid` only on `paid`. Inside a SAME-ORIGIN frame (`window.self !== window.top` and the top window's origin equals this page's, e.g. the pay pop-up's iframe landing on the thank-you page; a cross-origin top, or one whose read throws, counts as unframed and polls normally) it keeps the token and does not call `onPaid`, and `useThankYouOrder` makes no request and stays `confirming` until the top window reloads the page (otherwise the frame would clear the shared token and the top page would get the thin order) (clear the cart and the pending coupon there). An aborted
  run never clears the token and never calls `onPaid`. Without a stored token it returns the thin response.
  Payment message (v1.3.3): the order answer may carry `paymentState` and `paymentMessage` (the dashboard's buyer sentence,
  already translated; plain text, never HTML). `locale` (also an option of `useThankYouOrder`) is sent as `&locale=` so the
  sentence is in the page language; omitted, the dashboard uses the order's language. When polling ends in `not_received`
  and the latest answer had a non-null `paymentState`, the result also carries `paymentState` and (when non-empty)
  `paymentMessage`; the `state` values are unchanged and a result without a payment state has neither key. While
  `confirming`, `order.paymentMessage` is available on the latest order. The fields also ride the terminal `declined` result. The package never maps a state to text itself. The template, for `paymentState` `paid_not_applied` (payment received, not applied), shows its confirming heading plus the dashboard sentence in both `declined` and `not_received`, and no back-to-checkout button, because a second payment would be the risk.
- `usePayFrame({ orderId, payUrl, successUrl, cancelUrl, domain, apiBaseUrl, open, onCancelled, onClose, navigateTop })`
  (v1.3.0; its own entry `@upgradeshop/cart/checkout/pay-frame` since v1.3.1, `'use client'`, so a site loads it lazily with the pop-up) drives the payment pop-up, behaviour only: the component renders the iframe (`src=payUrl`,
  `ref={frameRef}`, `onLoad={onFrameLoad}`) and a Back button calling `close()`. On each iframe load a same-origin
  frame at `successUrl` (origin + path, trailing slash ignored) with `?orderId=` of this order navigates the TOP window
  to it; at `cancelUrl` it calls `onCancelled` (cart untouched); a cross-origin frame throws on read and is ignored.
  It also polls the order on its own schedule, `PAY_FRAME_POLL_GAPS_MS`: the first request at once, then gaps of
  4 s x5, 15 s x4, 45 s x4, i.e. 14 requests over 260 s (about 4.3 minutes), so the pop-up's 14 plus the thank-you
  page's 12 stay under the orders route's 30 per 15 minutes with room for one reload. `paid` navigates to
  `successUrl?orderId=`; a failed or cancelled status does nothing (the pay page shows its own error and may offer a
  retry) and polling goes on; a 404 or 429 ends it. The token is never cleared by the pop-up. A `message` is accepted only
  from the pay URL's origin AND from the iframe's own window (`event.source`), shaped
  `{type:"tus-payment", status:"paid"|"cancelled", orderId}` for this order. The first outcome wins (one navigation
  or one `onCancelled`); once it happened `close()` does nothing, so the form is not unlocked after a paid. A frame-load
  success navigates to `successUrl?orderId=` (never the frame's raw URL). Everything stops on close, on the first
  outcome and on unmount; setting `open` false then true starts a fresh session.
  `breakOutOfFrame()` (same entry) lets the cancel page escape a same-origin frame (no-op otherwise).
- `next` may carry an optional `display: "redirect"` (only that value passes through; any other value is dropped like every server extra);
  `startCheckout` still navigates to `next.url` exactly as before.
- `useLinkCoupon` follows the template's link-coupon recipe but does NOT clear the pending code after an
  auto-apply (a cancel-return re-applies it); the site clears it on remove, a manual apply and a paid thank-you.

### Several coupon codes (v1.5.0, DC13)

- `couponCode` stays the first applied code. `couponCodes?: string[]` on both doors lists ALL applied codes in applied order and
  is sent ONLY for 2 or more (one code keeps the exact body it always had; a pre-DC13 dashboard applies `couponCode`).
- `startCheckout` refusals `coupon_not_combinable` and `too_many_coupons` (new `CheckoutErrorKey`s, also in `CHECKOUT_ERROR_KEYS`)
  and the coupon keys `coupon_invalid` / `coupon_limit_reached` expose `error.couponCode?`, `error.conflictsWith?` and
  `error.coupons?` (the codes the server kept, `{code, discount}`). The server's sentence is still not carried: word the key yourself.
- `buildCouponValidateBody(codes, rest)` (pure, `./checkout`): one code gives `{ code, ...rest }`; 2 or more give
  `{ code: codes[0], codes, ...rest }` (max 5, blanks dropped, new code LAST as given).
- `parseCouponValidation(status, json, sentCodes)` (pure) reads the preview answer into
  `{ kind: 'ok', applied: { coupons: [{code, discount, allowCombining}], total, freeShipping } }`,
  `{ kind: 'refused', errorCode?, refusedCode?, conflictsWith?, message?, keep: [...] }` (`message` is the dashboard's sentence in
  the buyer's language, shown as text; `keep` are the coupons the dashboard kept) or `{ kind: 'unreachable' }` (status 0, 429 and
  above, non-JSON, or an answer off the contract: change nothing). The applied set is always the response's; a missing
  `allowCombining` reads as false; `refusedCode` is set only when the response names a code that was sent.
- `useLinkCoupon` uses both helpers internally; its options and `onApply` are unchanged.

## Tracking (`@upgradeshop/cart/tracking`)

Meta pixel conversion events for template-family sites (customer-websites-278d, v1.4.0; form kind, `content_type` and late consent in v1.6.0, customer-websites-d924). Plain
browser code: no React, no `'use client'`. It does not load the pixel; the site's own loader does,
only after consent. Every function returns `Promise<boolean>`: `true` only when `fbq` was actually
called, `false` for every drop (guard, declined, no consent within the hour, no `fbq`, a failed rule, already sent).

- `configureTracking({ hasConsent, hasDeclined? })`: each site calls it once with its own
  `hasAnalyticsConsent` (the cookie-consent provider does it). `hasDeclined` is optional: true when
  the visitor explicitly declined (a stored `"declined"`), as opposed to "not answered yet".
  **Fail closed:** until it is called nothing is ever sent. It also re-sends the events a previous
  page of this tab carried across a reload (see `persistPendingTracking`).
- `persistPendingTracking(): void`: call in every consent accept handler that reloads the page,
  after the consent value is saved and just before `window.location.reload()`. It never throws.
- `trackPurchase(order)`: `order` is `TrackableOrder`: `orderId`, `financialStatus`, `total`,
  `currency`, `paidAt`, `items[].productId`. Both `OrderThin` and a site's own order type fit.
- `trackLead(submissionId, formKind?)`: a Lead only with the dashboard's stored submission id.
  `formKind` is `LeadFormKind` = `'contact' | 'newsletter' | 'waitlist' | 'popup' | 'lesson' |
  'product'`, sent as Meta's predefined `content_category`. A missing or unknown kind sends `{}` (as
  before); a one-argument call is unchanged.
- `trackCompleteRegistration(key, memberId?)`: `key` is the once-per-browser key, e.g.
  `reg_course_<courseSlug>` or `reg_hub`.

```ts
configureTracking({ hasConsent: hasAnalyticsConsent });                 // once, in the consent provider
void trackPurchase({ orderId, financialStatus, total, currency, paidAt, items });  // order reached paid
void trackLead(result.submissionId);                                    // after /api/contact returned an id
void trackCompleteRegistration(`reg_course_${courseSlug}`, memberId);   // sign-up form accepted
```

**Rules (all enforced inside the module, so a call site is one line):**

- **Guard:** nothing inside a frame (`window.self !== window.top`) and nothing on a `/preview*` path.
- **Declined:** an event created while `hasDeclined()` is true returns `false` at once and is never queued.
  A decline at any time drops a waiting event too: `hasDeclined()` is re-read on every wake of the wait
  and again right before `fbq` (so an event created before `configureTracking`, or before the visitor
  declined, is never sent after a later accept); its stored copy is removed.
- **Wait (late consent):** otherwise the event waits up to **1 hour from its creation** until
  `hasConsent() && typeof window.fbq === "function"`, polling every 250 ms for the first 10 s and every
  2 s after. Past 1 hour it is dropped, unmarked. Waiting events sit in a module-level list built
  after the guard and the fired/in-flight checks (so a framed, `/preview` or already-fired event is never
  queued), at most **20**; the oldest is dropped (and stops waiting) when a 21st arrives. An event leaves
  the list when sent, refused or expired.
- **Across the accept reload:** `persistPendingTracking()` writes the waiting list to **sessionStorage**
  `tus:tracking:pending` (tab-scoped), a JSON array of `{ key, event, params, eventId, createdAt }`, only
  when `hasConsent()` is true and the list is not empty. **Nothing about a conversion is stored before the
  visitor has accepted.** `configureTracking()` reads it, drops malformed entries (event not one of
  Purchase / Lead / CompleteRegistration, params not an object, empty key, eventId not a string or null,
  createdAt not a finite number) and entries 1 h or older, and re-sends the rest through the same path
  (guard, consent at send time, fired-key and in-flight dedup; Purchase rules were checked at creation).
  An entry stays in sessionStorage until its send completes (sent or refused), so a second navigation
  before the pixel loads does not lose it; calling `configureTracking` twice does not double-send.
  The 1 h window is measured from the original event (the stored `createdAt`), not from the reload; a
  `createdAt` more than 10 min in the future is rejected. At flush a stored entry is dropped and removed
  when the visitor has declined (`hasDeclined()`), when the guard blocks the page (frame, `/preview`),
  or when it is already fired. `persistPendingTracking()` with consent and an empty list clears a stale
  stored list.
  Not covered: leaving or reloading before accepting, accepting in another tab. Purchase still recovers
  by reopening the thank-you page within 24 h of `paidAt`.
- **Consent is re-read at send time**, right before `fbq` is called. Withdrawn during the wait: dropped.
- **Marked only after `fbq` ran.** A dropped event marks nothing, so a later page load can still send
  it (a buyer who accepts on a reload-on-accept site's thank-you page is recovered this way).
- **Once per key per browser:** fired keys live in localStorage `tus:tracking:fired` (last 200 kept).
  Another browser or cleared storage can send the same key again.
- **Purchase only when** `financialStatus === "paid"`, `total` is a finite number `> 0`, `currency` is
  a 3-letter code (sent upper-case, from the order, never a site default), and `paidAt` is present and
  at most 24 h old (a `paidAt` up to 10 min in the future counts as age 0; null fails closed).
  `value` = `total`. `content_ids` and `contents` come only from items with a non-null `productId`
  (quantity defaults to 1); with none, both are omitted. `content_type: 'product'` is sent exactly when
  `content_ids` is. No `num_items`. Free orders and trials send nothing.
- **eventIDs:** Purchase `purchase_<orderId>`, Lead `lead_<submissionId>`, CompleteRegistration
  `reg_<memberId>` only when a `memberId` is passed (otherwise none; never a random id). Purchase and
  Lead use the same string as their fired key. Lead and CompleteRegistration send no value or currency.
- An empty `orderId`, `submissionId` or `key` sends nothing.

The 24 h gate narrows a re-count from another browser; it does not close it. Owner-facing behaviour,
per-site call points and gaps: `wiki/customer-websites/meta-pixel-conversion-events.md`.

## Development

```bash
npm install
npm test          # vitest run
npm run test:watch
npm run build      # tsup — dist/ is committed (GitHub package installs read it directly)
```

No database, no branches — this is a plain npm package, versioned in
`package.json` and consumed by other repos via git-ref pin, never via a
registry.
