# Deployment Node.js, PM2, dan production

Dokumen ini adalah panduan; tidak ada perintah dalam repositori yang mengubah nginx, CloudPanel, firewall, PM2 startup, atau service host lain secara otomatis. Tinjau setiap perubahan dengan administrator host.

## 1. Persiapan Ubuntu

Gunakan Ubuntu 24.04 LTS atau versi yang didukung, Node.js `>=22.12`, npm, DNS `A/AAAA` ke host, dan TLS pada reverse proxy. PM2 bersifat opsional tetapi direkomendasikan untuk restart otomatis. PostgreSQL dan PostgreSQL client tools **tidak diperlukan**.

Prinsip jaringan:

- Internet → reverse proxy HTTPS (`443`) → `127.0.0.1:3000` → proses Node.js.
- App → `https://api.upcloud.com` melalui HTTPS outbound.
- App → `data/database.json` pada local filesystem.
- Jangan expose port app pada `0.0.0.0` melalui firewall kecuali arsitektur Anda memang memerlukannya; proses listen pada semua interface, jadi batasi akses melalui reverse proxy/firewall.

## 2. Konfigurasi rahasia

```bash
cp .env.example .env
chmod 600 .env
openssl rand -hex 32
```

| Variable | Keterangan |
|---|---|
| `APP_ORIGIN` | Origin publik lengkap, misalnya `https://vps-panel.example.com`; tanpa path |
| `DATA_FILE` | Default `./data/database.json`; diselesaikan dari direktori proyek oleh `server.js` |
| `TOKEN_ENCRYPTION_KEY` | 64 hex characters / 32 byte; simpan juga di secret manager |
| `COOKIE_SECURE` | `true` untuk HTTPS production; `false` hanya untuk uji HTTP lokal |
| `TRUST_PROXY` | Jumlah trusted proxy hop; biasanya `1` untuk reverse proxy lokal |
| `METRICS_REFRESH_SECONDS` | Default/saran `300`; daily summary tidak menjamin berubah lebih sering |

`server.js`, bootstrap admin, dan backup/restore membaca `.env` tanpa menimpa environment yang sudah diset. Jangan commit `.env`. Jangan memasukkan UpCloud token atau permanent `ADMIN_PASSWORD` ke file ini. Rotasi `TOKEN_ENCRYPTION_KEY` memerlukan migrasi ciphertext yang disengaja; menggantinya begitu saja membuat token lama tidak dapat didekripsi.

## 3. Install, build, dan bootstrap

`npm run setup` memasang dependency root, backend, dan frontend dengan `npm ci --include=dev`. Dev dependency seperti TypeScript dan `@types/node` wajib tersedia saat build; jangan memakai `--omit=dev` sebelum build meskipun `NODE_ENV=production`.

```bash
npm run setup
npm run build

read -rp "Admin username: " ADMIN_USERNAME
read -rsp "Admin password: " ADMIN_PASSWORD; echo
export ADMIN_USERNAME ADMIN_PASSWORD
npm run bootstrap:admin
unset ADMIN_USERNAME ADMIN_PASSWORD
```

Bootstrap gagal jika user sudah ada; tidak ada default admin/password. Database beserta direktori induknya dibuat otomatis dengan permission ketat.

## 4. Start dengan Node.js atau PM2

Menjalankan aplikasi secara langsung:

```bash
node server.js
curl --fail http://127.0.0.1:3000/health/live
curl --fail http://127.0.0.1:3000/health/ready
```

Menjalankan dengan PM2:

```bash
pm2 start ecosystem.config.cjs
pm2 status
pm2 logs cerdasnet-vps-control
```

`ecosystem.config.cjs` menetapkan `instances: 1` dan `exec_mode: 'fork'`. **Jangan gunakan cluster mode atau beberapa proses pada file JSON yang sama.** Aplikasi juga membuat `DATA_FILE.lock` dan menolak proses kedua. Jika proses mati paksa, stale lock dengan PID yang sudah tidak berjalan dapat dipulihkan pada start berikutnya; jangan menghapus lock ketika PID masih hidup.

Health endpoints:

- `GET /health/live`: proses HTTP merespons.
- `GET /health/ready`: file database dapat diakses; respons menyertakan `storage: "json"`.

Database dibuka dan divalidasi sebelum HTTP listen. Setiap transaksi memakai draft terisolasi, diserialkan dalam proses, lalu ditulis ke temporary file + `fsync` + atomic rename. Job `queued/running/verifying` yang terputus karena restart proses ditandai `failed`; power job tidak diulang otomatis.

## 5. Reverse proxy / CloudPanel

