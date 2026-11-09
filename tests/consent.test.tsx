import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, act, waitFor } from '@testing-library/react';
import {
  CookieConsentProvider,
  useConsent,
  useCookieSettingsLink,
  useConsentScripts,
  injectConsentScripts,
  regionGroupOf,
  resolveMode,
  pageActions,
  GEO_TIMEOUT_MS,
  type ConsentConfig,
  type ConsentState,
  type ConsentCategory,
} from '../src/consent';
import { trackLead } from '../src/tracking';

const KEY = 'test-cookie-consent';
const BOTH: ConsentCategory[] = ['analytics', 'marketing'];

function cfg(over: Partial<ConsentConfig> = {}): ConsentConfig {
  return {
    regions: { europe: 'ask', israel: 'notice', rest: 'notice' },
    privacyPath: '/privacy',
    categoriesInUse: BOTH,
    googleAnalyticsId: 'G-TEST123',
    metaPixelId: '123456789',
    ...over,
  };
}

let api: ConsentState;
let link: { visible: boolean; open: () => void };
function Probe() {
  api = useConsent();
  link = useCookieSettingsLink();
  return null;
}

function geo(country: string | null | 'fail' | 'hang') {
  const fn = vi.fn(async (_url: string, init?: RequestInit) => {
    if (country === 'fail') throw new Error('blocked');
    if (country === 'hang') {
      return new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))));
    }
    return { ok: true, json: async () => ({ country }) } as Response;
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

async function mount(props: Partial<React.ComponentProps<typeof CookieConsentProvider>> = {}) {
  const view = render(
    <CookieConsentProvider
      storageKey={KEY}
      legacyAcceptedMeans={['marketing']}
      config={cfg()}
      dashboardUrl="https://app.example.test"
      hasNoticeWords
      {...props}
    >
      <Probe />
    </CookieConsentProvider>,
  );
  await act(async () => {});
  return view;
}

const gaScripts = () => document.querySelectorAll('script[src*="googletagmanager.com/gtag/js"]').length;
const fbScripts = () => document.querySelectorAll('script[src*="connect.facebook.net"]').length;

function setCookie(name: string) {
  document.cookie = `${name}=1; path=/`;
}
const hasCookie = (name: string) => document.cookie.split(';').some((c) => c.trim().startsWith(name + '='));

function store(value: unknown) {
  window.localStorage.setItem(KEY, typeof value === 'string' ? value : JSON.stringify(value));
}

beforeEach(() => {
  window.history.replaceState({}, '', '/');
  window.localStorage.clear();
  window.sessionStorage.clear();
  document.head.innerHTML = '';
  document.body.innerHTML = '';
  for (const k of ['fbq', '_fbq', 'gtag', 'dataLayer', '__tusConsentGa', '__tusConsentScripts']) delete (window as any)[k];
  vi.spyOn(pageActions, 'reload').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const n of ['_ga', '_gid', '_ga_ABC', '_fbp', '_fbc']) document.cookie = `${n}=; path=/; max-age=0`;
});

describe('regions', () => {
  it('maps countries to groups', () => {
    expect(regionGroupOf('DE')).toBe('europe');
    expect(regionGroupOf('is')).toBe('europe');
    expect(regionGroupOf('NO')).toBe('europe');
    expect(regionGroupOf('LI')).toBe('europe');
    expect(regionGroupOf('GB')).toBe('europe');
    expect(regionGroupOf('CH')).toBe('europe');
    expect(regionGroupOf('IL')).toBe('israel');
    expect(regionGroupOf('US')).toBe('rest');
    expect(regionGroupOf(null)).toBeNull();
    expect(regionGroupOf('XX')).toBeNull();
    expect(regionGroupOf('T1')).toBeNull();
    expect(regionGroupOf('garbage')).toBeNull();
  });

  it('owner modes apply per group; unknown country is always ask', () => {
    const c = cfg({ regions: { europe: 'notice', israel: 'ask', rest: 'notice' } });
    expect(resolveMode('FR', c)).toBe('notice');
    expect(resolveMode('IL', c)).toBe('ask');
    expect(resolveMode(null, c)).toBe('ask');
  });
});

