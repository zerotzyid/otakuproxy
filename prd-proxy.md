# PRD – Otakudesu Upstream Proxy (Free, No‑Credit‑Card)

**Status:** Draft  
**Owner:** Backend Team  
**Last Updated:** 2026‑09‑26  

---

## 1. Latar Belakang
Aplikasi streaming anime (frontend Vercel) butuh mengambil HTML & stream dari **otakudesu.blog**.  
IP Vercel diblokir Cloudflare → request upstream gagal (`ECONNREFUSED`).  
Solusi: **Proxy ringan** di edge/cloud free‑tier (tanpa kartu kredit) yang meneruskan request ke `otakudesu.blog`, menangani cookie‑jar & cache HTML, lalu mengembalikan hasil ke Vercel.

---

## 2. Tujuan
| Goal | Detail |
|------|--------|
| **Akses upstream stabil** | Proxy di edge (Cloudflare Workers / Deno Deploy) tidak diblokir Cloudflare. |
| **Cookie‑jar otomatis** | Ambil & simpan `Set-Cookie` dari `otakudesu.blog`, TTL 30 menit. |
| **Cache HTML** | Simpan HTML episode 30 menit di KV → request berikutnya instan. |
| **Fallback proxy** | Jika direct gagal → coba `allorigins.win` (gratis, no‑auth). |
| **Zero cost, no credit‑card** | Hanya free tier (Workers 100k req/hari, Deno Deploy 100k req/hari). |
| **Observability** | Log real‑time (`wrangler tail` / Deno Deploy logs) + opsional Logflare. |
| **Deploy cepat** | `wrangler deploy` / `deno deploy` satu perintah. |

---

## 3. Arsitektur Singkat
```
Vercel (API utama) ──► Proxy (Workers / Deno Deploy) ──► otakudesu.blog
          ▲                                         │
          │                                         ▼
          └───── HTML / cookies / stream ──────────┘
```

- **Vercel** memanggil `GET https://<proxy>.workers.dev/<path>` (atau Deno Deploy URL).  
- Proxy melakukan:
  1. Cek KV cookie‑jar → attach `Cookie` header.  
  2. Cek KV HTML cache → return jika fresh.  
  3. `fetch` ke `https://otakudesu.blog<path>` (direct).  
  4. Jika gagal → `fetch` via `https://api.allorigins.win/raw?url=...`.  
  5. Simpan `Set-Cookie` ke KV (TTL 30 menit).  
  5. Simpan HTML ke KV (TTL 30 menit).  
  6. Return HTML ke caller dengan header CORS & cache.

---

## 3.1 Teknologi Pilihan (Pilih Satu)

| Pilihan | Runtime | KV / Storage | Deploy CLI | Free Limit |
|---------|---------|--------------|------------|------------|
| **Cloudflare Workers** | V8 isolates (JS) | Workers KV (1 GB) | `wrangler deploy` | 100k req/hari, 10 ms CPU |
| **Deno Deploy** | Deno (TS/JS) | Built‑in KV (1 GB) | `deno deploy` | 100k req/hari, 100 ms CPU |

Kedua opsi **tanpa kartu kredit**, **no sleep**, **cold‑start < 200 ms**.

---

## 4. Fitur Detail

| Fitur | Deskripsi | Acceptance Criteria |
|-------|-----------|---------------------|
| **Cookie‑jar** | GET cookie dari KV → attach `Cookie`. Jika respons mengandung `Set-Cookie`, simpan ke KV (`expirationTtl: 1800`). | Request berikutnya membawa cookie; cookie expired otomatis 30 menit. |
| **HTML Cache** | Key `html:<full_url>`. Simpan body HTML (TTL 1800 s). Cache hit → return langsung tanpa fetch upstream. | Cache hit < 50 ms; stale‑while‑revalidate 5 menit. |
| **Direct Fetch** | `fetch(target, {headers, redirect:'follow'})`. Header default: UA, Referer, Accept. | 2xx → return body. |
| **Fallback Proxy** | Jika direct gagal / non‑2xx → `https://api.allorigins.win/raw?url=<enc>`. | Berhasil return HTML; jika tetap gagal throw 502. |
| **CORS & Cache Headers** | Response header: `Access-Control-Allow-Origin: *`, `Cache-Control: public, max-age=60, stale-while-revalidate=300`. | Browser & CDN bisa cache. |
| **Observability** | `console.log` → `wrangler tail` / Deno Deploy logs. Optional: push ke Logflare via `fetch` ke endpoint. | Log terlihat real‑time. |
| **Custom Domain** | `wrangler custom-domain add api.domain.com` (Workers) / Deno Deploy custom domain. | API bisa diakses `https://api.domain.com/...`. |

