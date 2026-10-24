# Testing dan validasi production

## Test lokal

```bash
npm run typecheck
npm run lint
npm test
npm run build

# Worker (setelah frontend dist dibangun):
npm --prefix worker ci --include=dev
npm --prefix worker run typecheck
npm --prefix worker run check
```

Backend integration tests menggunakan file JSON disposable yang menjalankan persistence/rollback, integrity checks, encryption, Argon2id/session flow, HTTP routes, client assignment/expiry, guest-agent ingestion, scoped WebSocket delivery, sync/lifecycle/deployment workers, scoped API keys, Proxmox task verification, branding/docs, mocked SMTP, mocked Google OIDC, backup, dan control verification. Hanya external UpCloud gateway/fetch boundary yang di-fake. Frontend tests menggunakan jsdom dan mocked panel API. `npm run test:scripts` menjalankan Node.js built-in test runner untuk backup/restore JSON dengan file fixture lokal; test tersebut juga termasuk dalam `npm test`.

Test ini tidak membuktikan perilaku filesystem production, Docker restart, PM2 startup, nginx WebSocket upgrade, deployment Cloudflare remote, atau respons live UpCloud. Pisahkan klaim hasil test lokal dari validasi lingkungan tersebut.

## Test coverage

```bash
npm run test:coverage
```

Coverage bukan pengganti review keamanan atau live contract test. Jangan menurunkan dependency untuk mengabaikan audit vulnerability.

## Smoke test entry point production

Setelah build dan konfigurasi test yang aman:

```bash
node server.js
# Dari terminal lain:
curl --fail http://127.0.0.1:3000/health/live
curl --fail http://127.0.0.1:3000/health/ready
curl --fail http://127.0.0.1:3000/
```

Verifikasi database yang digunakan adalah `DATA_FILE` test, lalu hentikan proses. Untuk PM2, uji `pm2 start ecosystem.config.cjs`, restart, stop, dan start setelah reboot pada staging. Pastikan hanya satu proses fork yang menggunakan file tersebut.

## Smoke test Cloudflare Workers lokal

Setelah build dan konfigurasi development pada [cloudflare.md](cloudflare.md):

```bash
npm --prefix worker run dev
# Dari terminal lain:
curl --fail http://127.0.0.1:8787/health/live
curl --fail http://127.0.0.1:8787/health/ready
curl --fail http://127.0.0.1:8787/
```

Uji bootstrap/login dengan credential test, client admin-only denial, email uniqueness/current-account update, scoped-key authorization, branding upload, backup tanpa sessions/OAuth states, failure path SMTP tanpa koneksi eksternal, dan WebSocket `ready`. `wrangler deploy --dry-run` membuktikan bundling/konfigurasi, bukan keberhasilan runtime; smoke test lokal tetap diperlukan karena API runtime dapat berbeda dari Node.js. Dry-run dan simulasi R2 lokal juga bukan bukti deployment Cloudflare remote.

## Live UpCloud — read-only secara default

Gunakan token dengan hak minimum dan server nonproduksi. Export secret hanya pada shell/CI secret store yang aman, bukan `.env` proyek:

```bash
read -rsp "UpCloud test token: " UPCLOUD_TEST_TOKEN; echo
export UPCLOUD_TEST_TOKEN
export UPCLOUD_TEST_ENVIRONMENT='nonproduction'
export UPCLOUD_TEST_SERVER_UUID='UUID VPS nonproduksi yang diotorisasi'
npm --prefix backend run test:live
unset UPCLOUD_TEST_TOKEN UPCLOUD_TEST_SERVER_UUID UPCLOUD_TEST_ENVIRONMENT
```

Test memvalidasi account, list, detail, dan statistics schema tanpa operasi power. UUID opsional untuk read-only account/list test, tetapi diperlukan untuk detail/statistics dan wajib untuk power test.

## Power test — pagar tambahan

> Menyebabkan downtime. Jangan pernah menjalankan pada production atau server yang tidak Anda miliki/otorisasi.

Selain kredensial dan UUID, diperlukan dua variable eksplisit:

```bash
export UPCLOUD_TEST_ENVIRONMENT='nonproduction'
export UPCLOUD_ALLOW_POWER_TEST='I_AUTHORIZE_NONPRODUCTION_POWER_TEST'
npm --prefix backend run test:live
```

Test menolak state awal selain `started/stopped`, menunggu observasi state, dan mencoba mengembalikan state awal pada `finally`. Ini tetap operasi nyata; gunakan hanya VPS disposable/nonproduksi. Jangan menjadikan power test sebagai CI routine tanpa isolasi dan persetujuan.

## Docker/JSON validation checklist

Jalankan pada staging:

```bash
docker compose config
docker compose up --build -d
docker compose ps
curl --fail http://127.0.0.1:3000/health/live
curl --fail http://127.0.0.1:3000/health/ready
npm run test:scripts
docker compose exec app node scripts/backup.mjs
```

Kemudian verifikasi data tetap ada saat restart, scheduler tidak membuat duplicate active jobs, WebSocket melewati reverse proxy dan hanya mengirim event sesuai assignment, serta cookie Secure melalui HTTPS. Restore drill harus dilakukan pada file/volume staging terpisah.

Untuk recovery test pada staging, hentikan proses saat **sync** berjalan dan pastikan job berubah failed saat restart. Jangan sengaja mematikan proses di tengah power operation pada VPS production; desain recovery menandai interrupted job failed dan tidak memutar ulang power request.

## Browser E2E

Playwright tersedia untuk smoke test terhadap deployment yang sudah berjalan. Gunakan `E2E_BASE_URL` dan kredensial test melalui secret environment; jangan hardcode admin atau UpCloud token. E2E read-only harus tetap dipisahkan dari skenario power/deletion.

## Bukti yang perlu dicatat saat rilis

- Versi commit/image, Node.js/PM2, dan hasil typecheck/lint/unit/integration/build.
- `schemaVersion` JSON, readiness, lock single-process, dan reverse-proxy check.
- Backup archive + hash serta tanggal restore drill terakhir.
- Waktu dan cakupan live read-only test tanpa mencatat token.
- Otorisasi eksplisit dan hasil power test bila memang dilakukan pada nonproduksi.
