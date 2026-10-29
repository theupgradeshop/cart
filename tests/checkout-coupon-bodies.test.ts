import { describe, it, expect } from 'vitest';
import { buildCartDoorBody, buildFunnelDoorBody } from '../src/checkout/bodies';
import type { StartCartCheckoutInput, StartFunnelCheckoutInput } from '../src/checkout/types';

const cart = (over: Partial<StartCartCheckoutInput> = {}): StartCartCheckoutInput => ({
  door: 'cart', domain: 'shop.test', apiBaseUrl: 'https://api.test',
  customer: { email: 'a@example.test', firstName: 'A' }, items: [{ productSlug: 'p', quantity: 1 }],
  successUrl: 'https://shop.test/ty', cancelUrl: 'https://shop.test/c', thankYouPath: '/ty', ...over,
});
const funnel = (over: Partial<StartFunnelCheckoutInput> = {}): StartFunnelCheckoutInput => ({
  door: 'funnel', domain: 'shop.test', apiBaseUrl: 'https://api.test', stepId: 's1', email: 'a@example.test',
  successUrl: 'https://shop.test/ty', cancelUrl: 'https://shop.test/c', thankYouPath: '/ty', ...over,
});

describe('coupon codes in the door bodies (DC13)', () => {
  it('cart door, one code: bytes unchanged (no couponCodes key)', () => {
    expect(JSON.stringify(buildCartDoorBody(cart({ couponCode: 'A' })))).toBe(
      '{"contract":2,"domain":"shop.test","customer":{"email":"a@example.test","firstName":"A"},"items":[{"productSlug":"p","quantity":1}],"couponCode":"A","successUrl":"https://shop.test/ty","cancelUrl":"https://shop.test/c"}',
    );
    // a one-element list never adds the key; an empty list never sends []
    expect('couponCodes' in buildCartDoorBody(cart({ couponCode: 'A', couponCodes: ['A'] }))).toBe(false);
    expect('couponCodes' in buildCartDoorBody(cart({ couponCodes: [] }))).toBe(false);
  });
  it('cart door, two codes: couponCode is the first, couponCodes has all in order', () => {
    const b = buildCartDoorBody(cart({ couponCode: 'A', couponCodes: ['A', 'B'] }));
    expect(b.couponCode).toBe('A');
    expect(b.couponCodes).toEqual(['A', 'B']);
  });
  it('funnel door, one code: bytes unchanged', () => {
    expect(JSON.stringify(buildFunnelDoorBody(funnel({ couponCode: 'A' })))).toBe(
      '{"contract":2,"stepId":"s1","email":"a@example.test","couponCode":"A","successUrl":"https://shop.test/ty","cancelUrl":"https://shop.test/c"}',
    );
  });
  it('funnel door, two codes', () => {
    const b = buildFunnelDoorBody(funnel({ couponCode: 'A', couponCodes: ['A', 'B', 'C'] }));
    expect(b.couponCode).toBe('A');
    expect(b.couponCodes).toEqual(['A', 'B', 'C']);
  });
});