---

## 5. Non‑Functional Requirements
| NFR | Target |
|-----|--------|
| **Latency (proxy hop)** | ≤ 150 ms (edge → upstream) |
| **Availability** | ≥ 99.9 % (edge distributed) |
| **Scalability** | Auto‑scale Workers / Deno Deploy; max 100k req/hari free. |
| **Security** | HTTPS only; no secrets in code; env vars untuk `UPSTREAM` URL. |
| **Maintainability** | Single file `src/index.js` (Workers) / `main.ts` (Deno). Unit test minimal (mock fetch). |

---

## 6. Implementation Checklist
- [ ] **Repo folder** `proxy/` (atau `workers-proxy/`) dibuat.
- [ ] `package.json` / `deno.json` dengan deps (`axios` optional, native `fetch`).
- [ ] `src/index.js` (Workers) **atau** `main.ts` (Deno) implementasi di atas.
- [ ] `wrangler.toml` / `deno.json` konfigurasi KV namespaces.
- [ ] `wrangler kv:namespace create COOKIE_JAR` & `HTML_CACHE` → isi `wrangler.toml`.
- [ ] `wrangler deploy` **atau** `deno deploy --project=otakudesu-proxy main.ts`.
- [ ] Verifikasi endpoint: `GET https://<proxy>.workers.dev/` → 200 HTML.
- [ ] Set env `OTAKUDESU_BASE_URL=https://<proxy>.workers.dev/` di Vercel (Settings → Env Vars) → redeploy.
- [ ] Smoke test: `GET /api/auto-server/<slug>` → 200 + stream sources.
- [ ] (Opsional) Setup Logflare / Sentry integration.

---

## 6.1 Contoh `wrangler.toml`
```toml
name = "otakudesu-proxy"
main = "src/index.js"
compatibility_date = "2024-06-01"
account_id = "<CF_ACCOUNT_ID>"
workers_dev = true

[vars]
UPSTREAM = "https://otakudesu.blog"

[[kv_namespaces]]
binding = "COOKIE_JAR"
id = "<KV_ID_COOKIE>"

[[kv_namespaces]]
binding = "HTML_CACHE"
id = "<KV_ID_HTML>"
```

---

## 7. Risiko & Mitigasi
| Risiko | Dampak | Mitigasi |
|--------|--------|----------|
| **CPU 10 ms limit (Workers free)** | Parsing HTML besar bisa exceed. | Gunakan Deno Deploy (100 ms) atau upgrade Workers $5/bln (50 ms). |
| **KV write rate limit (1k writes/min)** | Cookie + cache write burst. | Batch write (simpan cookie & html dalam satu `put`), gunakan `expirationTtl`. |
| **Proxy allorigins rate limit** | Banyak fallback bersamaan. | Cache HTML agresif (TTL 30 menit) → fallback jarang dipakai. |
| **Custom domain SSL delay** | DNS propagation. | Deploy dulu di `*.workers.dev`, test, baru tambah custom domain. |

---

## 8. Timeline (Estimasi)
| Sprint | Aktivitas | Durasi |
|--------|-----------|--------|
| 0 | Setup repo, pilih platform (Workers vs Deno) | 0.5 hari |
| 1 | Implementasi Worker (`src/index.js`) + KV setup | 1 hari |
| 2 | Deploy, custom domain, test upstream | 0.5 hari |
| 3 | Integrasi Vercel (`OTAKUDESU_BASE_URL`) + smoke test | 0.5 hari |
| 4 | Observability (Logflare) + dokumen runbook | 0.5 hari |
| **Total** |  | **≈ 3 hari kerja** |

---

## 8.1 Definition of Done
- Proxy deploy di `*.workers.dev` / `*.deno.dev` → 200 OK untuk `/` & `/episode/...`.
- `GET /api/auto-server/<slug>` dari Vercel mengembalikan `odcloud` / `archive` / `sources` (tidak kosong) tanpa warning.
- `/player/<slug>` memutar video (MP4 & HLS via hls.js).
- Log real‑time terlihat di `wrangler tail` / Deno Deploy dashboard.
- Dokumentasi runbook (redeploy, rotate KV, scaling) di repo.

---

## 8.2 Lampiran
- **Worker code** (`src/index.js`) – lampirkan di repo.
- **Deno Deploy code** (`main.ts`) – alternative.
- **Environment variables** list untuk Vercel & Worker.

---

*Prepared by Backend Team – ready for engineering kickoff.*