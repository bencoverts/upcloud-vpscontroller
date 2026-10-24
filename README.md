# CerdasNet — VPS Control

Panel kontrol VPS UpCloud full-stack berbahasa Indonesia untuk banyak API token, katalog server global tanpa duplikasi, monitoring yang jujur, kontrol power terverifikasi, dan audit operasional. Deployment Node.js menyimpan seluruh data panel dalam **database JSON lokal**—tanpa PostgreSQL atau service database terpisah. Deployment Cloudflare memakai dokumen JSON di R2 dengan Durable Object sebagai writer tunggal.

## Fitur utama

- Dashboard responsif (desktop/mobile), dark/light mode, pencarian, filter, sorting, pagination, WebSocket realtime dengan reconnect, serta loading/empty/error/stale states.
- Satu halaman login untuk admin dan client. Admin mengelola akun, assignment VPS, dan expiry per client; client hanya dapat melihat/mengontrol VPS yang ditugaskan dan belum kedaluwarsa. Expiry mencabut akses panel—**tidak mematikan VPS**.
- API token tanpa batas jumlah grup: validasi sebelum simpan, edit nama, uji koneksi, sync, ganti, nonaktifkan, pilih maksimal **dua VPS untuk tampilan grup**, dan hapus dengan konfirmasi nama.
- Seluruh VPS hasil discovery tetap disinkronkan. Deduplikasi global memakai UUID UpCloud; relasi token/grup tetap dipertahankan.
- Detail VPS: Overview, Performance, Storage, Network, Configuration, dan Activity.
- Statistik CPU/disk/network dari endpoint resmi UpCloud. RAM, swap, filesystem usage, dan OS uptime dapat berasal dari guest agent Linux opsional. Riwayat hanya berisi sampel nyata—tanpa backfill, interpolasi, atau angka simulasi.
- Start, soft/hard stop, restart, modifikasi konfigurasi, rebuild/ganti OS, dan delete dengan konfirmasi yang disengaja, pencegahan klik ganda, active-job uniqueness, serta verifikasi hasil upstream. Rebuild dan delete mewajibkan VPS stopped; panel tidak pernah mengklaim sukses dari respons asynchronous saja.
- Ubah title/hostname melalui operasi resmi UpCloud; respons baru dianggap berhasil setelah upstream menerima perubahan. Rename mempunyai validasi server-side, audit, dan proteksi submit ganda.
- Deploy VPS dari katalog zone/plan/template UpCloud yang diambil dinamis, dengan credential provider hanya di backend dan assignment RBAC untuk client.
- Integrasi Proxmox VE dengan API token terenkripsi, discovery QEMU/LXC, metrik hypervisor yang tersedia, dan power action berbasis UPID task yang diverifikasi.
- Dashboard scoped API keys, dokumentasi OpenAPI di dalam panel, SMTP test delivery, serta Google OIDC untuk email terverifikasi yang cocok dengan akun panel aktif.
- Branding admin untuk nama/tagline, aksen/tema default, logo, dan favicon dengan upload gambar tervalidasi.
- Download backup JSON langsung oleh admin dari halaman Settings, tanpa live session/OAuth state dan tanpa encryption key.
- Sinkronisasi per token yang terisolasi, scheduler, cache, timeout, bounded retry/backoff, penanganan 429, job history, retry manual untuk sync, dan audit logs.
- Argon2id, opaque HttpOnly sessions, CSRF + Origin/Fetch-Site checks, admin authorization, login/API rate limits, AES-256-GCM token encryption, health checks, dan bootstrap admin satu kali.

> **Batas data penting:** RAM/swap usage, filesystem usage, OS uptime, reachability, dan health aplikasi tidak tersedia dari endpoint server stats UpCloud yang digunakan. Tanpa guest agent, UI menandainya sebagai tidak tersedia dan tidak menggantinya dengan kapasitas atau angka perkiraan. Kapasitas RAM/storage adalah konfigurasi, bukan pemakaian. Power state bukan uptime. Lihat [panduan guest agent](docs/guest-agent.md).

