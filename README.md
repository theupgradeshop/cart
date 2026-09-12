# @upgradeshop/cart

ID-only cart state management with live price fetching for Upgrade Shop
customer websites. The cart itself only ever stores `{ slug, quantity,
variantId? }` in `localStorage` — no price, no name, nothing that can go
stale. Live product data (price, name, images, availability) is fetched
separately and merged in at read time.

Consumed by pinned git ref from each customer site's `package.json` (e.g.
`github:theupgradeshop/cart#<sha>` or `#v1.0.1`) — see
`wiki/cross-cutting/customer-site-parent-addon-gate.md` for the current pin
table. **Bumping a site's pin is a separate, deliberate step per site — a
change landing here does not reach any site until that happens.**

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
const { missing, autoAdded, isLoading, error } = useCartPrerequisites(domain, buyerEmail);
```

- `missing` — every `{ product, prerequisite }` pair the endpoint currently
  reports as unsatisfied (product summaries: `{ id, name, slug, price,
  images }`).
- `autoAdded` — the subset of `missing` this hook has actually added to the
  cart during this mounted instance. Render a notice off this, naming the
  prerequisite and why it appeared — **this hook never blocks**, it only adds
  and reports.
- Calls `addItem(prerequisite.slug, 1)` from the cart context itself — it
  does not require the consumer to wire anything beyond rendering the result.

**Never a hard blocker.** The platform's own checkout
(`POST /api/public/checkout`) is the authoritative gate and independently
refuses an order with a genuinely missing prerequisite — this hook is
storefront UX only, so it fails open on any error (non-ok response, thrown
fetch, malformed body): `missing: []`, `autoAdded: []`, no add, no throw. See
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
