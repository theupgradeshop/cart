import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { isPreviewPath } from '../src/preview-path';
import { CookieConsentProvider, isEmbeddedOrPreview, useConsent, type ConsentState } from '../src/consent';
import { trackLead, configureTracking } from '../src/tracking';

describe('isPreviewPath', () => {
  it.each(['/preview', '/preview/page/x', '/preview/'])('%s is preview', (p) => expect(isPreviewPath(p)).toBe(true));
  it.each(['/previews', '/preview-offer', '/', '/shop/preview', ''])('%s is not preview', (p) => expect(isPreviewPath(p)).toBe(false));
});

let api: ConsentState;
function Probe() {
  api = useConsent();
  return null;
}

describe('callers', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    window.history.replaceState({}, '', '/');
  });

  it.each([
    ['/preview', true],
    ['/preview/page/x', true],
    ['/preview-offer', false],
    ['/previews', false],
  ])('consent isEmbeddedOrPreview(%s) = %s', (path, want) => {
    window.history.replaceState({}, '', path);
    expect(isEmbeddedOrPreview()).toBe(want);
  });

  it.each([
    ['/preview', false],
    ['/preview/page/x', false],
    ['/preview-offer', true],
    ['/previews', true],
  ])('provider on %s fetches a country: %s', async (path, fetches) => {
    window.history.replaceState({}, '', path);
    const fn = vi.fn(async () => ({ ok: true, json: async () => ({ country: 'DE' }) }) as Response);
    vi.stubGlobal('fetch', fn);
    render(
      <CookieConsentProvider storageKey="pp" legacyAcceptedMeans={['marketing']} dashboardUrl="https://app.example.test"
        config={{ regions: { europe: 'ask', israel: 'notice', rest: 'notice' }, categoriesInUse: ['marketing'] }}>
        <Probe />
      </CookieConsentProvider>,
    );
    await act(async () => {});
    expect(fn.mock.calls.length > 0).toBe(fetches);
    expect(api.ready).toBe(fetches);
  });

  it.each([
    ['/preview', false],
    ['/preview/page/x', false],
    ['/preview-offer', true],
    ['/previews', true],
  ])('tracking on %s sends: %s', async (path, sends) => {
    window.history.replaceState({}, '', path);
    (window as any).fbq = vi.fn();
    configureTracking({ hasConsent: () => true, hasDeclined: () => false });
    const r = await trackLead('pp-' + path);
    delete (window as any).fbq;
    expect(r).toBe(sends);
  });
});
