// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import {
  siteGate,
  thankYouSkip,
  isSiteGateSkipped,
  __resetSiteGateForTests,
  __siteGateCacheSizes,
  cleanGateRequestHeaders,
} from '../src/site-gate';

const DOMAIN = 'shop.example.test';
const PLATFORM = 'https://app.example.test';
const PASS = 'eyJ2IjoxfQ.c2lnbmF0dXJl'; // payloadB64.sigB64 shape
const PASS2 = 'eyJ2IjoyfQ.c2lnbmF0dXJlMg';
const PREVIEW = 'A'.repeat(43);

type Answer = Record<string, unknown>;
const OFF: Answer = { on: false };
const visitorAns = (extra: Answer = {}): Answer => ({ on: true, view: 'visitor', variant: 'split', businessName: 'Acme Café', ...extra });
const teamAns: Answer = { on: true, view: 'team', variant: 'split', businessName: 'Acme Café' };
const previewAns: Answer = { on: true, view: 'preview', variant: 'split', businessName: 'Acme Café' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** A fetch whose answer depends on the token headers it was sent. */
function dashboard(fn: (h: Headers) => Response | Promise<Response>) {
  return vi.fn(async (_url: unknown, init?: RequestInit) => fn(new Headers(init?.headers)));
}
const callHeaders = (f: ReturnType<typeof dashboard>, i = 0) => new Headers((f.mock.calls[i][1] as RequestInit).headers);

function req(path: string, opts: { cookies?: Record<string, string>; headers?: Record<string, string> } = {}) {
  const headers = new Headers(opts.headers);
  if (opts.cookies) headers.set('cookie', Object.entries(opts.cookies).map(([k, v]) => `${k}=${v}`).join('; '));
  return new NextRequest(`https://${DOMAIN}${path}`, { headers });
}

const gate = (r: NextRequest, f: ReturnType<typeof dashboard>, extra: Record<string, unknown> = {}) =>
  siteGate(r, { domain: DOMAIN, platformUrl: PLATFORM, fetchImpl: f as unknown as typeof fetch, ...extra });

const overrideList = (res: Response) => (res.headers.get('x-middleware-override-headers') ?? '').split(',');

beforeEach(() => {
  __resetSiteGateForTests();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-31T10:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('skip list (segment boundary)', () => {
  it.each([
    '/api', '/api/x', '/_next/static/a.js', '/_next', '/preview', '/preview/page', '/brand-icon', '/brand-icon/x',
    '/d/abc', '/l/abc', '/robots.txt', '/sitemap.xml', '/a.png', '/blog/rss.xml', '/x/file.ext',
  ])('%s is skipped and never reaches the dashboard', async (p) => {
    const f = dashboard(() => json(visitorAns()));
    expect(await gate(req(p), f)).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });

  it.each(['/api-docs', '/preview-x', '/dx', '/lx', '/l', '/cart', '/checkout', '/checkout/pay', '/login', '/verify', '/', '/about'])(
    '%s is gated (503) except the exact /l',
    async (p) => {
      const f = dashboard(() => json(visitorAns()));
      const res = await gate(req(p), f);
      if (p === '/l') {
        expect(res).toBeNull(); // /l itself is a segment match
      } else {
        expect(res?.status).toBe(503);
      }
    },
  );

  it('isSiteGateSkipped is pure', () => {
    expect(isSiteGateSkipped('/api/x')).toBe(true);
    expect(isSiteGateSkipped('/api-docs')).toBe(false);
  });

  it('extraSkip: the site thank-you passes, its look-alikes are gated', async () => {
    const extraSkip = thankYouSkip('/checkout/thank-you', ['en', 'he']);
    for (const p of ['/checkout/thank-you', '/checkout/thank-you/', '/en/checkout/thank-you', '/he/checkout/thank-you/']) {
      const f = dashboard(() => json(visitorAns()));
      expect(await gate(req(p), f, { extraSkip })).toBeNull();
      expect(f).not.toHaveBeenCalled();
    }
    for (const p of ['/checkout/thank-you-x', '/checkout', '/cart', '/fr/checkout/thank-you', '/xcheckout/thank-you']) {
      const f = dashboard(() => json(visitorAns()));
      expect((await gate(req(p), f, { extraSkip }))?.status).toBe(503);
    }
  });

  it('thankYouSkip: bare /thank-you, several paths, escaped language codes', () => {
    const s = thankYouSkip(['/thank-you', 'checkout-thank-you/'], ['en', 'pt.BR']);
    expect(s('/thank-you')).toBe(true);
    expect(s('/checkout-thank-you')).toBe(true);
    expect(s('/pt.BR/thank-you')).toBe(true);
    expect(s('/ptxBR/thank-you')).toBe(false);
    expect(s('/thank-you-x')).toBe(false);
    expect(s('/x/thank-you')).toBe(false);
    expect(thankYouSkip('/thank-you', [])('/thank-you')).toBe(true);
  });
});

describe('visitor view while on', () => {
  it('503, Retry-After, no-store, rewrite to /site-coming-soon, variant + name headers, no noindex', async () => {
    const f = dashboard(() => json(visitorAns()));
    const res = (await gate(req('/about?x=1'), f))!;
    expect(res.status).toBe(503);
    expect(res.headers.get('Retry-After')).toBe('3600');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('x-middleware-rewrite')).toBe(`https://${DOMAIN}/site-coming-soon`);
    expect(res.headers.get('x-middleware-request-x-tus-uc-variant')).toBe('split');
    expect(res.headers.get('x-middleware-request-x-tus-uc-business-name')).toBe(encodeURIComponent('Acme Café'));
    expect(res.headers.get('x-robots-tag')).toBeNull();
    expect(res.headers.get('link')).toBeNull();
  });

  it('strips client-sent x-tus-uc-* and x-tus-site-* request headers', async () => {
    const f = dashboard(() => json(visitorAns()));
    const res = (await gate(req('/', { headers: { 'x-tus-uc-variant': 'banner', 'x-tus-site-pass': 'x', 'x-keep': '1' } }), f))!;
    expect(res.headers.get('x-middleware-request-x-tus-uc-variant')).toBe('split');
    expect(overrideList(res)).not.toContain('x-tus-site-pass');
    expect(overrideList(res)).toContain('x-keep');
  });

  it('mode off -> null', async () => {
    const f = dashboard(() => json(OFF));
    expect(await gate(req('/about'), f)).toBeNull();
  });

  it('calls GET {platformUrl}/api/public/site-gate?domain= with only accept (no token headers) when tokenless', async () => {
    const f = dashboard(() => json(OFF));
    await gate(req('/', { headers: { 'x-tus-site-pass': PASS, authorization: 'Bearer z' } }), f);
    expect(f).toHaveBeenCalledTimes(1);
    expect(String(f.mock.calls[0][0])).toBe(`${PLATFORM}/api/public/site-gate?domain=${DOMAIN}`);
    expect(callHeaders(f).has('x-tus-site-pass')).toBe(false);
    expect(callHeaders(f).has('authorization')).toBe(false);
  });

  it('?tus_view=visitor narrows a team member to the visitor view without forwarding the token', async () => {
    const f = dashboard((h) => json(h.get('x-tus-site-pass') ? teamAns : visitorAns()));
    const res = (await gate(req('/about?tus_view=visitor', { cookies: { '__Host-tus_site_pass': PASS } }), f))!;
    expect(res.status).toBe(503);
    expect(callHeaders(f).has('x-tus-site-pass')).toBe(false);
  });

  it('removes a leftover tus_site_view cookie on the visitor response', async () => {
    const f = dashboard(() => json(visitorAns()));
    const res = (await gate(req('/', { cookies: { tus_site_view: 'team' } }), f))!;
    expect(res.headers.get('set-cookie')).toMatch(/tus_site_view=;/);
  });
});

describe('team / preview view', () => {
  it('pass cookie -> pass-through with private, no-store and tus_site_view=team; token built into a fresh header', async () => {
    const f = dashboard((h) => json(h.get('x-tus-site-pass') === PASS ? teamAns : visitorAns()));
    const res = (await gate(req('/about', { cookies: { '__Host-tus_site_pass': PASS, session: 'secret' }, headers: { authorization: 'Bearer z' } }), f))!;
    expect(res.status).toBe(200);
    expect(res.headers.get('x-middleware-next')).toBe('1');
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(res.headers.get('set-cookie')).toMatch(/tus_site_view=team/);
    const h = callHeaders(f);
    expect(h.get('x-tus-site-pass')).toBe(PASS);
    expect([...h.keys()].sort()).toEqual(['accept', 'x-tus-site-pass']);
  });

  it('preview cookie -> tus_site_view=preview', async () => {
    const f = dashboard((h) => json(h.get('x-tus-site-preview') === PREVIEW ? previewAns : visitorAns()));
    const res = (await gate(req('/', { cookies: { '__Host-tus_site_preview': PREVIEW } }), f))!;
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(res.headers.get('set-cookie')).toMatch(/tus_site_view=preview/);
  });

  it('incoming x-tus-site-* request headers are stripped on pass-through', async () => {
    const f = dashboard(() => json(teamAns));
    const res = (await gate(req('/', { cookies: { '__Host-tus_site_pass': PASS }, headers: { 'x-tus-site-view': 'team', 'x-other': 'a' } }), f))!;
    expect(overrideList(res)).not.toContain('x-tus-site-view');
    expect(overrideList(res)).toContain('x-other');
  });

  it('a team request, then a tokenless request, gets the visitor view', async () => {
    const f = dashboard((h) => json(h.get('x-tus-site-pass') ? teamAns : visitorAns()));
    expect((await gate(req('/', { cookies: { '__Host-tus_site_pass': PASS } }), f))!.status).toBe(200);
    expect((await gate(req('/'), f))!.status).toBe(503);
  });

  it('token with mode off -> null', async () => {
    const f = dashboard(() => json(OFF));
    expect(await gate(req('/', { cookies: { '__Host-tus_site_pass': PASS } }), f)).toBeNull();
  });
});

describe('?tus_preview=', () => {
  it('valid -> 302 to the same URL without the param, host cookie, no-store, no-referrer', async () => {
    const f = dashboard((h) => json(h.get('x-tus-site-preview') === PREVIEW ? previewAns : visitorAns()));
    const res = (await gate(req(`/about?a=1&tus_preview=${PREVIEW}&b=2`), f))!;
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`https://${DOMAIN}/about?a=1&b=2`);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('Referrer-Policy')).toBe('no-referrer');
    const sc = res.headers.get('set-cookie')!;
    expect(sc).toContain(`__Host-tus_site_preview=${PREVIEW}`);
    expect(sc).toMatch(/HttpOnly/i);
    expect(sc).toMatch(/Secure/i);
    expect(sc).toMatch(/SameSite=lax/i);
    expect(sc).toMatch(/Path=\//);
    expect(sc).not.toMatch(/Max-Age|Expires/i);
  });

  it('invalid (or turned-off) -> visitor 503, no cookie', async () => {
    const f = dashboard(() => json(visitorAns()));
    const res = (await gate(req(`/about?tus_preview=${PREVIEW}`), f))!;
    expect(res.status).toBe(503);
    expect(res.headers.get('set-cookie') ?? '').not.toContain('__Host-tus_site_preview');
  });

  it('malformed value is never forwarded; ordinary visitor view', async () => {
    const f = dashboard(() => json(visitorAns()));
    const res = (await gate(req('/?tus_preview=short%20bad'), f))!;
    expect(res.status).toBe(503);
    expect(callHeaders(f).has('x-tus-site-preview')).toBe(false);
  });

  it('mode off with a param -> null', async () => {
    const f = dashboard(() => json(OFF));
    expect(await gate(req(`/?tus_preview=${PREVIEW}`), f)).toBeNull();
  });
});

describe('cookie deletion', () => {
  it('a 2xx well-shaped invalid answer deletes the cookie', async () => {
    const f = dashboard(() => json(visitorAns()));
    const res = (await gate(req('/', { cookies: { '__Host-tus_site_pass': PASS } }), f))!;
    expect(res.status).toBe(503);
    expect(res.headers.get('set-cookie')).toMatch(/__Host-tus_site_pass=;.*Max-Age=0/i);
  });

  it.each([
    ['503', () => new Response('x', { status: 503 })],
    ['429', () => new Response('x', { status: 429 })],
    ['404', () => new Response('x', { status: 404 })],
    ['garbage body', () => new Response('<html>', { status: 200 })],
    ['wrong shape', () => json({ on: true, view: 'wizard', variant: 'split', businessName: 'x' })],
    ['network error', () => { throw new Error('ECONNREFUSED'); }],
  ])('dashboard %s = unreachable: visitor view, cookie kept', async (_n, fn) => {
    const f = dashboard(fn as () => Response);
    const res = (await gate(req('/', { cookies: { '__Host-tus_site_pass': PASS } }), f))!;
    expect(res.status).toBe(503);
    expect(res.headers.get('set-cookie') ?? '').not.toContain('__Host-tus_site_pass');
  });

  it('a timeout (1 s) is unreachable and keeps the cookie', async () => {
    const f = vi.fn((_u: unknown, init?: RequestInit) => new Promise<Response>((_res, rej) => init?.signal?.addEventListener('abort', () => rej(new Error('abort')))));
    const p = gate(req('/', { cookies: { '__Host-tus_site_pass': PASS } }), f as never);
    await vi.waitFor(() => expect(f).toHaveBeenCalled()); // the token is hashed (real async crypto) before the call
    await vi.advanceTimersByTimeAsync(1000);
    const res = (await p)!;
    expect(res.status).toBe(503);
    expect(res.headers.get('set-cookie') ?? '').not.toContain('__Host-tus_site_pass');
  });

  it('a fetch that ignores its abort signal still times out at 1 s', async () => {
    const f = vi.fn(() => new Promise<Response>(() => {}));
    const p = gate(req('/'), f as never);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await p).toBeNull(); // cold + unreachable = open
  });
});

