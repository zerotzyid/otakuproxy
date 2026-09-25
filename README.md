# otakudesu-proxy (Cloudflare Workers)

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/zerotzyid/otakuproxy)

Free no-card proxy: Vercel → Workers → `otakudesu.blog`.

## Deploy (2 langkah)

1. Klik tombol **Deploy to Cloudflare Workers** di atas → Authorize → Deploy.
   Deploy pertama jalan tanpa KV (cache/cookie nonaktif tapi proxy tetap jalan).
2. (Opsional, aktifkan cache) jalankan lokal:
```
npm i
wrangler kv:namespace create COOKIE_JAR
wrangler kv:namespace create HTML_CACHE
```
Uncomment `[[kv_namespaces]]` di `wrangler.toml`, isi ID asli, lalu:
```
npm run deploy
npm run tail
```

## Env (Vercel)
`OTAKUDESU_BASE_URL=https://<proxy>.workers.dev/`

## Behavior
- `Cookie` from KV `COOKIE_JAR`, saved from `Set-Cookie` (TTL 1800s)
- `GET` HTML cached in KV `HTML_CACHE` key `html:<url>` (TTL 1800s)
- Direct fetch → fallback `api.allorigins.win/raw?url=...` → 502 if both fail
- CORS `*` + `Cache-Control: public, max-age=60, stale-while-revalidate=300`
```
