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

/** Run a tracker call to completion (past the 1 h wait). */
async function settle<T>(p: Promise<T>): Promise<T> {
  await vi.advanceTimersByTimeAsync(HOUR + 11_000);
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
  window.sessionStorage.clear();
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

  it('still waiting at 10 s; dropped after 1 h and not marked, a later call sends', async () => {
    delete (window as any).fbq;
    const p = mod.trackLead('s1');
    let done = false;
    void p.then(() => { done = true; });
    await vi.advanceTimersByTimeAsync(10_500);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(HOUR);
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
      {
        value: 123.45,
        currency: 'EUR',
        content_ids: ['p1'],
        content_type: 'product',
        contents: [{ id: 'p1', quantity: 2 }],
      },
      { eventID: 'purchase_xyz' },
    );
    const params = fbq.mock.calls[0][2];
    expect(params).not.toHaveProperty('num_items');
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
      expect(c[2]).not.toHaveProperty('content_type');
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

describe('Lead form kind', () => {
  it.each(['contact', 'newsletter', 'waitlist', 'popup', 'lesson', 'product'] as const)('%s -> content_category', async (kind) => {
    expect(await mod.trackLead('k-' + kind, kind)).toBe(true);
    expect(fbq).toHaveBeenCalledWith('track', 'Lead', { content_category: kind }, { eventID: 'lead_k-' + kind });
  });

  it('no kind: params stay {}', async () => {
    await mod.trackLead('a');
    expect(fbq.mock.calls[0][2]).toEqual({});
  });

  it.each([['other'], [''], [null], [5], ['Contact']])('unknown kind %j is never sent', async (kind) => {
    expect(await mod.trackLead('u', kind as any)).toBe(true);
    expect(fbq.mock.calls[0][2]).toEqual({});
  });
});

describe('late consent', () => {
  it('consent arriving at 30 s: sent once and marked', async () => {
    consent = false;
    const p = mod.trackLead('s1', 'contact');
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fbq).not.toHaveBeenCalled();
    consent = true;
    await vi.advanceTimersByTimeAsync(2_500);
    expect(await p).toBe(true);
    expect(fbq).toHaveBeenCalledTimes(1);
    expect(JSON.parse(window.localStorage.getItem('tus:tracking:fired')!)).toEqual(['lead_s1']);
    await vi.advanceTimersByTimeAsync(HOUR);
    expect(fbq).toHaveBeenCalledTimes(1);
  });

  it('consent never given: nothing sent, nothing stored, dropped after 1 h', async () => {
    consent = false;
    const p = mod.trackLead('s1');
    await vi.advanceTimersByTimeAsync(HOUR - 5_000);
    let done = false;
    void p.then(() => { done = true; });
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await p).toBe(false);
    expect(fbq).not.toHaveBeenCalled();
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });

  it('hasDeclined true at creation: dropped at once, even if consent comes later', async () => {
    consent = false;
    let declinedNow = true;
    mod.configureTracking({ hasConsent: () => consent, hasDeclined: () => declinedNow });
    expect(await mod.trackLead('s1')).toBe(false);
    consent = true;
    declinedNow = false;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(fbq).not.toHaveBeenCalled();
  });

  it('a hasDeclined that throws counts as not declined', async () => {
    mod.configureTracking({ hasConsent: () => consent, hasDeclined: () => { throw new Error('x'); } });
    expect(await mod.trackLead('s1')).toBe(true);
  });

  it('the 21st pending event drops the oldest, which then never sends', async () => {
    consent = false;
    const ps: Promise<boolean>[] = [];
    for (let i = 0; i < 21; i++) ps.push(mod.trackLead('n' + i));
    await vi.advanceTimersByTimeAsync(500);
    consent = true;
    await vi.advanceTimersByTimeAsync(2_500);
    const results = await Promise.all(ps);
    expect(results[0]).toBe(false);
    expect(results.slice(1).every(Boolean)).toBe(true);
    expect(fbq).toHaveBeenCalledTimes(20);
    expect(fbq.mock.calls.map((c) => c[3].eventID)).not.toContain('lead_n0');
  });

  it('a framed or /preview event is never queued', async () => {
    consent = false;
    setLocation('/preview/page');
    expect(await mod.trackLead('s1')).toBe(false);
    setLocation('/thank-you');
    consent = true;
    mod.persistPendingTracking();
    expect(window.sessionStorage.length).toBe(0);
    const spy = vi.spyOn(window, 'top', 'get').mockReturnValue({} as unknown as Window);
    consent = false;
    expect(await mod.trackLead('s2')).toBe(false);
    spy.mockRestore();
    consent = true;
    mod.persistPendingTracking();
    expect(window.sessionStorage.length).toBe(0);
  });

  it('an already-fired key is never queued', async () => {
    window.localStorage.setItem('tus:tracking:fired', JSON.stringify(['lead_s1']));
    consent = false;
    expect(await mod.trackLead('s1')).toBe(false);
    consent = true;
    mod.persistPendingTracking();
    expect(window.sessionStorage.length).toBe(0);
  });
});

