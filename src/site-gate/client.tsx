'use client';
// Client pieces of the under-construction gate (`@upgradeshop/cart/site-gate/client`).
// The gate sets a readable `tus_site_view` cookie ("team" | "preview"); these read it AFTER mount (the server
// render and the first client render are empty, so there is no hydration mismatch) and render nothing on the
// editor's /preview* pages or inside an iframe. Words come from the site (props), never from here.
// Inline styles only (no Tailwind dependency); logical properties so RTL needs nothing.
import { useEffect, useState, type CSSProperties } from 'react';
import { VIEW_COOKIE, VIEW_PARAM } from './shared';

const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const CHARCOAL = '#1A1A1A';
const GOLD = '#C8981E';

function readViewCookie(): string | null {
  if (typeof document === 'undefined') return null;
  for (const part of document.cookie.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === VIEW_COOKIE) {
      try {
        return decodeURIComponent(part.slice(i + 1).trim());
      } catch {
        return null; // malformed: no bar
      }
    }
  }
  return null;
}

function inIframe(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    return true; // cross-origin top: certainly framed
  }
}

/** The view to show, or null when nothing should render (SSR, editor preview, framed, no cookie). */
function useGateView(): string | null {
  const [view, setView] = useState<string | null>(null);
  useEffect(() => {
    const p = window.location.pathname;
    if (p === '/preview' || p.startsWith('/preview/') || inIframe()) {
      setView(null);
      return;
    }
    setView(readViewCookie());
  }, []);
  return view;
}

function visitorViewHref(): string {
  const url = new URL(window.location.href);
  url.searchParams.set(VIEW_PARAM, 'visitor');
  // Never `//host`: a path that starts with several slashes would read as a protocol-relative URL.
  return '/' + url.pathname.replace(/^\/+/, '') + url.search;
}

const dot: CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: '50%',
  background: GOLD,
  flex: 'none',
};

export interface SiteGateBarProps {
  /** e.g. the site's word for "Under construction. Visitors see the coming-soon page." */
  text: string;
  /** The site's word for "View as visitors see it". */
  visitorViewLabel: string;
  /** The site's word for "Settings". */
  settingsLabel: string;
  /** Where "Settings" goes (the dashboard's Website Settings URL). */
  settingsUrl: string;
}

/** Team view: slim charcoal sticky bar with a gold dot. */
export function SiteGateBar({ text, visitorViewLabel, settingsLabel, settingsUrl }: SiteGateBarProps) {
  const view = useGateView();
  const [visitorHref, setVisitorHref] = useState<string | null>(null);
  useEffect(() => {
    if (view === 'team') setVisitorHref(visitorViewHref());
  }, [view]);
  if (view !== 'team') return null;
  const link: CSSProperties = { color: '#fff', textDecoration: 'underline', textUnderlineOffset: 2 };
  return (
    <div
      data-site-gate-bar=""
      role="region"
      style={{
        position: 'sticky',
        insetBlockStart: 0,
        zIndex: 2147483000,
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 12,
        paddingBlock: 6,
        paddingInline: 16,
        background: CHARCOAL,
        color: '#fff',
        fontFamily: FONT,
        fontSize: 13,
        lineHeight: 1.4,
      }}
    >
      <span aria-hidden="true" style={dot} />
      <span style={{ flex: '1 1 auto' }}>{text}</span>
      {visitorHref ? (
        <a href={visitorHref} style={link}>
          {visitorViewLabel}
        </a>
      ) : null}
      <a href={settingsUrl} style={link}>
        {settingsLabel}
      </a>
    </div>
  );
}

export interface PreviewPillProps {
  /** e.g. the site's word for "Preview · not public yet". */
  text: string;
}

/** Preview-link guest: a small pill at the bottom-start corner. */
export function PreviewPill({ text }: PreviewPillProps) {
  const view = useGateView();
  if (view !== 'preview') return null;
  return (
    <div
      data-site-gate-pill=""
      role="status"
      style={{
        position: 'fixed',
        insetBlockEnd: 16,
        insetInlineStart: 16,
        zIndex: 2147483000,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        paddingBlock: 6,
        paddingInline: 12,
        borderRadius: 999,
        background: CHARCOAL,
        color: '#fff',
        fontFamily: FONT,
        fontSize: 13,
        lineHeight: 1.4,
        boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
      }}
    >
      <span aria-hidden="true" style={dot} />
      <span>{text}</span>
    </div>
  );
}
