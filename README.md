# CerdasNet — VPS Control

Panel kontrol VPS UpCloud full-stack berbahasa Indonesia untuk banyak API token, katalog server global tanpa duplikasi, monitoring yang jujur, kontrol power terverifikasi, dan audit operasional. Seluruh data panel disimpan dalam **database JSON lokal**—tanpa PostgreSQL atau service database terpisah.

## Fitur utama

- Dashboard responsif (desktop/mobile), dark/light mode, pencarian, filter, sorting, pagination, polling, SSE invalidation, serta loading/empty/error/stale states.
- API token tanpa batas jumlah grup: validasi sebelum simpan, edit nama, uji koneksi, sync, ganti, nonaktifkan, pilih maksimal **dua VPS untuk tampilan grup**, dan hapus dengan konfirmasi nama.
- Seluruh VPS hasil discovery tetap disinkronkan. Deduplikasi global memakai UUID UpCloud; relasi token/grup tetap dipertahankan.
- Detail VPS: Overview, Performance, Storage, Network, Configuration, dan Activity.
- Statistik CPU/disk/network dari endpoint resmi UpCloud. Riwayat hanya berisi sampel nyata yang diterima panel—tanpa backfill, interpolasi, atau angka simulasi.
- Start, soft stop, dan restart dengan dialog konsekuensi, pencegahan klik ganda, active-job uniqueness, dan verifikasi state dari UpCloud.
- Sinkronisasi per token yang terisolasi, scheduler, cache, timeout, bounded retry/backoff, penanganan 429, job history, retry manual untuk sync, dan audit logs.
- Argon2id, opaque HttpOnly sessions, CSRF + Origin/Fetch-Site checks, admin authorization, login/API rate limits, AES-256-GCM token encryption, health checks, dan bootstrap admin satu kali.

> **Batas data penting:** RAM/swap usage, filesystem usage, OS uptime, reachability, dan health aplikasi tidak tersedia dari endpoint server stats yang digunakan. UI menandainya **“Tidak tersedia melalui API · agent OS diperlukan”**. Kapasitas RAM/storage adalah konfigurasi, bukan pemakaian. Power state bukan uptime.

## Stack dan penyimpanan

- **Backend:** Node.js 22, Express 5, TypeScript, Zod, Argon2id, Pino.
- **Frontend:** React 19, TypeScript, Vite, Tailwind CSS 4, TanStack Query, React Router, Recharts.
- **Database:** `data/database.json`, dengan penulisan atomik, transaksi dalam proses yang diserialkan, rollback saat error, validasi integritas, permission `0600`, dan lock single-process.
- **Operasional:** entry point `server.js`, PM2 fork mode, Docker Compose opsional, backup/restore JSON Node.js, Vitest, Testing Library, Node test runner, dan Playwright (opt-in E2E).

Tidak ada `DATABASE_URL`, PostgreSQL, `pg_dump`, SQL migration, atau database container yang diperlukan.

## Menjalankan dengan `node server.js`

Prasyarat: Node.js `>=22.12` dan npm.

### 1. Install, konfigurasi, dan build

```bash
npm run setup

cp .env.example .env
chmod 600 .env
openssl rand -hex 32
```

`npm run setup` memasang dependency root, backend, dan frontend dengan `npm ci --include=dev`. Opsi tersebut penting karena TypeScript, `@types/node`, dan build tools lainnya adalah dev dependency; jangan memakai `--omit=dev` sebelum build, termasuk saat `NODE_ENV=production`.

Edit `.env`:

- Masukkan hasil random key sebagai `TOKEN_ENCRYPTION_KEY`.
- Untuk production di belakang HTTPS, gunakan `NODE_ENV=production`, `APP_ORIGIN=https://domain-anda`, dan `COOKIE_SECURE=true`.
- Untuk uji lokal melalui HTTP, gunakan `NODE_ENV=development`, `APP_ORIGIN=http://localhost:3000`, dan `COOKIE_SECURE=false`.
- Default database adalah `./data/database.json`; ubah `DATA_FILE` bila perlu.

```bash
npm run build
```

### 2. Bootstrap admin satu kali

```bash
read -rp "Admin username: " ADMIN_USERNAME
read -rsp "Admin password (min. 12 karakter): " ADMIN_PASSWORD; echo
export ADMIN_USERNAME ADMIN_PASSWORD
npm run bootstrap:admin
unset ADMIN_USERNAME ADMIN_PASSWORD
```

Bootstrap ditolak jika user sudah ada. Tidak ada kredensial default permanen.

### 3. Start aplikasi

```bash
node server.js
```

`server.js` memuat `.env`, membuka database JSON, menjalankan backend dan scheduler, serta menyajikan frontend hasil build pada `0.0.0.0:3000`. Build ulang dengan `npm run build` setelah mengubah source. Browser tidak pernah mengakses UpCloud secara langsung.

## Menjalankan dengan PM2

Gunakan **satu proses fork** untuk setiap file JSON. Jangan memakai `pm2 -i max`, cluster mode, atau beberapa PM2/systemd process pada `DATA_FILE` yang sama.