describe('ask mode (Europe)', () => {
  it('draws the banner, runs nothing until the visitor answers, then loads after Accept', async () => {
    geo('DE');
    await mount();
    expect(api.ready && api.active).toBe(true);
    expect(api.mode).toBe('ask');
    expect(api.bannerOpen).toBe(true);
    expect(api.choices).toEqual({ analytics: false, marketing: false });
    expect(gaScripts()).toBe(0);
    expect(fbScripts()).toBe(0);
    act(() => api.acceptAll());
    expect(api.bannerOpen).toBe(false);
    expect(api.choices).toEqual({ analytics: true, marketing: true });
    expect(gaScripts()).toBe(1);
    expect(fbScripts()).toBe(1);
    expect(typeof (window as any).fbq).toBe('function');
    const saved = JSON.parse(window.localStorage.getItem(KEY) as string);
    expect(saved.mode).toBe('ask');
    expect(saved.asked).toEqual(['analytics', 'marketing']);
    expect(saved.choices).toEqual({ analytics: true, marketing: true });
  });

  it('Decline loads nothing and is kept', async () => {
    geo('FR');
    await mount();
    act(() => api.declineAll());
    expect(api.choices).toEqual({ analytics: false, marketing: false });
    expect(gaScripts() + fbScripts()).toBe(0);
    expect(pageActions.reload).not.toHaveBeenCalled(); // off -> off is not a withdrawal
  });

  it('loads only the category that was allowed', async () => {
    geo('DE');
    await mount();
    act(() => api.save({ analytics: true, marketing: false }));
    expect(gaScripts()).toBe(1);
    expect(fbScripts()).toBe(0);
  });
});

describe('notice mode (Israel, rest of world)', () => {
  it('runs the tools from the first visit and still shows the notice', async () => {
    geo('IL');
    await mount();
    expect(api.mode).toBe('notice');
    expect(api.choices).toEqual({ analytics: true, marketing: true });
    expect(api.bannerOpen).toBe(true);
    expect(gaScripts()).toBe(1);
    expect(fbScripts()).toBe(1);
    act(() => api.acceptAll()); // the notice OK
    expect(api.bannerOpen).toBe(false);
    expect(api.choices).toEqual({ analytics: true, marketing: true });
    expect(pageActions.reload).not.toHaveBeenCalled();
  });

  it('rest of world is notice too, and a stored off keeps the tool off', async () => {
    geo('US');
    store({ mode: 'notice', asked: BOTH, choices: { analytics: true, marketing: false }, at: 1 });
    await mount();
    expect(api.mode).toBe('notice');
    expect(api.bannerOpen).toBe(false);
    expect(api.choices).toEqual({ analytics: true, marketing: false });
    expect(gaScripts()).toBe(1);
    expect(fbScripts()).toBe(0);
  });

  it('is refused without notice words: inactive, nothing loads, one console.error', async () => {
    geo('IL');
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    await mount({ hasNoticeWords: undefined });
    expect(api.active).toBe(false);
    expect(api.bannerOpen).toBe(false);
    expect(link.visible).toBe(false);
    expect(gaScripts() + fbScripts()).toBe(0);
    expect(err).toHaveBeenCalledTimes(1);
    expect(String(err.mock.calls[0][0])).toContain('notice');
  });

  it('a notice region does not need notice words to still ask in Europe', async () => {
    geo('DE');
    await mount({ hasNoticeWords: undefined });
    expect(api.active).toBe(true);
    expect(api.bannerOpen).toBe(true);
  });
});

