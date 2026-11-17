import { describe, it, expect } from 'vitest';
import { buildCartDoorBody, buildFunnelDoorBody } from '../src/checkout/bodies';
import type { Attribution, StartCartCheckoutInput, StartFunnelCheckoutInput } from '../src/checkout/types';

const cart = (over: Partial<StartCartCheckoutInput> = {}): StartCartCheckoutInput => ({
  door: 'cart', domain: 'shop.test', apiBaseUrl: 'https://api.test',
  customer: { email: 'a@example.test', firstName: 'A' }, items: [{ productSlug: 'p', quantity: 1 }],
  successUrl: 'https://shop.test/ty', cancelUrl: 'https://shop.test/c', thankYouPath: '/ty', ...over,
});

const SNAPSHOT =
  '{"contract":2,"domain":"shop.test","customer":{"email":"a@example.test","firstName":"A"},"items":[{"productSlug":"p","quantity":1}],"successUrl":"https://shop.test/ty","cancelUrl":"https://shop.test/c"}';

const attribution: Attribution = {
  first: { utm_source: 'google', utm_medium: 'cpc', gclid: 'g1', landing_path: '/', at: '2026-11-17T10:00:00Z' },
  last: { utm_source: 'newsletter', utm_campaign: 'nov' },
};

describe('attribution is copied by whitelist and never breaks the body', () => {
  it('cyclic, BigInt and throwing-getter inputs serialize safely', () => {
    const cyc: Record<string, unknown> = { utm_source: 'g' };
    cyc.self = cyc;
    const a1 = buildCartDoorBody(cart({ attribution: { first: cyc, last: null } as unknown as Attribution }));
    expect(() => JSON.stringify(a1)).not.toThrow();
    expect(a1.attribution).toEqual({ first: { utm_source: 'g' }, last: null });
    const a2 = buildCartDoorBody(cart({ attribution: { first: { utm_source: 10n }, last: null } as unknown as Attribution }));
    expect(() => JSON.stringify(a2)).not.toThrow();
    expect(a2.attribution).toEqual({ first: {}, last: null });
    const bad = { first: null, get last(): never { throw new Error('boom'); } };
    const a3 = buildCartDoorBody(cart({ attribution: bad as unknown as Attribution }));
    expect('attribution' in a3).toBe(false);
    expect(JSON.stringify(a3)).toBe(SNAPSHOT);
    const a4 = buildCartDoorBody(cart({ attribution: { first: { get utm_source(): never { throw new Error('x'); } }, last: null } as unknown as Attribution }));
    expect('attribution' in a4).toBe(false);
  });
  it('extra keys and nested objects are dropped; the result is a fresh object', () => {
    const input = { first: { utm_source: 'g', evil: 'x', utm_medium: { a: 1 }, gclid: ['a'] }, last: [1], extra: 1 };
    const b = buildCartDoorBody(cart({ attribution: input as unknown as Attribution }));
    expect(b.attribution).toEqual({ first: { utm_source: 'g' }, last: null });
    expect(b.attribution).not.toBe(input);
  });
  it('long values are capped at 200 chars', () => {
    const b = buildCartDoorBody(cart({ attribution: { first: { utm_campaign: 'x'.repeat(500) }, last: null } }));
    expect(b.attribution?.first?.utm_campaign).toBe('x'.repeat(200));
  });
});

describe('attribution in the cart door body', () => {
  it('present: sent as-is', () => {
    expect(buildCartDoorBody(cart({ attribution })).attribution).toEqual(attribution);
  });
  it('both sides null is still a plain object and is sent', () => {
    expect(buildCartDoorBody(cart({ attribution: { first: null, last: null } })).attribution).toEqual({ first: null, last: null });
  });
  it('absent: body bytes unchanged', () => {
    expect(JSON.stringify(buildCartDoorBody(cart()))).toBe(SNAPSHOT);
    expect('attribution' in buildCartDoorBody(cart({ attribution: undefined }))).toBe(false);
  });
  it('garbage: dropped, never thrown', () => {
    for (const bad of [null, 'x', 5, true, [], [attribution], new Date(), new Map()]) {
      const b = buildCartDoorBody(cart({ attribution: bad as unknown as Attribution }));
      expect('attribution' in b).toBe(false);
      expect(JSON.stringify(b)).toBe(SNAPSHOT);
    }
  });
  it('funnel door ignores attribution', () => {
    const f = { door: 'funnel', domain: 'shop.test', apiBaseUrl: 'https://api.test', stepId: 's1', email: 'a@example.test',
      successUrl: 'https://shop.test/ty', cancelUrl: 'https://shop.test/c', thankYouPath: '/ty', attribution } as unknown as StartFunnelCheckoutInput;
    expect('attribution' in buildFunnelDoorBody(f)).toBe(false);
  });
});
