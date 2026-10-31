'use client';
"use strict";
"use client";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/site-gate/client.tsx
var client_exports = {};
__export(client_exports, {
  PreviewPill: () => PreviewPill,
  SiteGateBar: () => SiteGateBar
});
module.exports = __toCommonJS(client_exports);
var import_react = require("react");

// src/site-gate/shared.ts
var VIEW_COOKIE = "tus_site_view";
var VIEW_PARAM = "tus_view";

// src/site-gate/client.tsx
var import_jsx_runtime = require("react/jsx-runtime");
var FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
var CHARCOAL = "#1A1A1A";
var GOLD = "#C8981E";
function readViewCookie() {
  if (typeof document === "undefined") return null;
  for (const part of document.cookie.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === VIEW_COOKIE) {
      try {
        return decodeURIComponent(part.slice(i + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}
function inIframe() {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}
function useGateView() {
  const [view, setView] = (0, import_react.useState)(null);
  (0, import_react.useEffect)(() => {
    const p = window.location.pathname;
    if (p === "/preview" || p.startsWith("/preview/") || inIframe()) {
      setView(null);
      return;
    }
    setView(readViewCookie());
  }, []);
  return view;
}
function visitorViewHref() {
  const url = new URL(window.location.href);
  url.searchParams.set(VIEW_PARAM, "visitor");
  return "/" + url.pathname.replace(/^\/+/, "") + url.search;
}
var dot = {
  width: 8,
  height: 8,
  borderRadius: "50%",
  background: GOLD,
  flex: "none"
};
function SiteGateBar({ text, visitorViewLabel, settingsLabel, settingsUrl }) {
  const view = useGateView();
  const [visitorHref, setVisitorHref] = (0, import_react.useState)(null);
  (0, import_react.useEffect)(() => {
    if (view === "team") setVisitorHref(visitorViewHref());
  }, [view]);
  if (view !== "team") return null;
  const link = { color: "#fff", textDecoration: "underline", textUnderlineOffset: 2 };
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
    "div",
    {
      "data-site-gate-bar": "",
      role: "region",
      style: {
        position: "sticky",
        insetBlockStart: 0,
        zIndex: 2147483e3,
        display: "flex",
        alignItems: "center",
        flexWrap: "wrap",
        gap: 12,
        paddingBlock: 6,
        paddingInline: 16,
        background: CHARCOAL,
        color: "#fff",
        fontFamily: FONT,
        fontSize: 13,
        lineHeight: 1.4
      },
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { "aria-hidden": "true", style: dot }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { flex: "1 1 auto" }, children: text }),
        visitorHref ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("a", { href: visitorHref, style: link, children: visitorViewLabel }) : null,
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("a", { href: settingsUrl, style: link, children: settingsLabel })
      ]
    }
  );
}
function PreviewPill({ text }) {
  const view = useGateView();
  if (view !== "preview") return null;
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
    "div",
    {
      "data-site-gate-pill": "",
      role: "status",
      style: {
        position: "fixed",
        insetBlockEnd: 16,
        insetInlineStart: 16,
        zIndex: 2147483e3,
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        paddingBlock: 6,
        paddingInline: 12,
        borderRadius: 999,
        background: CHARCOAL,
        color: "#fff",
        fontFamily: FONT,
        fontSize: 13,
        lineHeight: 1.4,
        boxShadow: "0 2px 8px rgba(0,0,0,0.25)"
      },
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { "aria-hidden": "true", style: dot }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: text })
      ]
    }
  );
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  PreviewPill,
  SiteGateBar
});