describe('unknown country, blocked or slow region call', () => {
  it('country null -> ask and active', async () => {
    geo(null);
    await mount();
    expect(api.mode).toBe('ask');
    expect(api.active && api.bannerOpen).toBe(true);
  });

  it('a blocked call (fetch throws) still draws the ask banner', async () => {
    geo('fail');
    await mount();
    expect(api.ready).toBe(true);
    expect(api.mode).toBe('ask');
    expect(api.active && api.bannerOpen).toBe(true);
    expect(api.choices).toEqual({ analytics: false, marketing: false });
  });

  it('a server error answer -> ask', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })));
    await mount();
    expect(api.mode).toBe('ask');
    expect(api.bannerOpen).toBe(true);
  });

  it('a call that never answers is cut at 1.5 s and the banner still draws', async () => {
    vi.useFakeTimers();
    const fn = geo('hang');
    render(
      <CookieConsentProvider storageKey={KEY} legacyAcceptedMeans={['marketing']} config={cfg()} dashboardUrl="https://app.example.test" hasNoticeWords>
        <Probe />
      </CookieConsentProvider>,
    );
    await act(async () => {});
    expect(api.ready).toBe(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(GEO_TIMEOUT_MS + 10);
    });
    expect(api.ready).toBe(true);
    expect(api.mode).toBe('ask');
    expect(api.bannerOpen).toBe(true);
    expect((fn.mock.calls[0][1] as RequestInit).signal?.aborted).toBe(true);
    // a failed call is not cached
    expect(window.sessionStorage.getItem(`${KEY}:geo`)).toBeNull();
  });

  it('no dashboardUrl -> no call, ask', async () => {
    const fn = geo('IL');
    await mount({ dashboardUrl: undefined });
    expect(fn).not.toHaveBeenCalled();
    expect(api.mode).toBe('ask');
  });

  it('calls the neutral visitor-geo path', async () => {
    const fn = geo('IL');
    await mount();
    expect(fn.mock.calls[0][0]).toBe('https://app.example.test/api/public/visitor-geo');
  });
});

describe('sessionStorage reuse', () => {
  it('one call per visit', async () => {
    const fn = geo('IL');
    const first = await mount();
    first.unmount();
    await mount();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(api.mode).toBe('notice');
  });
});

describe('re-ask rule (D5)', () => {
  it('banner again for a category not asked; an older off stays off; nothing new runs in ask', async () => {
    geo('DE');
    store({ mode: 'ask', asked: ['marketing'], choices: { analytics: false, marketing: false }, at: 1 });
    await mount();
    expect(api.bannerOpen).toBe(true); // analytics never asked
    expect(api.choices).toEqual({ analytics: false, marketing: false });
    expect(gaScripts() + fbScripts()).toBe(0);
  });

  it('a previous on stays on in ask while only the new category waits', async () => {
    geo('DE');
    store({ mode: 'ask', asked: ['marketing'], choices: { analytics: false, marketing: true }, at: 1 });
    await mount();
    expect(api.bannerOpen).toBe(true);
    expect(api.choices).toEqual({ analytics: false, marketing: true });
    expect(fbScripts()).toBe(1);
    expect(gaScripts()).toBe(0);
  });

  it('every category asked -> no banner', async () => {
    geo('DE');
    store({ mode: 'ask', asked: BOTH, choices: { analytics: true, marketing: false }, at: 1 });
    await mount();
    expect(api.bannerOpen).toBe(false);
    expect(api.choices).toEqual({ analytics: true, marketing: false });
  });

  it('stored notice and now ask -> banner again, nothing runs until answered', async () => {
    geo('DE');
    store({ mode: 'notice', asked: BOTH, choices: { analytics: true, marketing: true }, at: 1 });
    await mount();
    expect(api.bannerOpen).toBe(true);
    expect(api.choices).toEqual({ analytics: false, marketing: false });
    expect(gaScripts() + fbScripts()).toBe(0);
  });

  it('notice region: a new category runs at once, the older off stays off, banner shows for the new one', async () => {
    geo('IL');
    store({ mode: 'notice', asked: ['marketing'], choices: { analytics: false, marketing: false }, at: 1 });
    await mount();
    expect(api.bannerOpen).toBe(true);
    expect(api.choices).toEqual({ analytics: true, marketing: false });
  });

  it('a category no longer in use does not re-ask', async () => {
    geo('DE');
    store({ mode: 'ask', asked: ['marketing'], choices: { analytics: false, marketing: true }, at: 1 });
    await mount({ config: cfg({ categoriesInUse: ['marketing'] }) });
    expect(api.bannerOpen).toBe(false);
    expect(api.categories).toEqual(['marketing']);
  });
});