describe('unreachable dashboard', () => {
  let err: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    err = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('cold start, tokenless -> open, one loud console.error, no retry storm', async () => {
    const f = dashboard(() => new Response('x', { status: 500 }));
    expect(await gate(req('/'), f)).toBeNull();
    expect(await gate(req('/a'), f)).toBeNull();
    expect(await gate(req('/b'), f)).toBeNull();
    expect(f).toHaveBeenCalledTimes(1); // backoff
    expect(err).toHaveBeenCalledTimes(1);
  });

  it('last-known TOKENLESS answer is served through an outage (stale, then the dashboard dies)', async () => {
    let up = true;
    const f = dashboard(() => (up ? json(visitorAns()) : new Response('x', { status: 503 })));
    expect((await gate(req('/'), f))!.status).toBe(503);
    up = false;
    await vi.advanceTimersByTimeAsync(6000);
    expect((await gate(req('/'), f))!.status).toBe(503); // stale served, refresh fails in background
    await vi.advanceTimersByTimeAsync(10);
    await vi.advanceTimersByTimeAsync(60_000);
    expect((await gate(req('/'), f))!.status).toBe(503);
  });

  it('last-known "off" keeps the site open through an outage', async () => {
    let up = true;
    const f = dashboard(() => (up ? json(OFF) : new Response('x', { status: 500 })));
    expect(await gate(req('/'), f)).toBeNull();
    up = false;
    await vi.advanceTimersByTimeAsync(6000);
    expect(await gate(req('/'), f)).toBeNull();
  });

  it('a token request while unreachable gets the visitor view', async () => {
    const f = dashboard(() => new Response('x', { status: 500 }));
    const res = (await gate(req('/', { cookies: { '__Host-tus_site_pass': PASS } }), f))!;
    expect(res.status).toBe(503);
  });

  it('a token request while unreachable is open when the last tokenless answer was off', async () => {
    let up = true;
    const f = dashboard((h) => (up ? json(OFF) : new Response('x', { status: 500 })));
    expect(await gate(req('/'), f)).toBeNull();
    up = false;
    expect(await gate(req('/', { cookies: { '__Host-tus_site_pass': PASS } }), f)).toBeNull();
  });

  it('a team answer is never reused for a tokenless request, even during an outage', async () => {
    let up = true;
    const f = dashboard((h) => (up ? json(h.get('x-tus-site-pass') ? teamAns : visitorAns()) : new Response('x', { status: 500 })));
    expect((await gate(req('/', { cookies: { '__Host-tus_site_pass': PASS } }), f))!.status).toBe(200);
    up = false;
    await vi.advanceTimersByTimeAsync(10_000);
    // tokenless never known, dashboard down -> open (never the team answer, never a cached 200-with-private)
    const res = await gate(req('/'), f);
    expect(res).toBeNull();
  });

  it('429 and 5xx on a refresh never overwrite the cache with an error', async () => {
    let mode: 'ok' | '429' = 'ok';
    const f = dashboard(() => (mode === 'ok' ? json(visitorAns()) : new Response('slow down', { status: 429 })));
    await gate(req('/'), f);
    mode = '429';
    await vi.advanceTimersByTimeAsync(6000);
    expect((await gate(req('/'), f))!.status).toBe(503);
    await vi.advanceTimersByTimeAsync(10);
    expect((await gate(req('/'), f))!.status).toBe(503);
  });
});

