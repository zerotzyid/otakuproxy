const COOKIE_KEY = "cookies";
const COOKIE_TTL = 1800;
const HTML_TTL = 300;
const JSON_TTL = 300;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
  "Access-Control-Allow-Headers": "*, Range, If-Range, Content-Type, X-Requested-With",
  "Access-Control-Expose-Headers":
    "Content-Range, Accept-Ranges, Content-Length, Content-Type, ETag, Set-Cookie",
  "Access-Control-Max-Age": "86400",
};

const HTML_CACHE_CONTROL = "public, max-age=60, stale-while-revalidate=240";
const JSON_CACHE_CONTROL = "public, max-age=60, stale-while-revalidate=240";
const PLAYLIST_CACHE = "public, max-age=10, stale-while-revalidate=50";
const SEGMENT_CACHE = "public, max-age=300, stale-while-revalidate=300";
const NO_STORE = "no-store";

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const MEDIA_EXT = /\.(m3u8|mpd|mp4|m4s|ts|m2ts|webm|mkv|avi|mov)(\?|#|$)/i;

function withCors(headers = {}) {
  return { ...CORS_HEADERS, ...headers };
}

function errJson(status, detail) {
  return new Response(JSON.stringify({ error: status === 502 ? "Bad Gateway" : "Error", detail }), {
    status,
    headers: withCors({ "Content-Type": "application/json", "Cache-Control": NO_STORE }),
  });
}

function getSetCookies(headers) {
  if (typeof headers.getSetCookie === "function") {
    try {
      return headers.getSetCookie() || [];
    } catch {
      return [];
    }
  }
  const single = headers.get("set-cookie");
  return single ? [single] : [];
}

function toCookieHeader(setCookies) {
  return setCookies
    .map((c) => c.split(";")[0].trim())
    .filter(Boolean)
    .join("; ");
}

function resolveTarget(reqUrl, upstreamBase) {
  const raw = reqUrl.searchParams.get("url");
  if (raw) {
    try {
      const u = new URL(raw);
      if (u.protocol === "http:" || u.protocol === "https:") return u.toString();
    } catch {
      return null;
    }
    return null;
  }
  return upstreamBase + reqUrl.pathname + reqUrl.search;
}

function rewriteHost(value, proxyHost, upstreamHost) {
  if (!value) return value;
  try {
    if (value.startsWith("http")) {
      const u = new URL(value);
      if (u.host === proxyHost) {
        u.host = upstreamHost;
        return u.toString();
      }
      return value;
    }
    return value;
  } catch {
    return value;
  }
}

function isPlaylist(target) {
  return /\.(m3u8|mpd)(\?|#|$)/i.test(target);
}

export default {
  async fetch(request, env, ctx) {
    const reqUrl = new URL(request.url);
    const proxyHost = reqUrl.host;

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: withCors() });
    }
    if (!["GET", "HEAD", "POST"].includes(request.method)) {
      return new Response(JSON.stringify({ error: "Method Not Allowed" }), {
        status: 405,
        headers: withCors({ "Content-Type": "application/json", "Cache-Control": NO_STORE }),
      });
    }

    const upstreamBase = (env.UPSTREAM || "https://otakudesu.blog").replace(/\/$/, "");
    const upstreamHost = new URL(upstreamBase).host;
    const target0 = resolveTarget(reqUrl, upstreamBase);
    if (!target0) return errJson(400, "invalid url param");

    const isAjax = reqUrl.pathname.endsWith("/wp-admin/admin-ajax.php");
    const modeJson = reqUrl.searchParams.get("mode") === "json";
    const hasRange = request.headers.has("range") || request.headers.has("if-range");
    const hasUrlParam = reqUrl.searchParams.has("url");
    const streamMode = hasRange || hasUrlParam || MEDIA_EXT.test(target0);
    const cacheable = request.method === "GET" && !streamMode && !hasRange;

    if (cacheable && env.HTML_CACHE) {
      try {
        const hit = await env.HTML_CACHE.get(`html:${target0}`);
        if (hit != null) {
          const ct = modeJson ? "application/json" : "text/html;charset=UTF-8";
          console.log(`HIT ${request.method} ${reqUrl.pathname}${reqUrl.search} len=${hit.length}`);
          return new Response(hit, {
            status: 200,
            headers: withCors({
              "Content-Type": ct,
              "Cache-Control": modeJson ? JSON_CACHE_CONTROL : HTML_CACHE_CONTROL,
              "X-Cache": "HIT",
            }),
          });
        }
      } catch (e) {
        console.log(`cache read failed ${e?.message}`);
      }
    }

    let jar = "";
    if (env.COOKIE_JAR) {
      try {
        jar = (await env.COOKIE_JAR.get(COOKIE_KEY)) || "";
      } catch (e) {
        console.log(`cookie read failed ${e?.message}`);
      }
    }
    const clientCookie = request.headers.get("cookie") || "";
    const cookieHeader = [jar, clientCookie].filter(Boolean).join("; ");

    const clientRef = request.headers.get("referer") || "";
    const clientOrigin = request.headers.get("origin") || "";
    const referer = isAjax
      ? rewriteHost(clientRef, proxyHost, upstreamHost) || target0
      : rewriteHost(clientRef, proxyHost, upstreamHost) || upstreamBase + "/";
    const origin = isAjax
      ? rewriteHost(clientOrigin, proxyHost, upstreamHost) || upstreamBase
      : clientOrigin
        ? rewriteHost(clientOrigin, proxyHost, upstreamHost)
        : undefined;

    const baseHeaders = {
      "User-Agent": request.headers.get("user-agent") || BROWSER_UA,
      "Accept-Language": request.headers.get("accept-language") || "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
      Accept:
        request.headers.get("accept") ||
        (isAjax || modeJson ? "*/*" : "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"),
      Referer: referer,
    };
    if (origin) baseHeaders.Origin = origin;
    if (cookieHeader) baseHeaders.Cookie = cookieHeader;
    const xrw = request.headers.get("x-requested-with");
    if (xrw) baseHeaders["X-Requested-With"] = xrw;
    for (const h of ["range", "if-range", "if-none-match", "if-modified-since", "if-unmodified-since"]) {
      const v = request.headers.get(h);
      if (v) baseHeaders[h] = v;
    }

    let postBody = undefined;
    let postCT = undefined;
    if (request.method === "POST") {
      postCT = request.headers.get("content-type") || "application/x-www-form-urlencoded";
      baseHeaders["Content-Type"] = postCT;
      try {
        postBody = await request.arrayBuffer();
      } catch (e) {
        console.log(`body read failed ${e?.message}`);
        return errJson(400, "cannot read POST body");
      }
    }

    async function directFetch(url, extraHeaders = {}) {
      return fetch(url, {
        method: request.method,
        headers: { ...baseHeaders, ...extraHeaders },
        body: request.method === "POST" ? postBody : undefined,
        redirect: "manual",
        signal: AbortSignal.timeout(20000),
      });
    }

    let res = null;
    let target = target0;
    try {
      for (let i = 0; i < 5; i++) {
        console.log(`${isAjax ? "AJAX" : streamMode ? "STREAM" : "DIRECT"} ${request.method} ${target} range=${request.headers.get("range") || "-"}`);
        res = await directFetch(target);
        const sc = getSetCookies(res.headers);
        if (sc.length > 0 && env.COOKIE_JAR) {
          const merged = toCookieHeader(sc);
          jar = jar ? `${jar}; ${merged}` : merged;
          ctx.waitUntil(
            env.COOKIE_JAR.put(COOKIE_KEY, jar, { expirationTtl: COOKIE_TTL }).catch((e) =>
              console.log(`cookie write failed ${e?.message}`)
            )
          );
        }
        if ([301, 302, 303, 307, 308].includes(res.status)) {
          const loc = res.headers.get("location");
          if (!loc) break;
          try {
            await res.arrayBuffer().catch(() => {});
          } catch {}
          target = new URL(loc, target).toString();
          if (res.status === 303 && request.method === "POST") break;
          console.log(`redirect ${res.status} -> ${target}`);
          continue;
        }
        break;
      }
      if (!res) throw new Error("no response");
    } catch (e) {
      console.log(`FAIL ${request.method} ${reqUrl.pathname}${reqUrl.search} upstream=ERR len=0 err=${e?.name}:${e?.message}`);
      return errJson(502, "upstream unreachable");
    }

    if (res.status === 304 || res.status === 416) {
      console.log(`OK ${request.method} ${reqUrl.pathname}${reqUrl.search} upstream=${res.status} len=0`);
      const h = new Headers();
      for (const k of ["content-range", "accept-ranges", "etag", "last-modified", "date"]) {
        const v = res.headers.get(k);
        if (v) h.set(k, v);
      }
      for (const [k, v] of Object.entries(withCors({ "Cache-Control": NO_STORE }))) h.set(k, v);
      h.set("X-Upstream-Status", String(res.status));
      return new Response(null, { status: res.status, headers: h });
    }

    if ([520, 521, 522, 523, 524].includes(res.status)) {
      console.log(`FAIL GET ${reqUrl.pathname}${reqUrl.search} upstream=${res.status} len=0`);
    }

    const outCT = res.headers.get("content-type") || (streamMode ? "application/octet-stream" : "text/html;charset=UTF-8");
    const setCookies = getSetCookies(res.headers);

    if (isAjax || request.method === "POST") {
      const buf = await res.arrayBuffer();
      const len = buf.byteLength;
      console.log(`${res.ok ? "OK" : "FAIL"} POST ${reqUrl.pathname} upstream=${res.status} len=${len}`);
      const h = withCors({ "Content-Type": outCT, "Cache-Control": NO_STORE, "X-Upstream-Status": String(res.status), "X-Proxy-Mode": "ajax" });
      const out = new Response(buf, { status: res.status, headers: h });
      for (const c of setCookies) out.headers.append("Set-Cookie", c);
      return out;
    }

    if (streamMode) {
      const len = res.headers.get("content-length") || "?";
      console.log(`${res.ok || res.status === 206 ? "OK" : "FAIL"} ${request.method} ${reqUrl.pathname}${reqUrl.search} upstream=${res.status} len=${len} stream=1`);
      const h = new Headers();
      for (const k of ["content-type", "content-range", "accept-ranges", "content-length", "etag", "last-modified", "expires", "date"]) {
        const v = res.headers.get(k);
        if (v) h.set(k, v);
      }
      if (!h.has("content-type")) h.set("content-type", outCT);
      for (const [k, v] of Object.entries(withCors())) h.set(k, v);
      h.set("Cache-Control", isPlaylist(target0) ? PLAYLIST_CACHE : SEGMENT_CACHE);
      h.set("X-Cache", "BYPASS");
      h.set("X-Proxy-Mode", "stream");
      h.set("X-Upstream-Status", String(res.status));
      for (const c of setCookies) h.append("Set-Cookie", c);
      return new Response(res.body, { status: res.status, headers: h });
    }

    const buf = await res.arrayBuffer();
    const len = buf.byteLength;
    console.log(`${res.ok ? "OK" : "FAIL"} ${request.method} ${reqUrl.pathname}${reqUrl.search} upstream=${res.status} len=${len}`);
    if (cacheable && res.status === 200 && env.HTML_CACHE) {
      ctx.waitUntil(
        env.HTML_CACHE.put(`html:${target0}`, buf.slice(0), {
          expirationTtl: modeJson ? JSON_TTL : HTML_TTL,
        }).catch((e) => console.log(`html write failed ${e?.message}`))
      );
    }
    const h = withCors({
      "Content-Type": outCT,
      "Cache-Control": modeJson ? JSON_CACHE_CONTROL : HTML_CACHE_CONTROL,
      "X-Cache": "MISS",
      "X-Upstream-Status": String(res.status),
    });
    const out = new Response(buf, { status: res.status, headers: h });
    for (const c of setCookies) out.headers.append("Set-Cookie", c);
    return out;
  },
};