Di CloudPanel, gunakan site/reverse proxy yang menargetkan `http://127.0.0.1:3000`, aktifkan TLS, dan pertahankan konfigurasi host lain. Pastikan `APP_ORIGIN` sama persis dengan origin HTTPS publik.

Untuk nginx, contoh berikut adalah **snippet untuk ditinjau**, bukan file yang otomatis dipasang:

```nginx
upstream cerdasnet_panel {
    server 127.0.0.1:3000;
    keepalive 32;
}

# Di dalam server HTTPS yang sudah dikelola CloudPanel/nginx:
client_max_body_size 64k;

location = /api/events {
    proxy_pass http://cerdasnet_panel;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header Connection "";
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 1h;
    proxy_send_timeout 1h;
}

location / {
    proxy_pass http://cerdasnet_panel;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header Connection "";
    proxy_read_timeout 130s;
}
```

Jalankan validasi konfigurasi yang disediakan control panel/nginx sebelum reload. SSE memakai heartbeat dan header `X-Accel-Buffering: no`, tetapi reverse proxy tetap harus mematikan buffering pada `/api/events`. Tidak ada WebSocket atau arbitrary upstream URL.

`TRUST_PROXY=1` sesuai satu reverse proxy lokal. Jika ada CDN tambahan, hitung trusted hops dengan benar; jangan memakai trust proxy berlebihan karena memengaruhi IP rate limit/audit.

Origin guard menerima `APP_ORIGIN` atau origin yang sama dengan `Host` dan protocol request. Karena itu reverse proxy harus meneruskan `Host` dan `X-Forwarded-Proto` dengan benar. Origin lintas situs tetap ditolak; perubahan ini tidak menggantikan CSRF token untuk mutasi yang sudah login.

## 6. Update aplikasi

```bash
node scripts/backup.mjs
npm run setup
npm run build
pm2 restart cerdasnet-vps-control
curl --fail http://127.0.0.1:3000/health/ready
```

Tinjau perubahan struktur `schemaVersion` sebelum update. Lakukan restore drill pada staging; jangan menguji power/restart recovery pada VPS production.

## 7. Docker Compose opsional

Compose menjalankan satu container app dengan named volume `panel-data` (`/app/data`) dan `panel-backups` (`/app/backups`). Tidak ada service database.

```bash
docker compose up --build -d
docker compose ps
docker compose logs --tail=100 app
```

Bootstrap menggunakan environment interaktif yang sama:

```bash
docker compose run --rm --no-deps \
  -e ADMIN_USERNAME -e ADMIN_PASSWORD \
  app node scripts/bootstrap-admin.mjs
```

Backup: `docker compose exec app node scripts/backup.mjs`. Salin archive dan sidecar ke luar container/volume untuk offsite retention. Restore dilakukan melalui `docker compose run --rm --no-deps` saat app berhenti; lihat [backup-restore.md](backup-restore.md).

## 8. Operasional

- `pm2 logs cerdasnet-vps-control` — jangan aktifkan request-body logging.
- `pm2 restart cerdasnet-vps-control` — pahami job aktif; power tidak di-replay.
- `pm2 stop cerdasnet-vps-control` — wajib sebelum restore.
- Pantau pertumbuhan `database.json`, retensi `server_metrics`, ruang disk, hasil backup, rate limit 429, dan token `degraded/offline`.
- JSON store ditujukan untuk satu instance panel pada local filesystem. Jangan taruh database pada NFS/SMB atau shared volume yang ditulis beberapa instance.
- Atur sinkronisasi/statistik tidak terlalu agresif. `serverPollSeconds` hanya membaca cache panel; `metricsRefreshSeconds` menyentuh UpCloud.

## 9. Checklist go-live

- [ ] `.env` permission ketat; encryption key tersimpan di secret manager terpisah.
- [ ] `APP_ORIGIN` HTTPS dan cookie Secure berfungsi.
- [ ] Admin unik sudah dibootstrap; tidak ada password default.
- [ ] Hanya satu proses PM2 memakai `DATA_FILE`; direktori data tidak dapat diakses publik.
- [ ] Login, CSRF, logout, ganti password, dan session revocation diuji.
- [ ] Token nonproduksi divalidasi; server list sesuai izin token.
- [ ] Dark/light, mobile navigation, filter, pagination, dan semua dialog diuji.
- [ ] SSE live melalui reverse proxy dan reconnect setelah restart diuji.
- [ ] Backup berhasil diverifikasi; restore drill staging berhasil.
- [ ] Live UpCloud/read-only dan power test hanya pada VPS nonproduksi yang diotorisasi.
