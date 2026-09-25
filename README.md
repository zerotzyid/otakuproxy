# otakudesu-proxy (Cloudflare Workers)

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/zerotzyid/otakuproxy)

Free no-card proxy: Vercel → Workers → `otakudesu.blog`.

## Setup
```
npm i
wrangler kv:namespace create COOKIE_JAR
wrangler kv:namespace create HTML_CACHE
```
Paste IDs into `wrangler.toml`, then:
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
