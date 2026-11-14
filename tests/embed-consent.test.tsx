import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import {
  CookieConsentProvider,
  useEmbedConsent,
  embedAskFirst,
  isEmbedsMode,
  type ConsentConfig,
  type EmbedsMode,
} from '../src/consent';

const KEY = 'test-embed-consent';

function cfg(over: Partial<ConsentConfig> = {}): ConsentConfig {
  return {
    regions: { europe: 'ask', israel: 'notice', rest: 'notice' },
    privacyPath: '/privacy',
    categoriesInUse: [],
    ...over,
  };
}

let seen: Array<'load' | 'ask' | 'pending'> = [];
function Probe({ editing = false }: { editing?: boolean }) {
  const s = useEmbedConsent(editing);
  seen.push(s);
  return <span data-state={s} />;
}
const last = () => seen[seen.length - 1];

function geo(country: string | null) {
  const fn = vi.fn(async () => ({ ok: true, json: async () => ({ country }) }) as Response);
  vi.stubGlobal('fetch', fn);
  return fn;
}

async function mount(embeds: EmbedsMode | undefined, editing = false) {
  const config = embeds === undefined ? cfg() : cfg({ embeds });
  const view = render(
    <CookieConsentProvider storageKey={KEY} legacyAcceptedMeans={['marketing']} config={config} dashboardUrl="https://app.example.test">
      <Probe editing={editing} />
    </CookieConsentProvider>,
  );
  await act(async () => {});
  return view;
}

beforeEach(() => {
  seen = [];
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.history.replaceState({}, '', '/');
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('embedAskFirst (pure)', () => {
  const groups: Array<[string, string | null, boolean]> = [
    ['europe (DE)', 'DE', true],
    ['europe (GB)', 'GB', true],
    ['israel', 'IL', false],
    ['rest (US)', 'US', false],
    ['unknown (null)', null, true],
    ['unknown (XX)', 'XX', true],
    ['malformed', 'europe', true],
  ];
  for (const [name, country, europeAsk] of groups) {
    it(`europe_ask, ${name} -> ${europeAsk}`, () => expect(embedAskFirst('europe_ask', country)).toBe(europeAsk));
    it(`always_load, ${name} -> false`, () => expect(embedAskFirst('always_load', country)).toBe(false));
    it(`absent, ${name} -> same as europe_ask`, () => expect(embedAskFirst(undefined, country)).toBe(europeAsk));
  }
  it('an unknown value acts as europe_ask', () => {
    expect(embedAskFirst('whatever' as unknown as EmbedsMode, 'DE')).toBe(true);
    expect(embedAskFirst('whatever' as unknown as EmbedsMode, 'US')).toBe(false);
  });
  it('isEmbedsMode accepts exactly the two values', () => {
    expect(isEmbedsMode('europe_ask')).toBe(true);
    expect(isEmbedsMode('always_load')).toBe(true);
    expect(isEmbedsMode('ask')).toBe(false);
    expect(isEmbedsMode(undefined)).toBe(false);
  });
});

describe('useEmbedConsent', () => {
  const table: Array<[string, string | null, EmbedsMode | undefined, 'load' | 'ask']> = [
    ['europe', 'FR', 'europe_ask', 'ask'],
    ['europe', 'FR', 'always_load', 'load'],
    ['israel', 'IL', 'europe_ask', 'load'],
    ['israel', 'IL', 'always_load', 'load'],
    ['rest', 'US', 'europe_ask', 'load'],
    ['rest', 'US', 'always_load', 'load'],
    ['unknown', null, 'europe_ask', 'ask'],
    ['unknown', null, 'always_load', 'load'],
    ['europe', 'NL', undefined, 'ask'],
    ['rest', 'JP', undefined, 'load'],
    ['unknown', null, undefined, 'ask'],
  ];
  for (const [group, country, embeds, want] of table) {
    it(`${group} visitor, embeds ${embeds ?? 'absent'} -> ${want}`, async () => {
      geo(country);
      await mount(embeds);
      expect(last()).toBe(want);
    });
  }

  it('is pending before the country resolves, then resolves', async () => {
    let release: (r: Response) => void = () => {};
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((res) => (release = res))));
    await mount('europe_ask');
    expect(seen[0]).toBe('pending');
    expect(last()).toBe('pending');
    await act(async () => release({ ok: true, json: async () => ({ country: 'US' }) } as Response));
    expect(last()).toBe('load');
  });

  it('a failed country call leaves the country unknown: ask (europe_ask), load (always_load)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('blocked'); }));
    await mount('europe_ask');
    expect(last()).toBe('ask');
    cleanup();
    seen = [];
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('blocked'); }));
    await mount('always_load');
    expect(last()).toBe('load');
  });

  it('renderToString (server, not editing) gives pending', () => {
    const html = renderToString(
      <CookieConsentProvider storageKey={KEY} legacyAcceptedMeans={[]} config={cfg({ embeds: 'always_load' })}>
        <Probe />
      </CookieConsentProvider>,
    );
    expect(html).toContain('data-state="pending"');
  });

  it('editing -> load, on the server, before and after mount, in any region', async () => {
    expect(renderToString(<Probe editing />)).toContain('data-state="load"');
    geo('DE');
    await mount('europe_ask', true);
    expect(seen.every((s) => s === 'load')).toBe(true);
  });

  it('outside a provider -> ask (and load only when editing)', () => {
    expect(renderToString(<Probe />)).toContain('data-state="ask"');
    expect(renderToString(<Probe editing />)).toContain('data-state="load"');
  });

  it('a framed visit never resolves a country: stays pending, no country fetch', async () => {
    const spy = vi.spyOn(window, 'top', 'get').mockReturnValue({} as unknown as Window & typeof globalThis);
    const fn = geo('US');
    await mount('always_load');
    expect(spy).toHaveBeenCalled();
    expect(fn).not.toHaveBeenCalled();
    expect(seen.every((s) => s === 'pending')).toBe(true);
  });

  it('a framed visit with editing true still loads', async () => {
    vi.spyOn(window, 'top', 'get').mockReturnValue({} as unknown as Window & typeof globalThis);
    geo('DE');
    await mount('europe_ask', true);
    expect(last()).toBe('load');
  });

  it('a garbage config.embeds acts as europe_ask: Europe asks, Israel loads', async () => {
    const garbage = 'sometimes' as unknown as EmbedsMode;
    geo('DE');
    await mount(garbage);
    expect(last()).toBe('ask');
    cleanup();
    seen = [];
    window.sessionStorage.clear(); // the resolved country is cached per storage key for the session
    geo('IL');
    await mount(garbage);
    expect(last()).toBe('load');
  });
});