describe('review round 1', () => {
  const PKEY = 'tus:tracking:pending';
  const stored = (over: Record<string, unknown> = {}) => ({
    key: 'lead_p1',
    event: 'Lead',
    params: {},
    eventId: 'lead_p1',
    createdAt: NOW.getTime() - 5 * MIN,
    ...over,
  });
  async function reloaded() {
    vi.resetModules();
    return import('../src/tracking');
  }

  it('(a) created before configureTracking, then declined config, then accept: never sent', async () => {
    vi.resetModules();
    const fresh = await import('../src/tracking');
    let state: 'declined' | 'accepted' = 'declined';
    const p = fresh.trackLead('s1'); // config is still null: nothing says declined yet
    await vi.advanceTimersByTimeAsync(1_000);
    fresh.configureTracking({ hasConsent: () => state === 'accepted', hasDeclined: () => state === 'declined' });
    await vi.advanceTimersByTimeAsync(1_000);
    state = 'accepted';
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await p).toBe(false);
    expect(fbq).not.toHaveBeenCalled();
  });

  it('(b) declined in-page after creation, then accept: never sent, stored copy removed', async () => {
    let state: 'none' | 'declined' | 'accepted' = 'none';
    mod.configureTracking({ hasConsent: () => state === 'accepted', hasDeclined: () => state === 'declined' });
    const p = mod.trackLead('s1');
    await vi.advanceTimersByTimeAsync(1_000);
    window.sessionStorage.setItem(PKEY, JSON.stringify([stored({ key: 'lead_s1' })]));
    state = 'declined';
    await vi.advanceTimersByTimeAsync(300);
    state = 'accepted';
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await p).toBe(false);
    expect(fbq).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem(PKEY)).toBeNull();
  });

  it('a decline that appears between the last wake and the send is honoured', async () => {
    let declinedCalls = 0;
    mod.configureTracking({
      hasConsent: () => true,
      hasDeclined: () => ++declinedCalls >= 3, // creation, loop wake: false; send time: true
    });
    expect(await mod.trackLead('s1')).toBe(false);
    expect(fbq).not.toHaveBeenCalled();
  });

  it('cap drop removes the dropped entry from sessionStorage', async () => {
    consent = false;
    window.sessionStorage.setItem(PKEY, JSON.stringify([stored({ key: 'lead_n0' }), stored({ key: 'lead_other' })]));
    for (let i = 0; i < 21; i++) void mod.trackLead('n' + i);
    await vi.advanceTimersByTimeAsync(500);
    expect(JSON.parse(window.sessionStorage.getItem(PKEY)!).map((e: any) => e.key)).toEqual(['lead_other']);
  });

  it('a cap-dropped waiter that wakes with consent already true sends nothing', async () => {
    consent = false;
    const ps: Promise<boolean>[] = [];
    for (let i = 0; i < 21; i++) ps.push(mod.trackLead('n' + i));
    consent = true; // before any waiter wakes
    await vi.advanceTimersByTimeAsync(300);
    expect(await ps[0]).toBe(false);
    expect(fbq.mock.calls.map((c) => c[3].eventID)).not.toContain('lead_n0');
    expect(fbq).toHaveBeenCalledTimes(20);
  });

  it('persist with consent true and an empty list clears a stale pending list', () => {
    window.sessionStorage.setItem(PKEY, JSON.stringify([stored()]));
    mod.persistPendingTracking();
    expect(window.sessionStorage.getItem(PKEY)).toBeNull();
  });

  it('persist with consent false leaves a stored list alone', () => {
    window.sessionStorage.setItem(PKEY, JSON.stringify([stored()]));
    consent = false;
    mod.persistPendingTracking();
    expect(window.sessionStorage.getItem(PKEY)).not.toBeNull();
  });

  it('flush: createdAt more than 10 min in the future is dropped and removed; 5 min is kept', async () => {
    window.sessionStorage.setItem(
      PKEY,
      JSON.stringify([stored({ key: 'lead_far', eventId: 'lead_far', createdAt: NOW.getTime() + 11 * MIN }), stored({ key: 'lead_near', eventId: 'lead_near', createdAt: NOW.getTime() + 5 * MIN })]),
    );
    const next = await reloaded();
    next.configureTracking({ hasConsent: () => consent });
    await vi.advanceTimersByTimeAsync(500);
    expect(fbq).toHaveBeenCalledTimes(1);
    expect(fbq.mock.calls[0][3]).toEqual({ eventID: 'lead_near' });
    expect(window.sessionStorage.getItem(PKEY)).toBeNull();
  });

  it('age is checked before sending: no send lands past 1 h even when ready on the wake', async () => {
    consent = false;
    const p = mod.trackLead('s1');
    await vi.advanceTimersByTimeAsync(HOUR - 1_000); // next 2 s wake is at 1 h + ~1 s
    consent = true;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await p).toBe(false);
    expect(fbq).not.toHaveBeenCalled();
  });

  it('polls every 250 ms for the first 10 s, then every 2 s', async () => {
    let calls = 0;
    consent = false;
    mod.configureTracking({ hasConsent: () => { calls += 1; return consent; } });
    void mod.trackLead('s1');
    await vi.advanceTimersByTimeAsync(10_000);
    const early = calls;
    expect(early).toBeGreaterThanOrEqual(35);
    calls = 0;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(calls).toBeGreaterThanOrEqual(4);
    expect(calls).toBeLessThanOrEqual(6);
  });

  it('guard: a flushed entry on a /preview path is removed from storage and not sent', async () => {
    window.sessionStorage.setItem(PKEY, JSON.stringify([stored()]));
    setLocation('/preview/page');
    const next = await reloaded();
    next.configureTracking({ hasConsent: () => consent });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(fbq).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem(PKEY)).toBeNull();
  });

  it('guard: a flushed entry inside a frame is removed from storage and not sent', async () => {
    window.sessionStorage.setItem(PKEY, JSON.stringify([stored()]));
    const spy = vi.spyOn(window, 'top', 'get').mockReturnValue({} as unknown as Window);
    const next = await reloaded();
    next.configureTracking({ hasConsent: () => consent });
    await vi.advanceTimersByTimeAsync(2_000);
    spy.mockRestore();
    expect(fbq).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem(PKEY)).toBeNull();
  });
});

