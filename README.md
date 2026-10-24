# CerdasNet — VPS Control

Panel kontrol VPS UpCloud full-stack berbahasa Indonesia untuk banyak API token, katalog server global tanpa duplikasi, monitoring yang jujur, kontrol power terverifikasi, dan audit operasional.

## Fitur utama

- Dashboard responsif (desktop/mobile), dark/light mode, pencarian, filter, sorting, pagination, polling, SSE invalidation, serta loading/empty/error/stale states.
- API token tanpa batas jumlah grup: validasi sebelum simpan, edit nama, uji koneksi, sync, ganti, nonaktifkan, pilih maksimal **dua VPS untuk tampilan grup**, dan hapus dengan konfirmasi nama.
- Seluruh VPS hasil discovery tetap disinkronkan. Deduplikasi global memakai UUID UpCloud; relasi token/grup tetap dipertahankan.
- Detail VPS: Overview, Performance, Storage, Network, Configuration, dan Activity.
- Statistik CPU/disk/network dari endpoint resmi UpCloud. Riwayat hanya berisi sampel nyata yang diterima panel—tanpa backfill, interpolasi, atau angka simulasi.
- Start, soft stop, dan restart dengan dialog konsekuensi, pencegahan klik ganda, active-job uniqueness, dan verifikasi state dari UpCloud.
- Sinkronisasi per token yang terisolasi, scheduler, cache, timeout, bounded retry/backoff, penanganan 429, job history, retry manual untuk sync, dan audit logs.
- Argon2id, opaque HttpOnly sessions, CSRF + Origin/Fetch-Site checks, admin authorization, login/API rate limits, AES-256-GCM token encryption, migrations, health checks, dan bootstrap admin satu kali.

> **Batas data penting:** RAM/swap usage, filesystem usage, OS uptime, reachability, dan health aplikasi tidak tersedia dari endpoint server stats yang digunakan. UI menandainya **“Tidak tersedia melalui API · agent OS diperlukan”**. Kapasitas RAM/storage adalah konfigurasi, bukan pemakaian. Power state bukan uptime.

## Stack

- **Backend:** Node.js 22, Express 5, TypeScript, PostgreSQL, Zod, Argon2id, Pino.
- **Frontend:** React 19, TypeScript, Vite, Tailwind CSS 4, TanStack Query, React Router, Recharts.
- **Operasional:** Node.js 22 untuk tooling, Docker Compose, PostgreSQL 17, migration runner, backup/restore Node.js dengan `pg_dump` custom-format, Vitest, Testing Library, Node test runner, dan Playwright (opt-in E2E).

## Quick start — Docker Compose

Prasyarat: Docker Engine dengan Compose v2, domain HTTPS yang diarahkan ke reverse proxy, dan reverse proxy pada host yang sama.

```bash
cp .env.example .env
chmod 600 .env
# Edit .env. Buat secret dengan:
openssl rand -hex 32       # TOKEN_ENCRYPTION_KEY
openssl rand -base64 36    # POSTGRES_PASSWORD

docker compose up --build -d
docker compose ps
```

Buat admin pertama tanpa menaruh password di shell history atau meninggalkan kredensial default:

```bash
read -rp "Admin username: " ADMIN_USERNAME
read -rsp "Admin password (min. 12 karakter): " ADMIN_PASSWORD; echo
export ADMIN_USERNAME ADMIN_PASSWORD
docker compose run --rm -e ADMIN_USERNAME -e ADMIN_PASSWORD app npm run bootstrap:admin
unset ADMIN_USERNAME ADMIN_PASSWORD
```

Bootstrap ditolak jika user sudah ada. Login melalui `APP_ORIGIN`, lalu tambahkan token UpCloud dari **API Token Manager**. Browser tidak pernah mengakses UpCloud secara langsung.

Backend menunggu database healthy, menjalankan migrasi sebelum membuka port, dan menyajikan frontend dari origin yang sama. Secara default hanya `127.0.0.1:3000` yang dipetakan ke host; PostgreSQL tidak dipublikasikan.

## Development lokal

Prasyarat: Node.js `>=22.12`, PostgreSQL, dan npm.

