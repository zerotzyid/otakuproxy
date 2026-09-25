const COOKIE_KEY = "cookies";
const COOKIE_TTL = 1800;
const HTML_TTL = 1800;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Max-Age": "86400",
};

const CACHE_HEADERS = {
  "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
};

function cors(body, status = 200, extra = {}) {
  return new Response(body, {
    status,
    headers: { ...CORS_HEADERS, ...CACHE_HEADERS, ...extra },
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

export default {
  async fetch(request, env, ctx) {
    const reqUrl = new URL(request.url);

    if (request.method === "OPTIONS") {
      return cors(null, 204);
    }

    const upstreamBase = (env.UPSTREAM || "https://otakudesu.blog").replace(/\/$/, "");
    const target = upstreamBase + reqUrl.pathname + reqUrl.search;
    const cacheKey = `html:${target}`;
    const isCacheable = request.method === "GET";

    if (isCacheable && env.HTML_CACHE) {
      try {
        const hit = await env.HTML_CACHE.get(cacheKey);
        if (hit) {
          console.log(`HIT ${reqUrl.pathname}`);
          return cors(hit, 200, {
            "Content-Type": "text/html;charset=UTF-8",
            "X-Cache": "HIT",
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

    const upstreamHeaders = {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Referer: upstreamBase + "/",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
    };
    if (jar) upstreamHeaders.Cookie = jar;

    let res = null;
    let viaFallback = false;

    try {
      console.log(`DIRECT ${target}`);
      res = await fetch(target, {
        method: request.method,
        headers: upstreamHeaders,
        redirect: "follow",
      });
      if (!res.ok) throw new Error(`upstream ${res.status}`);
    } catch (e) {
      console.log(`direct failed ${e?.message}, trying fallback`);
      try {
        const fbUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(target)}`;
        console.log(`FALLBACK ${fbUrl}`);
        res = await fetch(fbUrl, { headers: { Accept: "text/html,*/*" } });
        if (!res.ok) throw new Error(`fallback ${res.status}`);
        viaFallback = true;
      } catch (fbErr) {
        console.log(`fallback failed ${fbErr?.message}`);
        return cors(
          JSON.stringify({ error: "Bad Gateway", detail: "upstream unreachable" }),
          502,
          { "Content-Type": "application/json", "X-Cache": "MISS" }
        );
      }
    }

    const contentType = res.headers.get("content-type") || "text/html;charset=UTF-8";
    const isHtml = contentType.includes("text/html");
    const setCookies = getSetCookies(res.headers);
    const writes = [];

    if (setCookies.length > 0 && env.COOKIE_JAR) {
      const merged = toCookieHeader(setCookies);
      const value = jar ? `${jar}; ${merged}` : merged;
      writes.push(
        env.COOKIE_JAR.put(COOKIE_KEY, value, { expirationTtl: COOKIE_TTL }).catch((e) =>
          console.log(`cookie write failed ${e?.message}`)
        )
      );
      console.log(`cookies saved ${setCookies.length}`);
    }

    if (isCacheable && isHtml && res.status === 200 && env.HTML_CACHE) {
      const body = await res.text();
      writes.push(
        env.HTML_CACHE.put(cacheKey, body, { expirationTtl: HTML_TTL }).catch((e) =>
          console.log(`html write failed ${e?.message}`)
        )
      );
      if (writes.length > 0) ctx.waitUntil(Promise.all(writes));
      console.log(`MISS ${reqUrl.pathname} fallback=${viaFallback}`);
      return cors(body, 200, {
        "Content-Type": contentType,
        "X-Cache": "MISS",
        "X-Proxy-Fallback": viaFallback ? "1" : "0",
      });
    }

    if (writes.length > 0) ctx.waitUntil(Promise.all(writes));
    console.log(`${request.method} ${reqUrl.pathname} ${res.status} fallback=${viaFallback}`);
    return new Response(res.body, {
      status: res.status,
      headers: {
        "Content-Type": contentType,
        ...CORS_HEADERS,
        ...CACHE_HEADERS,
        "X-Cache": "BYPASS",
        "X-Proxy-Fallback": viaFallback ? "1" : "0",
      },
    });
  },
};
