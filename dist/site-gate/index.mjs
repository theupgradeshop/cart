// src/site-gate/index.ts
import { NextResponse } from "next/server.js";

// src/site-gate/shared.ts
var PASS_COOKIE = "__Host-tus_site_pass";
var PREVIEW_COOKIE = "__Host-tus_site_preview";
var VIEW_COOKIE = "tus_site_view";
var PREVIEW_PARAM = "tus_preview";
var VIEW_PARAM = "tus_view";

// src/site-gate/index.ts
var SKIP_PREFIXES = ["/api", "/_next", "/preview", "/brand-icon", "/d", "/l"];
var COMING_SOON_PATH = "/site-coming-soon";
var FILE_EXT_RE = /\.[A-Za-z0-9]+$/;
var SKIP_EXACT = ["/robots.txt", "/sitemap.xml"];
function underSegment(pathname, prefix) {
  return pathname === prefix || pathname.startsWith(prefix + "/");
}
function isSiteGateSkipped(pathname) {
  if (SKIP_EXACT.includes(pathname)) return true;
  const last = pathname.slice(pathname.lastIndexOf("/") + 1);
  if (FILE_EXT_RE.test(last)) return true;
  return SKIP_PREFIXES.some((p) => underSegment(pathname, p));
}
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\\/-]/g, "\\$&");
}
function thankYouSkip(path, enabledLanguages) {
  const paths = (Array.isArray(path) ? path : [path]).map((p) => "/" + p.trim().replace(/^\/+|\/+$/g, "")).filter((p) => p !== "/");
  if (paths.length === 0) return () => false;
  const langs = enabledLanguages.filter((l) => typeof l === "string" && l.length > 0).map(escapeRegExp);
  const langPart = langs.length ? `(?:/(?:${langs.join("|")}))?` : "";
  const re = new RegExp(`^${langPart}(?:${paths.map(escapeRegExp).join("|")})(?:/.*)?$`);
  return (pathname) => re.test(pathname);
}
var MAX_TOKEN_LEN = 1024;
var PASS_RE = /^[A-Za-z0-9_-]{1,900}\.[A-Za-z0-9_-]{1,300}$/;
var PREVIEW_RE = /^[A-Za-z0-9_-]{16,128}$/;
function validPass(v) {
  return v && v.length <= MAX_TOKEN_LEN && PASS_RE.test(v) ? v : void 0;
}
function validPreview(v) {
  return v && v.length <= MAX_TOKEN_LEN && PREVIEW_RE.test(v) ? v : void 0;
}
async function sha256Hex(s) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}
var TTL_MS = 5e3;
var BACKOFF_MS = 5e3;
var IDLE_AWAIT_MS = 6e4;
var TIMEOUT_MS = 1e3;
var LRU_CAP = 64;
var FAILURE_LOG_INTERVAL_MS = 5 * 6e4;
var BUCKET_CAPACITY = 5;
var BUCKET_REFILL_PER_SEC = 5;
var MAX_NAME_LEN = 200;
var VIEWS = ["visitor", "team", "preview"];
var VARIANTS = ["centered", "split", "banner"];
function wellFormed(s) {
  const w = s.toWellFormed;
  if (typeof w === "function") return w.call(s);
  return s.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "\uFFFD");
}
function cleanName(s) {
  try {
    return wellFormed(Array.from(s).slice(0, MAX_NAME_LEN).join(""));
  } catch {
    return "";
  }
}
function encodeName(s) {
  try {
    return encodeURIComponent(wellFormed(s));
  } catch {
    return "";
  }
}
function parseAnswer(data) {
  if (!data || typeof data !== "object") return null;
  const d = data;
  if (typeof d.on !== "boolean") return null;
  if (!d.on) return { on: false, view: "visitor", variant: "centered", businessName: "" };
  if (typeof d.view !== "string" || !VIEWS.includes(d.view)) return null;
  if (typeof d.variant !== "string" || !VARIANTS.includes(d.variant)) return null;
  if (typeof d.businessName !== "string") return null;
  return {
    on: true,
    view: d.view,
    variant: d.variant,
    businessName: cleanName(d.businessName)
  };
}
async function fetchAnswer(domain, platformUrl, tokens, fetchImpl) {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(null);
    }, TIMEOUT_MS);
  });
  const work = (async () => {
    const headers = new Headers({ accept: "application/json" });
    if (tokens.pass) headers.set("x-tus-site-pass", tokens.pass);
    if (tokens.preview) headers.set("x-tus-site-preview", tokens.preview);
    const url = `${platformUrl.replace(/\/+$/, "")}/api/public/site-gate?domain=${encodeURIComponent(domain)}`;
    const res = await fetchImpl(url, { method: "GET", headers, signal: controller.signal, cache: "no-store", redirect: "manual" });
    if (!res.ok) return null;
    return parseAnswer(await res.json());
  })().catch(() => null);
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
function newEntry() {
  return { answer: null, at: 0, okAt: 0, lastOk: true, inflight: null, lastFailureLogAt: 0 };
}
var tokenless = /* @__PURE__ */ new Map();
var tokened = /* @__PURE__ */ new Map();
var bucketTokens = BUCKET_CAPACITY;
var bucketAt = 0;
function takeBucket(now) {
  if (bucketAt === 0) bucketAt = now;
  bucketTokens = Math.min(BUCKET_CAPACITY, bucketTokens + (now - bucketAt) / 1e3 * BUCKET_REFILL_PER_SEC);
  bucketAt = now;
  if (bucketTokens < 1) return false;
  bucketTokens -= 1;
  return true;
}
function __resetSiteGateForTests() {
  tokenless.clear();
  tokened.clear();
  bucketTokens = BUCKET_CAPACITY;
  bucketAt = 0;
}
function __siteGateCacheSizes() {
  return { tokened: tokened.size, tokenless: tokenless.size };
}
function refresh(entry, domain, platformUrl, tokens, fetchImpl, logFailures, dropOnFailure = false) {
  if (!entry.inflight) {
    entry.inflight = (async () => {
      const answer = await fetchAnswer(domain, platformUrl, tokens, fetchImpl);
      const now = Date.now();
      if (answer) {
        entry.answer = answer;
        entry.okAt = now;
        if (!entry.lastOk && logFailures) console.info(`[site-gate] dashboard reachable again for ${domain}`);
        entry.lastOk = true;
      } else {
        if (logFailures && (entry.lastOk || now - entry.lastFailureLogAt >= FAILURE_LOG_INTERVAL_MS)) {
          entry.lastFailureLogAt = now;
          console.error(
            `[site-gate] dashboard unreachable for ${domain} - ` + (entry.answer ? "serving the last-known answer" : "no answer known yet, the site is served OPEN")
          );
        }
        entry.lastOk = false;
        if (dropOnFailure) entry.answer = null;
      }
      entry.at = now;
      return answer;
    })().finally(() => {
      entry.inflight = null;
    });
  }
  return entry.inflight;
}
async function getTokenless(domain, platformUrl, fetchImpl) {
  let e = tokenless.get(domain);
  if (!e) {
    e = newEntry();
    tokenless.set(domain, e);
  }
  const now = Date.now();
  const stale = now - e.at >= (e.lastOk ? TTL_MS : BACKOFF_MS);
  if (e.answer) {
    if (now - e.okAt >= IDLE_AWAIT_MS) {
      if (!e.lastOk && !stale) return e.answer;
      await refresh(e, domain, platformUrl, {}, fetchImpl, true);
      return e.answer;
    }
    if (stale) void refresh(e, domain, platformUrl, {}, fetchImpl, true);
    return e.answer;
  }
  if (!e.lastOk && !stale) return null;
  await refresh(e, domain, platformUrl, {}, fetchImpl, true);
  return e.answer;
}
async function getTokened(key, domain, platformUrl, tokens, fetchImpl) {
  const now = Date.now();
  let e = tokened.get(key);
  if (e) {
    tokened.delete(key);
    tokened.set(key, e);
    if (e.answer && now - e.okAt < TTL_MS) return e.answer;
    if (e.inflight) return e.inflight;
    if (!e.lastOk && now - e.at < BACKOFF_MS) return null;
  }
  if (!takeBucket(now)) return null;
  if (!e) {
    e = newEntry();
    tokened.set(key, e);
    while (tokened.size > LRU_CAP) {
      const oldest = tokened.keys().next().value;
      if (oldest === void 0) break;
      tokened.delete(oldest);
    }
  }
  return refresh(e, domain, platformUrl, tokens, fetchImpl, false, true);
}
var SECURE_HOST_COOKIE = { httpOnly: true, secure: true, sameSite: "lax", path: "/" };
function cleanGateRequestHeaders(headers) {
  const h = new Headers(headers);
  const drop = [];
  h.forEach((_v, k) => {
    if (k.startsWith("x-tus-site-") || k.startsWith("x-tus-uc-")) drop.push(k);
  });
  for (const k of drop) h.delete(k);
  return h;
}
function cleanRequestHeaders(req) {
  return cleanGateRequestHeaders(req.headers);
}
function visitorResponse(req, info, deleteCookies, extraHeaders) {
  const headers = cleanRequestHeaders(req);
  if (extraHeaders) {
    try {
      for (const [k, v] of Object.entries(extraHeaders(req) ?? {})) {
        const name = k.toLowerCase();
        if (name === "x-tus-uc-variant" || name === "x-tus-uc-business-name") continue;
        headers.set(k, String(v));
      }
    } catch {
    }
  }
  headers.set("x-tus-uc-variant", info.variant);
  headers.set("x-tus-uc-business-name", encodeName(info.businessName));
  const res = NextResponse.rewrite(new URL("/site-coming-soon", req.url), {
    status: 503,
    headers: { "Retry-After": "3600", "Cache-Control": "no-store" },
    request: { headers }
  });
  for (const name of deleteCookies) res.cookies.set(name, "", { ...SECURE_HOST_COOKIE, maxAge: 0 });
  if (req.cookies.get(VIEW_COOKIE)) res.cookies.set(VIEW_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
var VIEW_COOKIE_MAX_AGE = 30;
function requestOrigin(req, domain) {
  const first = (v) => v ? v.split(",")[0].trim() : "";
  const claimed = (first(req.headers.get("x-forwarded-host")) || first(req.headers.get("host"))).replace(/:\d{1,5}$/, "").toLowerCase();
  const host = claimed !== "" && claimed === domain.toLowerCase() ? claimed : domain;
  const fProto = first(req.headers.get("x-forwarded-proto")).toLowerCase();
  const proto = fProto === "http" || fProto === "https" ? fProto : req.nextUrl.protocol === "https:" ? "https" : "http";
  return { proto, host };
}
function offResponse(req, pathname) {
  if (pathname === COMING_SOON_PATH || pathname.startsWith(COMING_SOON_PATH + "/")) return null;
  if (!req.cookies.get(VIEW_COOKIE)) return null;
  const res = NextResponse.next();
  res.cookies.set(VIEW_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
function insideResponse(req, view, domain) {
  const res = NextResponse.next({ request: { headers: cleanRequestHeaders(req) } });
  res.headers.set("Cache-Control", "private, no-store");
  res.cookies.set(VIEW_COOKIE, view, {
    httpOnly: false,
    secure: requestOrigin(req, domain).proto === "https",
    sameSite: "lax",
    path: "/",
    maxAge: VIEW_COOKIE_MAX_AGE
  });
  return res;
}
async function siteGate(req, opts) {
  let result = null;
  try {
    result = await gateInner(req, opts);
  } catch {
    result = null;
  }
  if (result === null && isComingSoonRequest(req)) {
    return new NextResponse("Not found", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8", "Cache-Control": "no-store" }
    });
  }
  return result;
}
function isComingSoonRequest(req) {
  try {
    const p = req.nextUrl.pathname;
    return p === COMING_SOON_PATH || p.startsWith(COMING_SOON_PATH + "/");
  } catch {
    return false;
  }
}
async function gateInner(req, opts) {
  try {
    const { domain, platformUrl } = opts;
    const hook = opts.rewriteRequestHeaders;
    if (!domain || !platformUrl) return null;
    const pathname = req.nextUrl.pathname;
    if (isSiteGateSkipped(pathname)) return null;
    if (opts.extraSkip && opts.extraSkip(pathname)) return null;
    const fetchImpl = opts.fetchImpl ?? ((...a) => fetch(...a));
    const forceVisitor = req.nextUrl.searchParams.get(VIEW_PARAM) === "visitor";
    const previewParamRaw = forceVisitor ? null : req.nextUrl.searchParams.get(PREVIEW_PARAM);
    if (previewParamRaw !== null) {
      const candidate = validPreview(previewParamRaw);
      if (candidate) {
        const tokens2 = { preview: candidate };
        const answer2 = await getTokened(await sha256Hex(`${domain}

${candidate}`), domain, platformUrl, tokens2, fetchImpl);
        if (answer2 && !answer2.on) return offResponse(req, pathname);
        if (answer2 && answer2.view !== "visitor") {
          const target = req.nextUrl.clone();
          target.searchParams.delete(PREVIEW_PARAM);
          const o = requestOrigin(req, domain);
          const res = NextResponse.redirect(`${o.proto}://${o.host}${target.pathname}${target.search}`, 302);
          res.headers.set("Cache-Control", "no-store");
          res.headers.set("Referrer-Policy", "no-referrer");
          res.cookies.set(PREVIEW_COOKIE, candidate, SECURE_HOST_COOKIE);
          return res;
        }
        if (answer2) return visitorResponse(req, answer2, [], hook);
        return unreachable(req, domain, hook);
      }
    }
    const tokens = {};
    if (!forceVisitor) {
      tokens.pass = validPass(req.cookies.get(PASS_COOKIE)?.value);
      tokens.preview = validPreview(req.cookies.get(PREVIEW_COOKIE)?.value);
    }
    const hasTokens = Boolean(tokens.pass || tokens.preview);
    if (!hasTokens) {
      const answer2 = await getTokenless(domain, platformUrl, fetchImpl);
      if (!answer2) return null;
      if (!answer2.on) return offResponse(req, pathname);
      return visitorResponse(req, answer2, [], hook);
    }
    const key = await sha256Hex(`${domain}
${tokens.pass ?? ""}
${tokens.preview ?? ""}`);
    const answer = await getTokened(key, domain, platformUrl, tokens, fetchImpl);
    if (!answer) return unreachable(req, domain, hook);
    if (!answer.on) return offResponse(req, pathname);
    if (answer.view === "visitor") {
      const del = [];
      if (tokens.pass) del.push(PASS_COOKIE);
      if (tokens.preview) del.push(PREVIEW_COOKIE);
      return visitorResponse(req, answer, del, hook);
    }
    return insideResponse(req, answer.view, domain);
  } catch {
    return null;
  }
}
function unreachable(req, domain, hook) {
  const last = tokenless.get(domain)?.answer ?? null;
  if (last && !last.on) return null;
  return visitorResponse(req, last ?? { variant: "centered", businessName: "" }, [], hook);
}
export {
  __resetSiteGateForTests,
  __siteGateCacheSizes,
  cleanGateRequestHeaders,
  isSiteGateSkipped,
  siteGate,
  thankYouSkip
};