describe('storage key and legacy values', () => {
  it('"accepted" with legacy [marketing]: marketing on, analytics off, asked for exactly marketing', async () => {
    geo('DE');
    store('accepted');
    await mount({ legacyAcceptedMeans: ['marketing'] });
    expect(api.choices).toEqual({ analytics: false, marketing: true });
    expect(api.bannerOpen).toBe(true); // analytics was never asked
  });

  it('"accepted" with legacy both: both on, no banner', async () => {
    geo('DE');
    store('accepted');
    await mount({ legacyAcceptedMeans: BOTH });
    expect(api.choices).toEqual({ analytics: true, marketing: true });
    expect(api.bannerOpen).toBe(false);
  });

  it('"declined": all off, asked for the legacy categories only', async () => {
    geo('DE');
    store('declined');
    await mount({ legacyAcceptedMeans: ['marketing'] });
    expect(api.choices).toEqual({ analytics: false, marketing: false });
    expect(api.bannerOpen).toBe(true); // analytics not asked
    cleanup();
    await mount({ legacyAcceptedMeans: BOTH });
    expect(api.bannerOpen).toBe(false);
  });

  it('"declined" keeps analytics off in a notice region', async () => {
    geo('IL');
    store('declined');
    await mount({ legacyAcceptedMeans: ['marketing'] });
    // marketing was asked and declined; analytics (never asked) runs under the notice
    expect(api.choices).toEqual({ analytics: true, marketing: false });
  });

  it('honours storageKey: another key is ignored', async () => {
    geo('DE');
    window.localStorage.setItem('some-other-key', 'accepted');
    await mount({ legacyAcceptedMeans: BOTH });
    expect(api.choices).toEqual({ analytics: false, marketing: false });
    expect(api.bannerOpen).toBe(true);
    act(() => api.acceptAll());
    expect(window.localStorage.getItem(KEY)).not.toBeNull();
    expect(window.localStorage.getItem('some-other-key')).toBe('accepted');
  });
});

describe('withdrawal', () => {
  it('on -> off for marketing clears _fbp/_fbc only and reloads', async () => {
    geo('DE');
    store({ mode: 'ask', asked: BOTH, choices: { analytics: true, marketing: true }, at: 1 });
    await mount();
    setCookie('_fbp');
    setCookie('_fbc');
    setCookie('_ga');
    act(() => api.save({ marketing: false }));
    expect(hasCookie('_fbp')).toBe(false);
    expect(hasCookie('_fbc')).toBe(false);
    expect(hasCookie('_ga')).toBe(true);
    expect(pageActions.reload).toHaveBeenCalledTimes(1);
  });

  it('on -> off for analytics clears _ga, _ga_*, _gid and reloads', async () => {
    geo('DE');
    store({ mode: 'ask', asked: BOTH, choices: { analytics: true, marketing: true }, at: 1 });
    await mount();
    setCookie('_ga');
    setCookie('_gid');
    setCookie('_ga_ABC');
    setCookie('_fbp');
    act(() => api.save({ analytics: false }));
    expect(hasCookie('_ga')).toBe(false);
    expect(hasCookie('_gid')).toBe(false);
    expect(hasCookie('_ga_ABC')).toBe(false);
    expect(hasCookie('_fbp')).toBe(true);
    expect(pageActions.reload).toHaveBeenCalledTimes(1);
  });

  it('a notice visitor who switches a running tool off reloads', async () => {
    geo('IL');
    await mount();
    act(() => api.save({ marketing: false }));
    expect(pageActions.reload).toHaveBeenCalledTimes(1);
  });

  it('off -> on never reloads', async () => {
    geo('DE');
    await mount();
    act(() => api.acceptAll());
    expect(pageActions.reload).not.toHaveBeenCalled();
  });

  it('clears the cookies of a category already declined when the page loads', async () => {
    geo('DE');
    store({ mode: 'ask', asked: BOTH, choices: { analytics: false, marketing: true }, at: 1 });
    setCookie('_ga');
    setCookie('_fbp');
    await mount();
    expect(hasCookie('_ga')).toBe(false);
    expect(hasCookie('_fbp')).toBe(true);
  });
});