```bash
npm ci
npm --prefix backend ci
npm --prefix frontend ci

export DATABASE_URL='postgresql://USER:PASSWORD@127.0.0.1:5432/cerdasnet'
export TOKEN_ENCRYPTION_KEY="$(openssl rand -hex 32)"
export APP_ORIGIN='http://localhost:5173'
export NODE_ENV='development'

npm --prefix backend run build
read -rp "Admin username: " ADMIN_USERNAME
read -rsp "Admin password: " ADMIN_PASSWORD; echo
export ADMIN_USERNAME ADMIN_PASSWORD
npm run bootstrap:admin
unset ADMIN_USERNAME ADMIN_PASSWORD

npm run dev
```

File `.env` otomatis dibaca oleh **Docker Compose**, bukan oleh proses Node development. Untuk development, export variabel melalui mekanisme secret/environment yang aman. Vite berjalan di `:5173`, backend di `:3000`, dan Vite mem-proxy relative `/api` serta `/health`; kode browser tidak memakai `localhost` untuk memanggil backend.

## Verifikasi

```bash
npm run typecheck
npm run lint
npm test
npm run build

# Test tooling Node.js (juga termasuk dalam npm test)
npm run test:scripts
```

Test backend memakai migrasi dan PGlite disposable, session/HTTP/job logic nyata, dan hanya mengganti external UpCloud gateway dengan fake. Test frontend memeriksa client API, konfirmasi power anti-duplikasi, batas seleksi grup, dan empty monitoring states. PGlite bukan pengganti validasi pada PostgreSQL/Docker production.

Live UpCloud test bersifat opt-in dan read-only secara default. Power test membutuhkan otorisasi nonproduksi tambahan. Lihat [docs/testing.md](docs/testing.md).

## Backup dan restore

```bash
# Dengan Compose; katalog dump diverifikasi sebelum file dipindahkan.
COMPOSE=1 node scripts/backup.mjs

# Restore: hentikan app dahulu. Script membuat safety dump sebelum restore.
docker compose stop app
COMPOSE=1 APP_STOPPED=YES RESTORE_CONFIRM=YES \
  node scripts/restore.mjs backups/cerdasnet-YYYYMMDDTHHMMSSZ.dump
docker compose start app
```

Simpan `TOKEN_ENCRYPTION_KEY` yang sama secara terpisah di secret manager. Database backup tidak berisi kunci tersebut dan tidak mem-backup isi disk VPS. Detail di [docs/backup-restore.md](docs/backup-restore.md).

## Dokumentasi

- [Deployment Ubuntu, reverse proxy, dan CloudPanel](docs/deployment.md)
- [Backup, restore, dan recovery](docs/backup-restore.md)
- [Kontrak UpCloud dan interpretasi metrik](docs/upcloud.md)
- [Testing dan validasi production](docs/testing.md)

## Struktur

```text
backend/
  migrations/       SQL migrations dan constraints
  src/auth/         Argon2id, sessions, CSRF, password lifecycle
  src/tokens/       encrypted token lifecycle dan group selection
  src/servers/      katalog UUID global, storage, network, dashboard
  src/sync/         scheduler, jobs, retry, verified power controls
  src/metrics/      actual UpCloud samples, retention, downsampling
  src/upcloud/      fixed-origin typed API gateway dan normalizers
  src/tests/        integration/unit tests + opt-in live contract
frontend/
  src/components/   layout, controls, forms, charts, shared UI
  src/pages/        dashboard, VPS, tokens, monitoring, activity, settings
  src/context/      auth, theme, jobs, toasts, SSE invalidation
scripts/            verified backup dan guarded transactional restore
docs/               deployment, recovery, API contract, testing
```

## Model keamanan

- UpCloud token hanya berada di request browser → backend panel saat input/ganti, lalu disimpan sebagai AES-256-GCM ciphertext dengan random IV, token-ID AAD, dan HMAC fingerprint. Nilai penuh tidak pernah dikembalikan setelah penyimpanan.
- Tidak ada token di frontend bundle, localStorage, URL, audit details, atau log. Jangan pernah menaruh token di `.env` proyek.
- UpCloud origin di backend tetap `https://api.upcloud.com/1.3`; tidak ada generic arbitrary-URL proxy.
- Session token disimpan sebagai hash di PostgreSQL. Cookie bersifat HttpOnly/SameSite; Secure di production. Mutasi memerlukan CSRF dan admin role.
- Power request tidak di-retry otomatis. Setelah restart proses, job yang terputus ditandai failed dan power operation tidak diulang membabi buta.
- Penghapusan token lokal **tidak mencabut token di UpCloud**. Cabut kredensial melalui UpCloud Hub bila sudah tidak dipercaya.
