import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { SiteGateBar, PreviewPill } from '../src/site-gate/client';

const bar = (
  <SiteGateBar text="Under construction" visitorViewLabel="View as visitors see it" settingsLabel="Settings" settingsUrl="https://app.example.test/settings/website" />
);
const pill = <PreviewPill text="Preview - not public yet" />;

function setView(v: string | null) {
  document.cookie = v === null ? 'tus_site_view=; Max-Age=0; Path=/' : `tus_site_view=${v}; Path=/`;
}

beforeEach(() => {
  window.history.pushState({}, '', '/about?x=1');
});
afterEach(() => {
  cleanup();
  setView(null);
});

describe('SiteGateBar', () => {
  it('team view: renders text and both links; visitor link = current path + tus_view=visitor', () => {
    setView('team');
    const { container, getByText } = render(bar);
    expect(container.querySelector('[data-site-gate-bar]')).not.toBeNull();
    expect(getByText('Under construction')).toBeTruthy();
    expect(getByText('Settings').getAttribute('href')).toBe('https://app.example.test/settings/website');
    expect(getByText('View as visitors see it').getAttribute('href')).toBe('/about?x=1&tus_view=visitor');
  });

  it('uses logical properties and the charcoal bar with a gold dot', () => {
    setView('team');
    const { container } = render(bar);
    const el = container.querySelector('[data-site-gate-bar]') as HTMLElement;
    expect(el.style.background).toMatch(/rgb\(26, 26, 26\)|#1a1a1a/i);
    expect(el.style.paddingInline).toBe('16px');
    expect(el.style.insetBlockStart).toBe('0');
    const dot = el.querySelector('span[aria-hidden]') as HTMLElement;
    expect(dot.style.background).toMatch(/rgb\(200, 152, 30\)|#c8981e/i);
  });

  it.each([['preview'], [null], ['garbage']])('cookie %s: renders nothing', (v) => {
    setView(v);
    expect(render(bar).container.innerHTML).toBe('');
  });

  it('nothing on /preview and /preview/*', () => {
    setView('team');
    for (const p of ['/preview', '/preview/page']) {
      window.history.pushState({}, '', p);
      expect(render(bar).container.innerHTML).toBe('');
      cleanup();
    }
  });

  it('/preview-x is an ordinary page: the bar shows', () => {
    setView('team');
    window.history.pushState({}, '', '/preview-x');
    expect(render(bar).container.querySelector('[data-site-gate-bar]')).not.toBeNull();
  });

  it('nothing inside an iframe', () => {
    setView('team');
    const real = Object.getOwnPropertyDescriptor(window, 'top');
    Object.defineProperty(window, 'top', { value: {}, configurable: true });
    try {
      expect(render(bar).container.innerHTML).toBe('');
    } finally {
      if (real) Object.defineProperty(window, 'top', real);
      else delete (window as unknown as Record<string, unknown>).top;
    }
  });
});

describe('PreviewPill', () => {
  it('preview view: a bottom-start pill with the words', () => {
    setView('preview');
    const { container, getByText } = render(pill);
    const el = container.querySelector('[data-site-gate-pill]') as HTMLElement;
    expect(getByText('Preview - not public yet')).toBeTruthy();
    expect(el.style.insetBlockEnd).toBe('16px');
    expect(el.style.insetInlineStart).toBe('16px');
  });

  it.each([['team'], [null]])('cookie %s: renders nothing', (v) => {
    setView(v);
    expect(render(pill).container.innerHTML).toBe('');
  });

  it('nothing on /preview* or inside an iframe', () => {
    setView('preview');
    window.history.pushState({}, '', '/preview/page');
    expect(render(pill).container.innerHTML).toBe('');
  });
});

describe('review round 1 (client)', () => {
  it('a malformed cookie value (bad percent escape) renders nothing and does not throw', () => {
    document.cookie = 'tus_site_view=%E0%A4%A; Path=/';
    expect(render(bar).container.innerHTML).toBe('');
  });

  it('the visitor link never starts with two slashes', () => {
    setView('team');
    window.history.pushState({}, '', '/a//evil.test/path'); // jsdom cannot hold a leading `//`; the collapse is a belt-and-braces guard
    const { getByText } = render(bar);
    const href = getByText('View as visitors see it').getAttribute('href')!;
    expect(href.startsWith('//')).toBe(false);
    expect(href.startsWith('/')).toBe(true);
  });
});