## Stack dan penyimpanan

- **Backend Node.js:** Node.js 22, Express 5, TypeScript, Zod, Argon2id portabel, Pino, dan WebSocket.
- **Backend Cloudflare (alternatif lengkap):** Workers + Hono, Durable Object untuk transaksi/scheduler/WebSocket, R2 untuk dokumen JSON, dan Workers Static Assets. Tidak memerlukan Node backend saat dijalankan.
- **Frontend:** React 19, TypeScript, Vite, Tailwind CSS 4, TanStack Query, React Router, Recharts.
- **Database Node.js:** `data/database.json`, dengan penulisan atomik, transaksi dalam proses yang diserialkan, rollback saat error, validasi integritas, permission `0600`, dan lock single-process.
- **Operasional:** entry point `server.js`, PM2 fork mode, Docker Compose opsional, backup/restore JSON Node.js, Vitest, Testing Library, Node test runner, dan Playwright (opt-in E2E).

Tidak ada `DATABASE_URL`, PostgreSQL, `pg_dump`, SQL migration, atau database container yang diperlukan.

## Menjalankan dengan `node server.js`

Prasyarat: Node.js `>=22.12` dan npm.

### 1. Setup interaktif

```bash
npm run setup
```

Wizard memasang dependency root/backend/frontend dengan `npm ci --include=dev`, membangun aplikasi, lalu meminta:

- username/password admin pertama dan email opsional untuk Google OIDC;
- nama serta tagline website;
- origin publik dan port Node.js;
- konfirmasi HTTP hanya untuk development localhost.

Wizard membuat encryption key acak, menyimpan `.env` dengan permission `0600`, dan membuat admin pada database JSON. Password admin tidak ditulis ke `.env`, tidak dicetak, dan tidak memiliki nilai default permanen. Setup menolak menimpa `.env` kecuali `--force` diberikan secara sengaja. Gunakan `npm run setup -- --skip-install` hanya bila dependency locked sudah terpasang.

Untuk automation yang benar-benar non-interaktif, sediakan secret melalui environment process (bukan menyimpannya di source):

```bash
# Isi variable rahasia terlebih dahulu melalui secret manager, lalu:
export SETUP_NONINTERACTIVE=true
export ADMIN_USERNAME ADMIN_PASSWORD ADMIN_EMAIL
export SITE_NAME SITE_TAGLINE APP_ORIGIN PORT
npm run setup
```

Variable tersebut harus sudah diberi nilai oleh secret manager/CI sebelum `export`. `ADMIN_EMAIL` dapat berupa string kosong. Setup tetap menjalankan build dan validasi yang sama. Jangan menaruh `ADMIN_PASSWORD` permanen di `.env`.

Alternatif manual untuk instalasi yang sudah ada tetap tersedia: `npm run setup:install` hanya memasang dependency. Salin `.env.example` ke `.env`, ganti origin/key, build dengan `npm run build`, lalu jalankan `npm run bootstrap:admin` dengan `ADMIN_USERNAME`, `ADMIN_PASSWORD`, dan `ADMIN_EMAIL` opsional pada environment satu kali.

Untuk production di belakang HTTPS gunakan `NODE_ENV=production`, `APP_ORIGIN=https://domain-anda`, dan `COOKIE_SECURE=true`. Untuk HTTP lokal gunakan `NODE_ENV=development`, `APP_ORIGIN=http://localhost:3000`, dan `COOKIE_SECURE=false`. Browser tidak pernah menerima credential UpCloud/Proxmox atau memanggil provider secara langsung.

SMTP dan Google bersifat opsional. Isi konfigurasi pada `.env` sesuai komentar di `.env.example`; Google memerlukan redirect URI `${APP_ORIGIN}/api/auth/google/callback` dan email unik pada akun panel yang sudah ada. Test SMTP/Google nyata memerlukan service dan credential yang diotorisasi.