describe('cache', () => {
  it('one 5 s TTL: second request is a cache hit, a request after 5 s refetches', async () => {
    const f = dashboard(() => json(OFF));
    await gate(req('/a'), f);
    await gate(req('/b'), f);
    expect(f).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5001);
    await gate(req('/c'), f);
    await vi.advanceTimersByTimeAsync(0);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('negative token answers are cached too (stale 7-day cookie costs one call per TTL)', async () => {
    const f = dashboard(() => json(visitorAns()));
    for (let i = 0; i < 5; i++) await gate(req('/', { cookies: { '__Host-tus_site_pass': PASS } }), f);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('in-flight dedupe: concurrent cold requests share one fetch', async () => {
    const f = dashboard(() => json(visitorAns()));
    await Promise.all([gate(req('/a'), f), gate(req('/b'), f), gate(req('/c'), f)]);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('keys are (domain, token): a different token is a different answer', async () => {
    const f = dashboard((h) => json(h.get('x-tus-site-pass') === PASS ? teamAns : visitorAns()));
    expect((await gate(req('/', { cookies: { '__Host-tus_site_pass': PASS } }), f))!.status).toBe(200);
    expect((await gate(req('/', { cookies: { '__Host-tus_site_pass': PASS2 } }), f))!.status).toBe(503);
  });

  it('the token LRU is bounded (~64) and never evicts the tokenless last-known', async () => {
    let up = true;
    const f = dashboard((h) => (up ? json(h.get('x-tus-site-pass') ? visitorAns() : visitorAns({ businessName: 'Known' })) : new Response('x', { status: 500 })));
    await gate(req('/'), f);
    for (let i = 0; i < 100; i++) {
      await vi.advanceTimersByTimeAsync(250); // keeps the per-process bucket from running dry
      await gate(req('/', { cookies: { '__Host-tus_site_pass': `eyJ${String(i).padStart(4, '0')}.sig${i}` } }), f);
    }
    expect(__siteGateCacheSizes().tokened).toBeLessThanOrEqual(64);
    expect(__siteGateCacheSizes().tokenless).toBe(1);
    up = false;
    await vi.advanceTimersByTimeAsync(10_000);
    const res = (await gate(req('/'), f))!;
    expect(res.headers.get('x-middleware-request-x-tus-uc-business-name')).toBe('Known');
  });
});

describe('token hygiene', () => {
  it.each([
    ['bad charset', 'ab cd.ef'],
    ['no dot', 'abcdef'],
    ['too long', 'a'.repeat(1100) + '.b'],
    ['empty half', 'abc.'],
    ['script', '<script>.x'],
  ])('a malformed pass cookie (%s) is never forwarded', async (_n, bad) => {
    const f = dashboard(() => json(visitorAns()));
    const res = (await gate(req('/', { cookies: { '__Host-tus_site_pass': bad } }), f))!;
    expect(res.status).toBe(503);
    expect(callHeaders(f).has('x-tus-site-pass')).toBe(false);
    expect(res.headers.get('set-cookie') ?? '').not.toContain('__Host-tus_site_pass');
  });

  it('per-process cap on token-bearing forwards; overflow = visitor view; tokenless unaffected', async () => {
    const f = dashboard((h) => json(h.get('x-tus-site-pass') ? teamAns : OFF));
    const results: (number | null)[] = [];
    for (let i = 0; i < 20; i++) {
      const r = await gate(req('/', { cookies: { '__Host-tus_site_pass': `eyJ${i}.sig${i}` } }), f);
      results.push(r ? r.status : null);
    }
    const forwarded = f.mock.calls.filter((c) => new Headers((c[1] as RequestInit).headers).has('x-tus-site-pass')).length;
    expect(forwarded).toBe(5);
    expect(results.filter((s) => s === 200).length).toBe(5);
    expect(results.filter((s) => s === 503).length).toBe(15);
    // a tokenless call still works (its own path, not the bucket)
    expect(await gate(req('/'), f)).toBeNull();
    // bucket refills
    await vi.advanceTimersByTimeAsync(1000);
    expect((await gate(req('/', { cookies: { '__Host-tus_site_pass': 'eyJnew.sig' } }), f))!.status).toBe(200);
  });
});

describe('errors', () => {
  it('outer try/catch: a throwing extraSkip returns null', async () => {
    const f = dashboard(() => json(visitorAns()));
    expect(await gate(req('/'), f, { extraSkip: () => { throw new Error('boom'); } })).toBeNull();
  });

  it('a bad request object returns null', async () => {
    const f = dashboard(() => json(visitorAns()));
    expect(await gate({} as NextRequest, f)).toBeNull();
  });

  it('missing domain/platformUrl -> null', async () => {
    const f = dashboard(() => json(visitorAns()));
    expect(await siteGate(req('/'), { domain: '', platformUrl: PLATFORM, fetchImpl: f as never })).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });
});

describe('review round 1', () => {
  it('1. ok, then fail, then a request within 5 s: the old token answer is NOT fresh again (visitor view, cookie kept)', async () => {
    let up = true;
    const f = dashboard((h) => (up ? json(h.get('x-tus-site-pass') ? teamAns : visitorAns()) : new Response('x', { status: 503 })));
    const c = { '__Host-tus_site_pass': PASS };
    expect((await gate(req('/', { cookies: c }), f))!.status).toBe(200);
    up = false;
    await vi.advanceTimersByTimeAsync(5001);
    const r2 = (await gate(req('/', { cookies: c }), f))!; // fails
    expect(r2.status).toBe(503);
    expect(r2.headers.get('set-cookie') ?? '').not.toContain('__Host-tus_site_pass');
    await vi.advanceTimersByTimeAsync(1000); // still down, inside the backoff
    const r3 = (await gate(req('/', { cookies: c }), f))!;
    expect(r3.status).toBe(503); // never 200 team view from the stale answer
    expect(r3.headers.get('set-cookie') ?? '').not.toContain('__Host-tus_site_pass');
  });

  it('1b. a dropped token answer is not a cookie deletion either', async () => {
    let step = 0;
    const f = dashboard(() => (step++ === 0 ? json(visitorAns()) : new Response('x', { status: 500 })));
    const c = { '__Host-tus_site_pass': PASS };
    await gate(req('/', { cookies: c }), f); // fresh 2xx invalid -> deletes
    await vi.advanceTimersByTimeAsync(5001);
    const r = (await gate(req('/', { cookies: c }), f))!; // fails: must not delete
    expect(r.status).toBe(503);
    expect(r.headers.get('set-cookie') ?? '').not.toContain('__Host-tus_site_pass');
  });

  it('2. a 199-char name followed by an emoji never throws and the visitor view is served', async () => {
    const f = dashboard(() => json(visitorAns({ businessName: 'a'.repeat(199) + '\u{1F600}' })));
    const res = (await gate(req('/'), f))!;
    expect(res.status).toBe(503);
    const name = decodeURIComponent(res.headers.get('x-middleware-request-x-tus-uc-business-name')!);
    expect(Array.from(name)).toHaveLength(200);
    expect(name.endsWith('\u{1F600}')).toBe(true);
  });

  it('2b. a lone surrogate in the name is replaced, not thrown on', async () => {
    const f = dashboard(() => json(visitorAns({ businessName: 'Ab\uD83Dc' })));
    const res = (await gate(req('/'), f))!;
    expect(res.status).toBe(503);
    expect(decodeURIComponent(res.headers.get('x-middleware-request-x-tus-uc-business-name')!)).toBe('Ab\uFFFDc');
  });

  it('3. a direct request to /site-coming-soon with forged headers: mode on -> clean visitor rewrite', async () => {
    const f = dashboard(() => json(visitorAns()));
    const res = (await gate(req('/site-coming-soon', { headers: { 'x-tus-uc-variant': 'banner', 'x-tus-uc-business-name': 'Evil' } }), f))!;
    expect(res.status).toBe(503);
    expect(res.headers.get('x-middleware-request-x-tus-uc-variant')).toBe('split');
    expect(res.headers.get('x-middleware-request-x-tus-uc-business-name')).toBe(encodeURIComponent('Acme Café'));
  });

  it('3b. mode off -> plain 404 no-store (never renders in public)', async () => {
    const f = dashboard(() => json(OFF));
    const res = (await gate(req('/site-coming-soon', { headers: { 'x-tus-uc-variant': 'banner' } }), f))!;
    expect(res.status).toBe(404);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('x-middleware-next')).toBeNull();
    expect((await gate(req('/site-coming-soon/x'), f))!.status).toBe(404);
    expect(await gate(req('/site-coming-soonx'), f)).toBeNull();
  });

  it('3c. mode off + a leftover view cookie on /site-coming-soon is still the 404', async () => {
    const f = dashboard(() => json(OFF));
    expect((await gate(req('/site-coming-soon', { cookies: { tus_site_view: 'team' } }), f))!.status).toBe(404);
  });

  it('3d. team view of /site-coming-soon passes through with clean headers', async () => {
    const f = dashboard(() => json(teamAns));
    const res = (await gate(req('/site-coming-soon', { cookies: { '__Host-tus_site_pass': PASS }, headers: { 'x-tus-uc-variant': 'banner' } }), f))!;
    expect(res.status).toBe(200);
    expect(overrideList(res)).not.toContain('x-tus-uc-variant');
  });

  it('4. mode off + leftover tus_site_view cookie -> next() with the cookie expired; no cookie -> null', async () => {
    const f = dashboard(() => json(OFF));
    const res = (await gate(req('/about', { cookies: { tus_site_view: 'team' } }), f))!;
    expect(res.headers.get('x-middleware-next')).toBe('1');
    expect(res.headers.get('set-cookie')).toMatch(/tus_site_view=;.*Max-Age=0/i);
    expect(await gate(req('/about'), f)).toBeNull();
    const r2 = (await gate(req('/about', { cookies: { tus_site_view: 'team', '__Host-tus_site_pass': PASS } }), f))!;
    expect(r2.headers.get('set-cookie')).toMatch(/tus_site_view=;.*Max-Age=0/i);
  });

  it('4b. the view cookie lives 30 s', async () => {
    const f = dashboard(() => json(teamAns));
    const res = (await gate(req('/', { cookies: { '__Host-tus_site_pass': PASS } }), f))!;
    expect(res.headers.get('set-cookie')).toMatch(/tus_site_view=team.*Max-Age=30/i);
  });

  it('5. the same token on two domains costs two dashboard calls', async () => {
    const f = dashboard(() => json(teamAns));
    const c = { '__Host-tus_site_pass': PASS };
    await gate(req('/', { cookies: c }), f);
    await siteGate(req('/', { cookies: c }), { domain: 'other.example.test', platformUrl: PLATFORM, fetchImpl: f as never });
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('6. an idle site (tokenless entry older than 60 s) awaits the refresh instead of serving the stale answer', async () => {
    let on = true;
    const f = dashboard(() => json(on ? visitorAns() : OFF));
    expect((await gate(req('/'), f))!.status).toBe(503);
    on = false;
    await vi.advanceTimersByTimeAsync(30_000); // stale but < 60 s: SWR serves the old answer
    expect((await gate(req('/'), f))!.status).toBe(503);
    await vi.advanceTimersByTimeAsync(0);
    on = true;
    await vi.advanceTimersByTimeAsync(61_000);
    on = false;
    // older than 60 s since the last success? the SWR refresh above succeeded, so go idle again
    await vi.advanceTimersByTimeAsync(61_000);
    expect(await gate(req('/'), f)).toBeNull(); // awaited: sees "off" at once
  });

  it('6b. idle + dashboard down: the wait is bounded by 1 s and the last-known answer is served', async () => {
    let up = true;
    const f = vi.fn((_u: unknown, init?: RequestInit) =>
      up ? Promise.resolve(json(visitorAns())) : new Promise<Response>((_r, rej) => init?.signal?.addEventListener('abort', () => rej(new Error('a')))),
    );
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await gate(req('/'), f as never);
    up = false;
    await vi.advanceTimersByTimeAsync(61_000);
    const p = gate(req('/'), f as never);
    await vi.advanceTimersByTimeAsync(1000);
    expect((await p)!.status).toBe(503);
  });

  it.each(['/products/x.y/z', '/a.b/c', '/v1.2/page'])('7. %s (dot not in the last segment) is gated', async (p) => {
    const f = dashboard(() => json(visitorAns()));
    expect((await gate(req(p), f))!.status).toBe(503);
  });

  it.each(['/x/file.ext', '/favicon.ico', '/a.b/c/img.webp', '/robots.txt', '/sitemap.xml'])('7. %s is skipped', async (p) => {
    const f = dashboard(() => json(visitorAns()));
    expect(await gate(req(p), f)).toBeNull();
    expect(isSiteGateSkipped(p)).toBe(true);
  });

  it('8. behind a proxy: the 302 and the view cookie follow x-forwarded-host / x-forwarded-proto', async () => {
    const f = dashboard((h) => json(h.get('x-tus-site-preview') ? previewAns : visitorAns()));
    const r = new NextRequest(`http://localhost:3000/about?tus_preview=${PREVIEW}&a=1`, {
      headers: { 'x-forwarded-host': DOMAIN, 'x-forwarded-proto': 'https' },
    });
    const res = (await gate(r, f))!;
    expect(res.headers.get('location')).toBe(`https://${DOMAIN}/about?a=1`);
    const inside = new NextRequest('http://localhost:3000/', {
      headers: { 'x-forwarded-host': DOMAIN, 'x-forwarded-proto': 'https', cookie: `__Host-tus_site_pass=${PASS}` },
    });
    const g2 = dashboard(() => json(teamAns));
    expect((await gate(inside, g2))!.headers.get('set-cookie')).toMatch(/Secure/i);
  });

  it('8b. a malformed forwarded host is ignored', async () => {
    const f = dashboard(() => json(previewAns));
    const r = new NextRequest(`https://${DOMAIN}/x?tus_preview=${PREVIEW}`, { headers: { 'x-forwarded-host': 'evil.test/path?x=1' } });
    const res = (await gate(r, f))!;
    expect(res.headers.get('location')).toBe(`https://${DOMAIN}/x`);
  });

  it('8c. a forged x-forwarded-host / host never reaches the Location: it is pinned to the site domain', async () => {
    const f = dashboard(() => json(previewAns));
    for (const h of [{ 'x-forwarded-host': 'evil.test' }, { host: 'evil.test:8080' }, { 'x-forwarded-host': 'evil.test, ' + DOMAIN }]) {
      const r = new NextRequest(`http://localhost:3000/x?tus_preview=${PREVIEW}`, { headers: { ...h, 'x-forwarded-proto': 'https' } });
      expect((await gate(r, f))!.headers.get('location')).toBe(`https://${DOMAIN}/x`);
    }
  });

  it('8d. the real host matches case-insensitively and with a port', async () => {
    const f = dashboard(() => json(previewAns));
    const r = new NextRequest(`http://localhost:3000/x?tus_preview=${PREVIEW}`, {
      headers: { 'x-forwarded-host': DOMAIN.toUpperCase() + ':443', 'x-forwarded-proto': 'https' },
    });
    expect((await gate(r, f))!.headers.get('location')).toBe(`https://${DOMAIN}/x`);
  });
});

describe('rewriteRequestHeaders hook + cleanGateRequestHeaders', () => {
  const hdr = (res: Response, n: string) => res.headers.get(`x-middleware-request-${n}`);

  it('merges the hook result into the visitor rewrite (and the direct /site-coming-soon one)', async () => {
    const f = dashboard(() => json(visitorAns()));
    for (const p of ['/about', '/site-coming-soon']) {
      const res = (await gate(req(p), f, { rewriteRequestHeaders: () => ({ 'x-tus-language': 'he' }) }))!;
      expect(res.status).toBe(503);
      expect(hdr(res, 'x-tus-language')).toBe('he');
    }
  });

  it('is applied also on the token-invalid and unreachable visitor paths', async () => {
    const f = dashboard(() => new Response('x', { status: 500 }));
    const res = (await gate(req('/', { cookies: { '__Host-tus_site_pass': PASS } }), f, { rewriteRequestHeaders: () => ({ 'x-tus-language': 'en' }) }))!;
    expect(hdr(res, 'x-tus-language')).toBe('en');
  });

  it('cannot override x-tus-uc-variant / x-tus-uc-business-name (any case)', async () => {
    const f = dashboard(() => json(visitorAns()));
    const res = (await gate(req('/'), f, {
      rewriteRequestHeaders: () => ({ 'x-tus-uc-variant': 'banner', 'X-Tus-Uc-Business-Name': 'Evil', 'x-ok': '1' }),
    }))!;
    expect(hdr(res, 'x-tus-uc-variant')).toBe('split');
    expect(hdr(res, 'x-tus-uc-business-name')).toBe(encodeURIComponent('Acme Café'));
    expect(hdr(res, 'x-ok')).toBe('1');
  });

  it('a throwing hook is ignored: the rewrite still happens', async () => {
    const f = dashboard(() => json(visitorAns()));
    const res = (await gate(req('/'), f, { rewriteRequestHeaders: () => { throw new Error('boom'); } }))!;
    expect(res.status).toBe(503);
    expect(hdr(res, 'x-tus-uc-variant')).toBe('split');
  });

  it('the hook runs after the strip: a client-sent x-tus-site-* is gone, the hook value stays', async () => {
    const f = dashboard(() => json(visitorAns()));
    const res = (await gate(req('/', { headers: { 'x-tus-site-pass': 'x', 'x-tus-language': 'zz' } }), f, {
      rewriteRequestHeaders: () => ({ 'x-tus-language': 'he' }),
    }))!;
    expect(overrideList(res)).not.toContain('x-tus-site-pass');
    expect(hdr(res, 'x-tus-language')).toBe('he');
  });

  it('cleanGateRequestHeaders strips x-tus-site-* and x-tus-uc-* and keeps the rest, without mutating the input', () => {
    const h = new Headers({ 'x-tus-site-pass': 'a', 'X-Tus-Uc-Variant': 'b', 'x-tus-language': 'he', cookie: 'c=1' });
    const c = cleanGateRequestHeaders(h);
    expect([...Object.keys(Object.fromEntries(c.entries()))].sort()).toEqual(['cookie', 'x-tus-language']);
    expect(h.get('x-tus-site-pass')).toBe('a');
  });
});
