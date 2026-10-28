import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

type Mod = typeof import('../src/tracking');

const NOW = new Date('2026-10-28T10:00:00Z');
const iso = (offsetMs: number) => new Date(NOW.getTime() + offsetMs).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;

let mod: Mod;
let fbq: ReturnType<typeof vi.fn>;
let consent: boolean;

function order(over: Record<string, unknown> = {}) {
  return {
    orderId: 'ord-1',
    financialStatus: 'paid',
    total: 99.5,
    currency: 'ILS',
    paidAt: iso(-MIN),
    items: [{ productId: 'p1', quantity: 2, price: 10 }],
    ...over,
  } as Parameters<Mod['trackPurchase']>[0];
}

/** Run a tracker call to completion (past the 10 s wait). */
async function settle<T>(p: Promise<T>): Promise<T> {
  await vi.advanceTimersByTimeAsync(11_000);
  return p;
}

function setLocation(pathname: string) {
  window.history.replaceState({}, '', pathname);
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.resetModules();
  window.localStorage.clear();
  setLocation('/thank-you');
  consent = true;
  fbq = vi.fn();
  (window as any).fbq = fbq;
  mod = await import('../src/tracking');
  mod.configureTracking({ hasConsent: () => consent });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete (window as any).fbq;
});

describe('consent, configuration and fbq', () => {
  it('sends when consent and fbq are present', async () => {
    expect(await mod.trackPurchase(order())).toBe(true);
    expect(fbq).toHaveBeenCalledTimes(1);
  });

  it('consent off: nothing is sent and the key is not marked', async () => {
    consent = false;
    expect(await settle(mod.trackPurchase(order()))).toBe(false);
    expect(fbq).not.toHaveBeenCalled();
    consent = true;
    expect(await mod.trackPurchase(order())).toBe(true);
  });

  it('never configured: nothing is ever sent', async () => {
    vi.resetModules();
    const fresh = await import('../src/tracking');
    expect(await settle(fresh.trackPurchase(order()))).toBe(false);
    expect(await settle(fresh.trackLead('s1'))).toBe(false);
    expect(await settle(fresh.trackCompleteRegistration('reg_hub', 'm1'))).toBe(false);
    expect(fbq).not.toHaveBeenCalled();
  });

  it('a hasConsent that throws counts as no consent', async () => {
    mod.configureTracking({ hasConsent: () => { throw new Error('x'); } });
    expect(await settle(mod.trackLead('s1'))).toBe(false);
    expect(fbq).not.toHaveBeenCalled();
  });

  it('no fbq: nothing is sent', async () => {
    delete (window as any).fbq;
    expect(await settle(mod.trackLead('s1'))).toBe(false);
    expect(fbq).not.toHaveBeenCalled();
  });

  it('timeout after 10 s: dropped and not marked, a later call sends', async () => {
    delete (window as any).fbq;
    const p = mod.trackLead('s1');
    await vi.advanceTimersByTimeAsync(10_500);
    expect(await p).toBe(false);
    (window as any).fbq = fbq;
    expect(await mod.trackLead('s1')).toBe(true);
    expect(fbq).toHaveBeenCalledTimes(1);
  });

  it('consent given during the wait: sent', async () => {
    consent = false;
    const p = mod.trackLead('s1');
    await vi.advanceTimersByTimeAsync(3_000);
    expect(fbq).not.toHaveBeenCalled();
    consent = true;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await p).toBe(true);
    expect(fbq).toHaveBeenCalledTimes(1);
  });

  it('fbq defined during the wait: sent', async () => {
    delete (window as any).fbq;
    const p = mod.trackLead('s1');
    await vi.advanceTimersByTimeAsync(2_000);
    (window as any).fbq = fbq;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await p).toBe(true);
  });

  it('consent withdrawn during the wait: nothing sent, not marked', async () => {
    delete (window as any).fbq;
    const p = mod.trackLead('s1');
    await vi.advanceTimersByTimeAsync(1_000);
    consent = true;
    consent = false; // given and withdrawn before fbq appears
    (window as any).fbq = fbq;
    expect(await settle(p)).toBe(false);
    expect(fbq).not.toHaveBeenCalled();
    consent = true;
    expect(await mod.trackLead('s1')).toBe(true);
  });

  it('consent re-read immediately before fbq is called', async () => {
    let calls = 0;
    mod.configureTracking({
      hasConsent: () => {
        calls += 1;
        return calls <= 1; // true for the wait check, false at send time
      },
    });
    expect(await settle(mod.trackLead('s1'))).toBe(false);
    expect(fbq).not.toHaveBeenCalled();
  });
});