describe('cart events (tracking)', () => {
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

  it('Lead waits while unanswered in ask mode and fires once marketing is on', async () => {
    geo('DE');
    await mount();
    const fbq = vi.fn();
    (window as any).fbq = fbq;
    const sent = trackLead('consent-test-1');
    await wait(700);
    expect(fbq).not.toHaveBeenCalled();
    act(() => api.save({ analytics: true, marketing: true }));
    await waitFor(() => expect(fbq).toHaveBeenCalledWith('track', 'Lead', {}, { eventID: 'lead_consent-test-1' }), { timeout: 2000 });
    expect(await sent).toBe(true);
  });

  it('analytics alone is not marketing: the Lead is dropped and never sent', async () => {
    geo('DE');
    await mount();
    const fbq = vi.fn();
    (window as any).fbq = fbq;
    const sent = trackLead('consent-test-4');
    act(() => api.save({ analytics: true, marketing: false }));
    expect(await sent).toBe(false);
    await wait(500);
    expect(fbq).not.toHaveBeenCalled();
  });

  it('notice region: marketing runs from the start, so Lead fires at once', async () => {
    geo('IL');
    await mount();
    const fbq = vi.fn();
    (window as any).fbq = fbq; // replaces the pixel stub so the call is observable
    await expect(trackLead('consent-test-2')).resolves.toBe(true);
    expect(fbq).toHaveBeenCalledWith('track', 'Lead', {}, { eventID: 'lead_consent-test-2' });
  });

  it('an explicit decline drops the event at once', async () => {
    geo('DE');
    await mount();
    act(() => api.declineAll());
    (window as any).fbq = vi.fn();
    await expect(trackLead('consent-test-3')).resolves.toBe(false);
  });
});

describe('embedded and preview', () => {
  it('inactive on /preview*: no call, no banner, nothing loaded', async () => {
    window.history.replaceState({}, '', '/preview/page?slug=home');
    const fn = geo('IL');
    await mount();
    expect(api.active).toBe(false);
    expect(api.bannerOpen).toBe(false);
    expect(link.visible).toBe(false);
    expect(fn).not.toHaveBeenCalled();
    expect(gaScripts() + fbScripts()).toBe(0);
  });

  it('inactive inside an iframe', async () => {
    const fn = geo('IL');
    const desc = Object.getOwnPropertyDescriptor(window, 'top');
    Object.defineProperty(window, 'top', { configurable: true, value: {} });
    try {
      await mount();
      expect(api.active).toBe(false);
      expect(api.bannerOpen).toBe(false);
      expect(fn).not.toHaveBeenCalled();
      expect(gaScripts() + fbScripts()).toBe(0);
    } finally {
      if (desc) Object.defineProperty(window, 'top', desc);
      else delete (window as any).top;
    }
  });

  it('no tool in use -> not active, no footer link', async () => {
    geo('DE');
    await mount({ config: cfg({ categoriesInUse: [] }) });
    expect(api.active).toBe(false);
    expect(api.bannerOpen).toBe(false);
    expect(link.visible).toBe(false);
  });
});

describe('settings link and panel state', () => {
  it('the link is visible when active and opens/closes the panel', async () => {
    geo('DE');
    await mount();
    expect(link.visible).toBe(true);
    act(() => link.open());
    expect(api.settingsOpen).toBe(true);
    act(() => api.closeSettings());
    expect(api.settingsOpen).toBe(false);
  });

  it('useConsent outside the provider is inert', () => {
    render(<Probe />);
    expect(api.active).toBe(false);
    expect(api.bannerOpen).toBe(false);
    expect(link.visible).toBe(false);
  });
});