### 2. Start aplikasi

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

## Deployment penuh ke Cloudflare Workers

Opsi ini menjalankan frontend, API, session/auth, token encryption, sinkronisasi, lifecycle/deployment UpCloud, Proxmox, scoped API keys, branding, Google/SMTP, job, guest-agent ingestion, backup, dan WebSocket di Cloudflare. Ini **bukan proxy ke Node.js**. Satu Durable Object menserialkan transaksi dan satu object R2 menyimpan `database.json`.

Ikuti [docs/cloudflare.md](docs/cloudflare.md) untuk membuat bucket, mengatur encryption key dan bootstrap secret, deploy, bootstrap admin satu kali, serta menghapus bootstrap secret. Node.js tetap diperlukan sebagai build tooling, tetapi tidak diperlukan sebagai server production untuk opsi ini.

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

# Pemeriksaan tambahan untuk deployment Cloudflare:
npm --prefix worker ci --include=dev
npm --prefix worker run typecheck
npm --prefix worker run check
```

Backend integration tests memakai file JSON disposable dan menjalankan encryption, Argon2id/session flow, HTTP routes, RBAC/scoped keys, sync/lifecycle/deployment jobs, Proxmox task verification, branding/docs, SMTP dengan transport mock, serta Google OIDC dengan provider mock. External provider/network boundary hanya di-fake pada test tersebut; hasilnya bukan klaim integrasi live. Test tooling memeriksa backup/restore JSON, checksum, rollback, safety backup, dan lock proses. Live UpCloud test bersifat opt-in dan read-only secara default; lihat [docs/testing.md](docs/testing.md).

## Backup dan restore JSON

Admin dapat memilih **Download backup JSON** di halaman Settings pada Node.js maupun Workers. File adalah attachment JSON yang konsisten dan tidak memuat live session/OAuth state maupun `TOKEN_ENCRYPTION_KEY`.

Untuk operasional Node.js, backup CLI juga dapat dilakukan saat aplikasi berjalan karena setiap perubahan database dipublikasikan melalui atomic rename.

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
  src/metrics/      actual UpCloud/guest samples, agent ingestion, retention
  src/upcloud/      fixed-origin typed API gateway dan normalizers
  src/tests/        integration/unit tests + opt-in live contract
frontend/           React dashboard dan shared UI
worker/             Full Workers API, Durable Object, R2 JSON, static assets
scripts/            bootstrap, JSON backup/restore, Linux guest agent
docs/               Node/Cloudflare deployment, agent, recovery, testing
```

## Model keamanan

- UpCloud token hanya berada di request browser → backend panel saat input/ganti, lalu disimpan sebagai AES-256-GCM ciphertext dengan random IV, token-ID AAD, dan HMAC fingerprint. Nilai penuh tidak pernah dikembalikan setelah penyimpanan.
- Tidak ada token di frontend bundle, localStorage, URL, audit details, atau log. Jangan pernah menaruh token di `.env` proyek.
- UpCloud origin di backend tetap `https://api.upcloud.com/1.3`; tidak ada generic arbitrary-URL proxy.
- Session token disimpan sebagai hash. Cookie bersifat HttpOnly/SameSite; Secure di production. Mutasi memerlukan CSRF serta otorisasi admin atau assignment client yang masih berlaku. WebSocket mengautentikasi session, memeriksa Origin, dan memfilter event per VPS.
- Agent token disimpan sebagai hash dan hanya dapat mengirim sampel untuk UUID VPS terkait; token ini tidak memberi session panel atau akses kontrol UpCloud.
- Power request tidak di-retry otomatis. Setelah restart proses, job yang terputus ditandai failed dan power operation tidak diulang membabi buta.
- Penghapusan token lokal **tidak mencabut token di UpCloud**. Cabut kredensial melalui UpCloud Hub bila sudah tidak dipercaya.