describe('persistPendingTracking and the reload flush', () => {
  const PKEY = 'tus:tracking:pending';
  const entry = (over: Record<string, unknown> = {}) => ({
    key: 'lead_p1',
    event: 'Lead',
    params: { content_category: 'newsletter' },
    eventId: 'lead_p1',
    createdAt: NOW.getTime() - 5 * MIN,
    ...over,
  });

  async function reloaded() {
    vi.resetModules();
    const m = await import('../src/tracking');
    return m;
  }

  it('consent false: writes nothing', async () => {
    consent = false;
    void mod.trackLead('s1');
    await vi.advanceTimersByTimeAsync(1_000);
    mod.persistPendingTracking();
    expect(window.sessionStorage.getItem(PKEY)).toBeNull();
  });

  it('consent true: writes the waiting list', async () => {
    delete (window as any).fbq; // consent is on but the pixel has not loaded yet
    void mod.trackLead('s1', 'popup');
    void mod.trackPurchase(order());
    await vi.advanceTimersByTimeAsync(1_000);
    mod.persistPendingTracking();
    const stored = JSON.parse(window.sessionStorage.getItem(PKEY)!);
    expect(stored).toHaveLength(2);
    expect(stored[0]).toEqual({
      key: 'lead_s1',
      event: 'Lead',
      params: { content_category: 'popup' },
      eventId: 'lead_s1',
      createdAt: NOW.getTime(),
    });
    expect(stored[1].event).toBe('Purchase');
    expect(stored[1].params.content_type).toBe('product');
  });

  it('throwing storage: returns without throwing', async () => {
    delete (window as any).fbq;
    void mod.trackLead('s1');
    await vi.advanceTimersByTimeAsync(500);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
    expect(() => mod.persistPendingTracking()).not.toThrow();
  });

  it('accept, persist, reload: the next page sends it once and clears the store', async () => {
    consent = false;
    void mod.trackLead('s1', 'newsletter');
    await vi.advanceTimersByTimeAsync(40_000);
    consent = true;
    delete (window as any).fbq;
    mod.persistPendingTracking();
    expect(window.sessionStorage.getItem(PKEY)).not.toBeNull();
    const next = await reloaded();
    next.configureTracking({ hasConsent: () => consent });
    expect(window.sessionStorage.getItem(PKEY)).not.toBeNull(); // kept until the send completes
    await vi.advanceTimersByTimeAsync(2_000);
    expect(fbq).not.toHaveBeenCalled();
    (window as any).fbq = fbq;
    await vi.advanceTimersByTimeAsync(2_500);
    expect(fbq).toHaveBeenCalledTimes(1);
    expect(fbq).toHaveBeenCalledWith('track', 'Lead', { content_category: 'newsletter' }, { eventID: 'lead_s1' });
    expect(window.sessionStorage.getItem(PKEY)).toBeNull();
  });

  it('configureTracking called twice in one page does not double-send', async () => {
    window.sessionStorage.setItem(PKEY, JSON.stringify([entry()]));
    delete (window as any).fbq;
    const next = await reloaded();
    next.configureTracking({ hasConsent: () => consent });
    next.configureTracking({ hasConsent: () => consent });
    (window as any).fbq = fbq;
    await vi.advanceTimersByTimeAsync(3_000);
    expect(fbq).toHaveBeenCalledTimes(1);
    next.configureTracking({ hasConsent: () => consent });
    await vi.advanceTimersByTimeAsync(3_000);
    expect(fbq).toHaveBeenCalledTimes(1);
  });

  it('flushes a fresh entry once', async () => {
    window.sessionStorage.setItem(PKEY, JSON.stringify([entry()]));
    const next = await reloaded();
    next.configureTracking({ hasConsent: () => consent });
    await vi.advanceTimersByTimeAsync(500);
    expect(fbq).toHaveBeenCalledTimes(1);
    expect(window.sessionStorage.getItem(PKEY)).toBeNull();
  });

  it('waits for its original creation time: dropped once 1 h from creation has passed', async () => {
    consent = false;
    window.sessionStorage.setItem(PKEY, JSON.stringify([entry({ createdAt: NOW.getTime() - 59 * MIN })]));
    const next = await reloaded();
    next.configureTracking({ hasConsent: () => consent });
    await vi.advanceTimersByTimeAsync(2 * MIN);
    consent = true;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(fbq).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem(PKEY)).toBeNull();
  });

  it('ignores an entry over 1 h old and removes it', async () => {
    window.sessionStorage.setItem(PKEY, JSON.stringify([entry({ createdAt: NOW.getTime() - HOUR - 1 })]));
    const next = await reloaded();
    next.configureTracking({ hasConsent: () => consent });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(fbq).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem(PKEY)).toBeNull();
  });

  it.each([
    ['not JSON', '{nope'],
    ['not an array', JSON.stringify({ a: 1 })],
    ['unknown event', JSON.stringify([entry({ event: 'Subscribe' })])],
    ['params an array', JSON.stringify([entry({ params: [] })])],
    ['params null', JSON.stringify([entry({ params: null })])],
    ['empty key', JSON.stringify([entry({ key: '' })])],
    ['eventId a number', JSON.stringify([entry({ eventId: 7 })])],
    ['createdAt a string', JSON.stringify([entry({ createdAt: 'x' })])],
    ['null item', JSON.stringify([null])],
  ])('malformed (%s): nothing sent', async (_n, raw) => {
    window.sessionStorage.setItem(PKEY, raw);
    const next = await reloaded();
    expect(() => next.configureTracking({ hasConsent: () => consent })).not.toThrow();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(fbq).not.toHaveBeenCalled();
  });

  it('keeps the valid entries when a malformed one sits beside them', async () => {
    window.sessionStorage.setItem(PKEY, JSON.stringify([entry({ key: '' }), entry()]));
    const next = await reloaded();
    consent = false;
    next.configureTracking({ hasConsent: () => consent });
    expect(JSON.parse(window.sessionStorage.getItem(PKEY)!)).toEqual([entry()]);
  });

  it('an entry with a null eventId is accepted and sent without an eventID', async () => {
    window.sessionStorage.setItem(PKEY, JSON.stringify([entry({ key: 'reg_hub', event: 'CompleteRegistration', params: {}, eventId: null })]));
    const next = await reloaded();
    next.configureTracking({ hasConsent: () => consent });
    await vi.advanceTimersByTimeAsync(500);
    expect(fbq).toHaveBeenCalledWith('track', 'CompleteRegistration', {});
  });

  it('an already-fired key is not re-sent and the entry is removed', async () => {
    window.localStorage.setItem('tus:tracking:fired', JSON.stringify(['lead_p1']));
    window.sessionStorage.setItem(PKEY, JSON.stringify([entry()]));
    const next = await reloaded();
    next.configureTracking({ hasConsent: () => consent });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(fbq).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem(PKEY)).toBeNull();
  });

  it('a stored entry stays while consent is missing and sends when it arrives', async () => {
    consent = false;
    window.sessionStorage.setItem(PKEY, JSON.stringify([entry()]));
    const next = await reloaded();
    next.configureTracking({ hasConsent: () => consent });
    await vi.advanceTimersByTimeAsync(20_000);
    expect(window.sessionStorage.getItem(PKEY)).not.toBeNull();
    consent = true;
    await vi.advanceTimersByTimeAsync(2_500);
    expect(fbq).toHaveBeenCalledTimes(1);
    expect(window.sessionStorage.getItem(PKEY)).toBeNull();
  });

  it('a stored entry is dropped when the visitor has declined', async () => {
    window.sessionStorage.setItem(PKEY, JSON.stringify([entry()]));
    const next = await reloaded();
    next.configureTracking({ hasConsent: () => false, hasDeclined: () => true });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(fbq).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem(PKEY)).toBeNull();
  });
});
