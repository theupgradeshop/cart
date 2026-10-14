import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  startCheckout,
  CheckoutError,
  CHECKOUT_ERROR_KEYS,
  isCheckoutError,
  type StartCheckoutInput,
} from '../src/checkout';
import { readOwnershipToken } from '../src/checkout/storage';
import { ORDER_ID, payResponse, noneResponse, funnelPayResponse, errorBodies } from '../src/checkout/__fixtures__/contract-v2';

const BASE = 'https://api.test';

function reply(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({ ok: status >= 200 && status < 300, status, json: async () => body });
}

const cartInput = (over: Partial<Extract<StartCheckoutInput, { door: 'cart' }>> = {}): StartCheckoutInput => ({
  door: 'cart',
  domain: 'shop.test',
  apiBaseUrl: BASE,
  customer: { email: 'a@example.test', firstName: 'A' },
  items: [{ productSlug: 'p', quantity: 2 }],
  successUrl: 'https://shop.test/thank-you',
  cancelUrl: 'https://shop.test/checkout',
  thankYouPath: '/thank-you',
  navigate: vi.fn(),
  ...over,
});

beforeEach(() => { sessionStorage.clear(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('startCheckout', () => {
  it('pay: stores the ownership token by orderId, then navigates to the pay url', async () => {
    const f = reply(200, payResponse);
    vi.stubGlobal('fetch', f);
    const input = cartInput();
    const r = await startCheckout(input);
    expect(readOwnershipToken(ORDER_ID)).toBe('own.tok.en');
    expect((input as { navigate: ReturnType<typeof vi.fn> }).navigate).toHaveBeenCalledWith(
      (payResponse.next as { url: string }).url,
    );
    expect(r).toEqual({ orderId: ORDER_ID, orderNumber: 'O-10001', totals: payResponse.totals, next: payResponse.next });
    expect(JSON.stringify(r)).not.toContain('own.tok.en');
  });

  it('none: goes to the site thank-you route with the order id', async () => {
    vi.stubGlobal('fetch', reply(200, noneResponse));
    const input = cartInput();
    await startCheckout(input);
    expect((input as { navigate: ReturnType<typeof vi.fn> }).navigate).toHaveBeenCalledWith(`/thank-you?orderId=${ORDER_ID}`);
    expect(readOwnershipToken(ORDER_ID)).toBe('own.tok.en');
  });

  it('cart door request: contract 2, endpoint, body keys, no installments by default', async () => {
    const f = reply(200, payResponse);
    vi.stubGlobal('fetch', f);
    await startCheckout(cartInput({ couponCode: 'X', language: 'he', marketingConsent: true, shippingAddress: { city: 'c' } }));
    const [url, init] = f.mock.calls[0];
    expect(url).toBe(`${BASE}/api/public/checkout`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({
      contract: 2,
      domain: 'shop.test',
      customer: { email: 'a@example.test', firstName: 'A' },
      items: [{ productSlug: 'p', quantity: 2 }],
      couponCode: 'X',
      language: 'he',
      marketingConsent: true,
      shipping_address: { city: 'c' },
      successUrl: 'https://shop.test/thank-you',
      cancelUrl: 'https://shop.test/checkout',
    });
  });

  it.each([[undefined, false], [0, false], [1, false], [2, true], [12, true], [2.5, false], [NaN, false]])(
    'selectedInstallments=%s is sent: %s',
    async (n, sent) => {
      const f = reply(200, payResponse);
      vi.stubGlobal('fetch', f);
      await startCheckout(cartInput({ selectedInstallments: n }));
      const body = JSON.parse(f.mock.calls[0][1].body);
      if (sent) expect(body.selectedInstallments).toBe(n);
      else expect('selectedInstallments' in body).toBe(false);
    },
  );

  it('funnels door request: stepId body, endpoint, returns funnelNextUrl', async () => {
    const f = reply(200, funnelPayResponse);
    vi.stubGlobal('fetch', f);
    const r = await startCheckout({
      door: 'funnel',
      domain: 'shop.test',
      apiBaseUrl: `${BASE}/`,
      stepId: 'step-1',
      email: 'a@example.test',
      name: 'A B',
      utms: { utm_source: 's' },
      sessionId: 'sess',
      visitorId: 'vis',
      successUrl: 'https://shop.test/thank-you',
      cancelUrl: 'https://shop.test/f/x',
      thankYouPath: '/thank-you',
      navigate: vi.fn(),
    });
    const [url, init] = f.mock.calls[0];
    expect(url).toBe(`${BASE}/api/public/funnels/checkout`);
    expect(JSON.parse(init.body)).toEqual({
      contract: 2,
      stepId: 'step-1',
      email: 'a@example.test',
      name: 'A B',
      utms: { utm_source: 's' },
      session_id: 'sess',
      visitor_id: 'vis',
      successUrl: 'https://shop.test/thank-you',
      cancelUrl: 'https://shop.test/f/x',
    });
    expect(r.funnelNextUrl).toBe('/f/next-step');
  });

  it.each(errorBodies.map((e) => [e.key, e] as const))('error %s maps to a stable key and navigates nowhere', async (key, e) => {
    vi.stubGlobal('fetch', reply(e.status, e.body));
    const input = cartInput();
    const err = await startCheckout(input).catch((x) => x);
    expect(err).toBeInstanceOf(CheckoutError);
    expect(err.key).toBe(key);
    expect(err.status).toBe(e.status);
    expect(CHECKOUT_ERROR_KEYS).toContain(err.key);
    expect((input as { navigate: ReturnType<typeof vi.fn> }).navigate).not.toHaveBeenCalled();
    expect(sessionStorage.length).toBe(0);
  });

  it('an unknown code is generic', async () => {
    vi.stubGlobal('fetch', reply(400, { error: 'x', code: 'something_new' }));
    await expect(startCheckout(cartInput())).rejects.toMatchObject({ key: 'generic' });
  });

  it('a network failure is "network"', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
    await expect(startCheckout(cartInput())).rejects.toMatchObject({ key: 'network', status: 0 });
  });

  describe('a 200 that fails the closed v2 shape is generic: no token stored, no navigation', () => {
    const bad: Array<[string, unknown]> = [
      ['no orderNumber', { ...payResponse, orderNumber: undefined }],
      ['totals missing', { ...payResponse, totals: undefined }],
      ['totals.total not finite', { ...payResponse, totals: { ...payResponse.totals, total: 'x' } }],
      ['totals.currency missing', { ...payResponse, totals: { ...payResponse.totals, currency: undefined } }],
      ['javascript: pay url', { ...payResponse, next: { kind: 'pay', url: 'javascript:alert(1)' } }],
      ['unparseable pay url', { ...payResponse, next: { kind: 'pay', url: '/relative' } }],
      ['http pay url on a real host', { ...payResponse, next: { kind: 'pay', url: 'http://evil.test/x' } }],
      ['negative total', { ...payResponse, totals: { ...payResponse.totals, total: -1 } }],
      ['empty currency', { ...payResponse, totals: { ...payResponse.totals, currency: '' } }],
      ['unknown next.kind', { ...payResponse, next: { kind: 'modal', url: 'https://x.test' } }],
    ];
    it.each(bad)('%s', async (_n, body) => {
      vi.stubGlobal('fetch', reply(200, body));
      const input = cartInput();
      await expect(startCheckout(input)).rejects.toMatchObject({ key: 'generic' });
      expect((input as { navigate: ReturnType<typeof vi.fn> }).navigate).not.toHaveBeenCalled();
      expect(sessionStorage.length).toBe(0);
    });

    it.each([
      ['javascript:', 'javascript:alert(1)'],
      ['protocol-relative', '//evil.test'],
      ['tab bypass', '/\t/evil.test'],
      ['newline bypass', '/\n/evil.test'],
      ['CR bypass', '/\r/evil.test'],
      ['backslash', '/\\evil.test'],
      ['space', '/a b'],
      ['not a string', 5],
    ])('an unsafe funnelNextUrl (%s) does not fail the order: it becomes null', async (_n, bad) => {
      vi.stubGlobal('fetch', reply(200, { ...payResponse, funnelNextUrl: bad }));
      const input = cartInput();
      const r = await startCheckout(input);
      expect(r.funnelNextUrl).toBeNull();
      expect((input as { navigate: ReturnType<typeof vi.fn> }).navigate).toHaveBeenCalledTimes(1);
      expect(readOwnershipToken(ORDER_ID)).toBe('own.tok.en');
    });

    it('server extras do not pass through; next and totals are rebuilt', async () => {
      vi.stubGlobal('fetch', reply(200, {
        ...payResponse,
        paymentFormUrl: 'https://leak.test',
        totals: { ...payResponse.totals, extra: 1 },
        next: { kind: 'pay', url: (payResponse.next as { url: string }).url, display: 'modal' },
      }));
      const r = await startCheckout(cartInput());
      expect(r).toEqual({ orderId: ORDER_ID, orderNumber: 'O-10001', totals: payResponse.totals, next: payResponse.next });
      vi.stubGlobal('fetch', reply(200, { ...noneResponse, next: { kind: 'none', url: 'https://x.test' } }));
      expect((await startCheckout(cartInput())).next).toEqual({ kind: 'none' });
    });

    it('allowed variants pass: http://localhost pay url, funnelNextUrl null, relative path, https url', async () => {
      for (const funnelNextUrl of [null, '/f/x', 'https://shop.test/f/x']) {
        vi.stubGlobal('fetch', reply(200, { ...payResponse, next: { kind: 'pay', url: 'http://localhost:3004/pay/x' }, funnelNextUrl }));
        const r = await startCheckout(cartInput());
        expect(r.funnelNextUrl).toBe(funnelNextUrl);
      }
    });
  });

  it('thank-you url puts orderId before a #fragment and after an existing query', async () => {
    vi.stubGlobal('fetch', reply(200, noneResponse));
    const a = cartInput({ thankYouPath: '/thank-you#top' });
    await startCheckout(a);
    expect((a as { navigate: ReturnType<typeof vi.fn> }).navigate).toHaveBeenCalledWith(`/thank-you?orderId=${ORDER_ID}#top`);
    const b = cartInput({ thankYouPath: '/thank-you?x=1#top' });
    await startCheckout(b);
    expect((b as { navigate: ReturnType<typeof vi.fn> }).navigate).toHaveBeenCalledWith(`/thank-you?x=1&orderId=${ORDER_ID}#top`);
  });

  it('a 200 that is not a v2 body is generic and stores nothing', async () => {
    vi.stubGlobal('fetch', reply(200, { orderId: ORDER_ID, paymentFormUrl: 'https://x' }));
    await expect(startCheckout(cartInput())).rejects.toMatchObject({ key: 'generic' });
    expect(sessionStorage.length).toBe(0);
  });

  it('product_unavailable carries the failing slugs; other errors carry none', async () => {
    vi.stubGlobal('fetch', reply(400, { error: 'x', code: 'product_unavailable', items: ['a', 'b'] }));
    const e = await startCheckout(cartInput()).catch((x) => x);
    expect(e.key).toBe('product_unavailable');
    expect(e.items).toEqual(['a', 'b']);
    vi.stubGlobal('fetch', reply(400, { error: 'x', code: 'product_unavailable', items: [1] }));
    expect((await startCheckout(cartInput()).catch((x) => x)).items).toBeUndefined();
    vi.stubGlobal('fetch', reply(400, { error: 'x', code: 'coupon_invalid', items: ['a'] }));
    const c = await startCheckout(cartInput()).catch((x) => x);
    expect(c.key).toBe('coupon_invalid');
    expect(c.items).toBeUndefined();
  });

  it('isCheckoutError recognises the error regardless of which entry built it', async () => {
    vi.stubGlobal('fetch', reply(400, { error: 'x' }));
    expect(isCheckoutError(await startCheckout(cartInput()).catch((x) => x))).toBe(true);
    expect(isCheckoutError(new Error('x'))).toBe(false);
    expect(isCheckoutError(null)).toBe(false);
  });

  it('covers every code the spec lists', () => {
    for (const k of ['coupon_invalid', 'product_unavailable','subscription_unavailable', 'invalid_return_url', 'payment_unavailable', 'upsell_unavailable', 'installments_unavailable', 'coupon_limit_reached']) {
      expect(CHECKOUT_ERROR_KEYS).toContain(k);
    }
  });
});