describe('site scripts by category', () => {
  const items = [
    { id: 'a', placement: 'head', content: '<meta name="a-analytics">', category: 'analytics' as const },
    { id: 'm', placement: 'head', content: '<meta name="m-marketing">', category: 'marketing' as const },
    { id: 'n', placement: 'bodyEnd', content: '<i id="n-null"></i>', category: null },
    { id: 'x', placement: 'bodyStart', content: '<i id="x-necessary"></i>', category: 'necessary' as const },
    { id: 'e', placement: 'bodyEnd', content: '   ', category: 'marketing' as const },
  ];

  it('injects only allowed categories; null counts as marketing; necessary always', () => {
    const done = injectConsentScripts(items, { analytics: true, marketing: false });
    expect(done.map((i) => i.id)).toEqual(['a', 'x']);
    expect(document.querySelector('meta[name="a-analytics"]')).not.toBeNull();
    expect(document.querySelector('meta[name="m-marketing"]')).toBeNull();
    expect(document.getElementById('n-null')).toBeNull();
    expect(document.getElementById('x-necessary')).not.toBeNull();
    // idempotent, and marketing (null included) joins when allowed
    injectConsentScripts(items, { analytics: true, marketing: true });
    expect(document.querySelectorAll('meta[name="a-analytics"]').length).toBe(1);
    expect(document.querySelector('meta[name="m-marketing"]')).not.toBeNull();
    expect(document.getElementById('n-null')).not.toBeNull();
  });

  it('puts bodyStart first and rebuilds <script> so it runs', () => {
    injectConsentScripts([{ id: 's', placement: 'bodyStart', content: '<script>window.__ran = 1</script>', category: 'necessary' }], {
      analytics: false,
      marketing: false,
    });
    // jsdom does not run inline scripts; the proof is a fresh <script> element carrying the code, first in <body>
    const first = document.body.firstElementChild as HTMLScriptElement;
    expect(first.tagName).toBe('SCRIPT');
    expect(first.text).toContain('__ran');
  });

  function Scripts() {
    useConsentScripts(items);
    return null;
  }

  it('the hook waits for consent in ask mode', async () => {
    geo('DE');
    render(
      <CookieConsentProvider storageKey={KEY} legacyAcceptedMeans={['marketing']} config={cfg()} dashboardUrl="https://app.example.test" hasNoticeWords>
        <Probe />
        <Scripts />
      </CookieConsentProvider>,
    );
    await act(async () => {});
    expect(document.querySelector('meta[name="a-analytics"]')).toBeNull();
    expect(document.querySelector('meta[name="m-marketing"]')).toBeNull();
    expect(document.getElementById('x-necessary')).not.toBeNull();
    act(() => api.save({ analytics: true, marketing: false }));
    expect(document.querySelector('meta[name="a-analytics"]')).not.toBeNull();
    expect(document.querySelector('meta[name="m-marketing"]')).toBeNull();
  });
});

describe('loaders', () => {
  it('Meta Pixel: autoConfig off before init, PageView after; skipped on a capability page', async () => {
    window.history.replaceState({}, '', '/s/' + 'a'.repeat(32));
    geo('IL');
    await mount();
    expect(fbScripts()).toBe(0);
    expect(gaScripts()).toBe(0);
  });

  it('Meta Pixel call order', async () => {
    geo('IL');
    await mount();
    const q = ((window as any).fbq.queue as unknown[][]).map((a) => Array.from(a as any[]).slice(0, 2));
    expect(q).toEqual([['set', 'autoConfig'], ['init', '123456789'], ['track', 'PageView']]);
  });

  it('rejects malformed ids', async () => {
    geo('IL');
    await mount({ config: cfg({ metaPixelId: "1');alert(1)//", googleAnalyticsId: 'x"><script>' }) });
    expect(fbScripts() + gaScripts()).toBe(0);
  });
});