describe('guard', () => {
  it('inside a frame: nothing is sent for any event', async () => {
    const spy = vi.spyOn(window, 'top', 'get').mockReturnValue({} as unknown as Window);
    expect(await settle(mod.trackPurchase(order()))).toBe(false);
    expect(await settle(mod.trackLead('s1'))).toBe(false);
    expect(await settle(mod.trackCompleteRegistration('reg_hub'))).toBe(false);
    expect(fbq).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it.each(['/preview', '/preview/page', '/preview/section'])('%s: nothing is sent', async (path) => {
    setLocation(path);
    expect(await settle(mod.trackLead('s1'))).toBe(false);
    expect(await settle(mod.trackPurchase(order()))).toBe(false);
    expect(fbq).not.toHaveBeenCalled();
  });

  it('a path that merely contains preview later is not blocked', async () => {
    setLocation('/shop/preview-kit');
    expect(await mod.trackLead('s1')).toBe(true);
  });
});

describe('Purchase rules', () => {
  it('not paid: nothing', async () => {
    for (const s of ['pending', 'failed', 'refunded', 'partially_paid', '']) {
      expect(await settle(mod.trackPurchase(order({ financialStatus: s })))).toBe(false);
    }
    expect(fbq).not.toHaveBeenCalled();
  });

  it.each([0, NaN, -5, Infinity, '10' as unknown as number])('total %s: nothing', async (total) => {
    expect(await settle(mod.trackPurchase(order({ total })))).toBe(false);
    expect(fbq).not.toHaveBeenCalled();
  });

  it.each([undefined, null, '', 'US', 'USDX', 'U1D', ' USD'])('currency %j: nothing', async (currency) => {
    expect(await settle(mod.trackPurchase(order({ currency })))).toBe(false);
    expect(fbq).not.toHaveBeenCalled();
  });

  it('lower-case currency is sent upper-case', async () => {
    await mod.trackPurchase(order({ currency: 'usd' }));
    expect(fbq.mock.calls[0][2].currency).toBe('USD');
  });

  it('empty orderId: nothing', async () => {
    expect(await settle(mod.trackPurchase(order({ orderId: '' })))).toBe(false);
    expect(fbq).not.toHaveBeenCalled();
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['unparseable', 'not a date'],
    ['25 h old', iso(-25 * HOUR)],
    ['20 min in the future', iso(20 * MIN)],
  ])('paidAt %s: nothing', async (_n, paidAt) => {
    expect(await settle(mod.trackPurchase(order({ paidAt })))).toBe(false);
    expect(fbq).not.toHaveBeenCalled();
  });

  it('paidAt 23 h old and 5 min in the future are sent', async () => {
    expect(await mod.trackPurchase(order({ orderId: 'a', paidAt: iso(-23 * HOUR) }))).toBe(true);
    expect(await mod.trackPurchase(order({ orderId: 'b', paidAt: iso(5 * MIN) }))).toBe(true);
    expect(fbq).toHaveBeenCalledTimes(2);
  });

  it('value and currency come from the order; call shape and eventID', async () => {
    await mod.trackPurchase(order({ total: 123.45, currency: 'EUR', orderId: 'xyz' }));
    expect(fbq).toHaveBeenCalledWith(
      'track',
      'Purchase',
      { value: 123.45, currency: 'EUR', content_ids: ['p1'], contents: [{ id: 'p1', quantity: 2 }] },
      { eventID: 'purchase_xyz' },
    );
    const params = fbq.mock.calls[0][2];
    expect(params).not.toHaveProperty('num_items');
    expect(params).not.toHaveProperty('content_type');
  });

  it('null / empty productIds are left out of content_ids and contents', async () => {
    await mod.trackPurchase(
      order({ items: [{ productId: null, quantity: 1 }, { productId: '', quantity: 1 }, { productId: 'p9', quantity: 3 }, {}] }),
    );
    const params = fbq.mock.calls[0][2];
    expect(params.content_ids).toEqual(['p9']);
    expect(params.contents).toEqual([{ id: 'p9', quantity: 3 }]);
  });

  it('no qualifying items: neither content_ids nor contents', async () => {
    await mod.trackPurchase(order({ items: [{ productId: null }] }));
    await mod.trackPurchase(order({ orderId: 'o2', items: undefined }));
    for (const c of fbq.mock.calls) {
      expect(c[2]).not.toHaveProperty('content_ids');
      expect(c[2]).not.toHaveProperty('contents');
      expect(c[2]).toHaveProperty('value');
    }
    expect(fbq).toHaveBeenCalledTimes(2);
  });
});

describe('Lead and CompleteRegistration', () => {
  it('Lead: only with a non-empty submissionId; eventID lead_<id>', async () => {
    expect(await mod.trackLead(null)).toBe(false);
    expect(await mod.trackLead(undefined)).toBe(false);
    expect(await mod.trackLead('')).toBe(false);
    expect(fbq).not.toHaveBeenCalled();
    expect(await mod.trackLead('sub-7')).toBe(true);
    expect(fbq).toHaveBeenCalledWith('track', 'Lead', {}, { eventID: 'lead_sub-7' });
  });

  it('CompleteRegistration with memberId: eventID reg_<memberId>, no value or currency', async () => {
    expect(await mod.trackCompleteRegistration('reg_course_yoga', 'm-1')).toBe(true);
    expect(fbq).toHaveBeenCalledWith('track', 'CompleteRegistration', {}, { eventID: 'reg_m-1' });
  });

  it.each([undefined, null, ''])('CompleteRegistration with memberId %j: no 4th argument', async (memberId) => {
    expect(await mod.trackCompleteRegistration('reg_hub', memberId as any)).toBe(true);
    expect(fbq.mock.calls[0]).toHaveLength(3);
    expect(fbq.mock.calls[0].slice(0, 2)).toEqual(['track', 'CompleteRegistration']);
  });

  it('CompleteRegistration is keyed by the key argument, not the memberId', async () => {
    expect(await mod.trackCompleteRegistration('reg_course_a', 'm-1')).toBe(true);
    expect(await mod.trackCompleteRegistration('reg_course_a', 'm-2')).toBe(false);
    expect(await mod.trackCompleteRegistration('reg_course_b', 'm-1')).toBe(true);
    expect(fbq).toHaveBeenCalledTimes(2);
  });
});

describe('fired-key store', () => {
  it('a second call for the same key sends nothing (also after a reload)', async () => {
    expect(await mod.trackPurchase(order())).toBe(true);
    expect(await mod.trackPurchase(order())).toBe(false);
    expect(fbq).toHaveBeenCalledTimes(1);
    vi.resetModules();
    const reloaded = await import('../src/tracking');
    reloaded.configureTracking({ hasConsent: () => consent });
    expect(await reloaded.trackPurchase(order())).toBe(false);
    expect(fbq).toHaveBeenCalledTimes(1);
  });

  it('keys are written after the send, one namespaced entry', async () => {
    await mod.trackLead('s1');
    const keys = Object.keys(window.localStorage);
    expect(keys).toHaveLength(1);
    expect(JSON.parse(window.localStorage.getItem(keys[0])!)).toEqual(['lead_s1']);
  });

  it('two concurrent calls for the same key send once', async () => {
    const [a, b] = await Promise.all([mod.trackLead('s1'), mod.trackLead('s1')]);
    expect([a, b].sort()).toEqual([false, true]);
    expect(fbq).toHaveBeenCalledTimes(1);
  });

  it('two concurrent calls while waiting send once', async () => {
    consent = false;
    const a = mod.trackLead('s1');
    const b = mod.trackLead('s1');
    await vi.advanceTimersByTimeAsync(1_000);
    consent = true;
    await vi.advanceTimersByTimeAsync(1_000);
    expect([await a, await b].sort()).toEqual([false, true]);
    expect(fbq).toHaveBeenCalledTimes(1);
  });

  it('a key fired by another tab during the wait is not sent again', async () => {
    consent = false;
    const p = mod.trackLead('s1');
    await vi.advanceTimersByTimeAsync(500);
    window.localStorage.setItem('tus:tracking:fired', JSON.stringify(['lead_s1']));
    consent = true;
    expect(await settle(p)).toBe(false);
    expect(fbq).not.toHaveBeenCalled();
  });

  it('a dropped event never marks, so a later call sends', async () => {
    consent = false;
    expect(await settle(mod.trackLead('s1'))).toBe(false);
    expect(window.localStorage.length).toBe(0);
    consent = true;
    expect(await mod.trackLead('s1')).toBe(true);
  });

  it('a failed rule never marks', async () => {
    expect(await mod.trackPurchase(order({ financialStatus: 'pending' }))).toBe(false);
    expect(fbq).not.toHaveBeenCalled();
    expect(window.localStorage.length).toBe(0);
    expect(await mod.trackPurchase(order())).toBe(true);
    expect(fbq).toHaveBeenCalledTimes(1);
  });

  it('an fbq that throws does not mark', async () => {
    fbq.mockImplementationOnce(() => { throw new Error('boom'); });
    expect(await mod.trackLead('s1')).toBe(false);
    expect(window.localStorage.length).toBe(0);
    expect(await mod.trackLead('s1')).toBe(true);
  });

  it('localStorage that throws still sends and does not crash', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
    expect(await mod.trackLead('s1')).toBe(true);
    expect(fbq).toHaveBeenCalledTimes(1);
  });

  it('caps the stored keys, keeping the newest', async () => {
    const many = Array.from({ length: 200 }, (_, i) => 'old_' + i);
    window.localStorage.setItem('tus:tracking:fired', JSON.stringify(many));
    await mod.trackLead('new');
    const stored = JSON.parse(window.localStorage.getItem('tus:tracking:fired')!);
    expect(stored).toHaveLength(200);
    expect(stored[stored.length - 1]).toBe('lead_new');
    expect(stored).not.toContain('old_0');
  });
});