```bash
# Opsi paling singkat:
pm2 start server.js --name cerdasnet-vps-control

# Atau gunakan konfigurasi yang disediakan (instances: 1, exec_mode: fork):
pm2 start ecosystem.config.cjs

pm2 status
pm2 logs cerdasnet-vps-control
pm2 restart cerdasnet-vps-control
```

Untuk start otomatis setelah reboot, gunakan `pm2 save` dan perintah `pm2 startup` yang sesuai dengan user/OS Anda. Tinjau perintah startup sebelum menjalankannya sebagai administrator.

## Development lokal

```bash
npm run dev
```

Vite berjalan di `:5173`, backend di `:3000`, dan Vite mem-proxy relative `/api` serta `/health`. Untuk development melalui dua proses tersebut, export environment yang diperlukan pada shell; entry point produksi `server.js` adalah yang memuat `.env` secara otomatis.

## Verifikasi

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

Backend integration tests memakai file JSON disposable dan menjalankan encryption, Argon2id/session flow, HTTP routes, sync workers, serta control verification. Hanya external UpCloud gateway/fetch boundary yang di-fake. Test tooling memeriksa backup/restore JSON, checksum, rollback, safety backup, dan lock proses. Live UpCloud test bersifat opt-in dan read-only secara default; lihat [docs/testing.md](docs/testing.md).

## Backup dan restore JSON

Backup dapat dilakukan saat aplikasi berjalan karena setiap perubahan database dipublikasikan melalui atomic rename.

```bash
node scripts/backup.mjs
# Output: backups/cerdasnet-YYYYMMDDTHHMMSSZ.json dan .sha256
```

Restore bersifat destruktif dan memerlukan aplikasi berhenti:

```bash
pm2 stop cerdasnet-vps-control
APP_STOPPED=YES RESTORE_CONFIRM=YES \
  node scripts/restore.mjs backups/cerdasnet-YYYYMMDDTHHMMSSZ.json
pm2 restart cerdasnet-vps-control
```

Restore memvalidasi JSON/checksum, membuat safety backup dari database saat ini, lalu mengganti file secara atomik. Simpan `TOKEN_ENCRYPTION_KEY` yang sama secara terpisah di secret manager. Backup tidak berisi key tersebut dan tidak mem-backup isi disk VPS. Detail di [docs/backup-restore.md](docs/backup-restore.md).

## Docker Compose opsional

Compose hanya memiliki **satu service app** dan volume untuk file JSON serta backup; tidak ada PostgreSQL.

```bash
cp .env.example .env
chmod 600 .env
# Edit APP_ORIGIN dan TOKEN_ENCRYPTION_KEY terlebih dahulu.
docker compose up --build -d
docker compose ps
```

Bootstrap admin di container dengan environment interaktif:

```bash
docker compose run --rm --no-deps \
  -e ADMIN_USERNAME -e ADMIN_PASSWORD \
  app node scripts/bootstrap-admin.mjs
```

Backup dari container: `docker compose exec app node scripts/backup.mjs`. Lihat panduan deployment/recovery untuk restore dan penyalinan archive keluar volume.

## Struktur

```text
server.js           Entry point tunggal untuk Node.js/PM2
ecosystem.config.cjs PM2 single-process fork configuration
data/               Database JSON lokal (diabaikan Git)
backend/
  src/db/           JSON store, transaksi, tipe data, dan integrity checks
  src/auth/         Argon2id, sessions, CSRF, password lifecycle
  src/tokens/       encrypted token lifecycle dan group selection
  src/servers/      katalog UUID global, storage, network, dashboard
  src/sync/         scheduler, jobs, retry, verified power controls
  src/metrics/      actual UpCloud samples, retention, downsampling
  src/upcloud/      fixed-origin typed API gateway dan normalizers
  src/tests/        integration/unit tests + opt-in live contract
frontend/           React dashboard dan shared UI
scripts/            bootstrap, JSON backup, dan guarded restore
docs/               deployment, recovery, API contract, testing
```

## Model keamanan

- UpCloud token hanya berada di request browser → backend panel saat input/ganti, lalu disimpan sebagai AES-256-GCM ciphertext dengan random IV, token-ID AAD, dan HMAC fingerprint. Nilai penuh tidak pernah dikembalikan setelah penyimpanan.
- Tidak ada token di frontend bundle, localStorage, URL, audit details, atau log. Jangan pernah menaruh token di `.env` proyek.
- UpCloud origin di backend tetap `https://api.upcloud.com/1.3`; tidak ada generic arbitrary-URL proxy.
- Session token disimpan sebagai hash di file JSON. Cookie bersifat HttpOnly/SameSite; Secure di production. Mutasi memerlukan CSRF dan admin role.
- Power request tidak di-retry otomatis. Setelah restart proses, job yang terputus ditandai failed dan power operation tidak diulang membabi buta.
- Penghapusan token lokal **tidak mencabut token di UpCloud**. Cabut kredensial melalui UpCloud Hub bila sudah tidak dipercaya.
