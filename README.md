# @upgradeshop/cart

ID-only cart state management with live price fetching for Upgrade Shop
customer websites. The cart itself only ever stores `{ slug, quantity,
variantId?, composition? }` in `localStorage` — no price, no name, nothing
that can go stale. Live product data (price, name, images, availability) is
fetched separately and merged in at read time.

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
nothing yet writes a `composition`. Building a bundle editor or pricing a
composed bundle is out of scope here.

## Exports

- `CartProvider`, `useCart` (`src/cart-context.tsx`) — the cart itself:
  `items`, `addItem`, `removeItem`, `updateQuantity`, `clearCart`,
  `openCart`/`closeCart`/`toggleCart`, `itemCount`.
- `useCartProducts(domain)` (`src/use-cart-products.ts`) — merges the cart's
  slugs with live product data from `GET /api/public/products`.
- `useCartSuggestions(domain)` (`src/use-cart-suggestions.ts`) — cross-sell /
  upsell / bundle-upgrade suggestions from
  `GET /api/public/cart/suggestions`, plus `applySuggestion`.
- `useCartPrerequisites(domain, buyerEmail?)` (`src/use-cart-prerequisites.ts`)
  — see below.

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
