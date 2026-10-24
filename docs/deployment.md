# Deployment production

Dokumen ini adalah panduan; tidak ada perintah dalam repositori yang mengubah nginx, CloudPanel, firewall, atau service host secara otomatis. Tinjau setiap perubahan dengan administrator host.

## 1. Persiapan Ubuntu

Gunakan Ubuntu 24.04 LTS atau versi yang didukung, Node.js 22 untuk development, Docker Engine + Compose v2 untuk deployment, DNS `A/AAAA` ke host, dan TLS pada reverse proxy.

Prinsip jaringan:

- Internet → reverse proxy HTTPS (`443`) → `127.0.0.1:3000` → container app.
- App → PostgreSQL melalui Docker bridge privat.
- App → `https://api.upcloud.com` melalui HTTPS outbound.
- Jangan expose PostgreSQL ke internet. Jangan expose port app pada `0.0.0.0` kecuali arsitektur firewall Anda memang memerlukannya.

## 2. Konfigurasi rahasia

```bash
cp .env.example .env
chmod 600 .env
openssl rand -hex 32
openssl rand -base64 36
```

Isi:

| Variable | Keterangan |
|---|---|
| `APP_ORIGIN` | Origin publik lengkap, misalnya `https://vps-panel.example.com`; tanpa path |
| `POSTGRES_DB`, `POSTGRES_USER` | Database dan role khusus panel |
| `POSTGRES_PASSWORD` | Secret acak panjang |
| `TOKEN_ENCRYPTION_KEY` | 64 hex characters / 32 byte; simpan juga di secret manager |
| `BIND_ADDRESS` | Default `127.0.0.1`; jangan ubah tanpa alasan |
| `TRUST_PROXY` | Jumlah trusted proxy hop; biasanya `1` untuk reverse proxy lokal |
| `METRICS_REFRESH_SECONDS` | Default/saran `300`; daily summary tidak menjamin berubah lebih sering |

Jangan commit `.env`. Jangan memasukkan UpCloud token atau permanent `ADMIN_PASSWORD` ke file ini. Rotasi `TOKEN_ENCRYPTION_KEY` memerlukan migrasi ciphertext yang disengaja; menggantinya begitu saja membuat token lama tidak dapat didekripsi.

## 3. Start dan bootstrap

```bash
docker compose up --build -d
docker compose ps
docker compose logs --tail=100 app
curl --fail http://127.0.0.1:3000/health/ready
```

Bootstrap admin satu kali menggunakan input interaktif seperti di README. Hapus variable shell setelahnya. Bootstrap gagal jika user sudah ada; tidak ada default admin/password.

Health endpoints:

- `GET /health/live`: proses HTTP merespons.
- `GET /health/ready`: query PostgreSQL berhasil.

Migrasi berjalan sebelum HTTP listen dan memakai PostgreSQL advisory transaction lock. Job `queued/running/verifying` yang terputus karena restart proses ditandai `failed`; power job tidak diulang otomatis.

## 4. Reverse proxy / CloudPanel

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

## 5. Update

```bash
COMPOSE=1 ./scripts/backup.sh
docker compose build app
docker compose up -d app
docker compose ps
curl --fail http://127.0.0.1:3000/health/ready
```

Migrasi kompatibel diterapkan saat startup. Untuk perubahan destruktif, review migrasi dan lakukan restore drill pada staging terlebih dahulu. Jangan menguji power/restart recovery pada VPS production.

## 6. Operasional

- `docker compose logs -f app` — log aman tanpa UpCloud token; jangan aktifkan request-body logging.
- `docker compose restart app` — hanya setelah memahami job aktif; power tidak di-replay.
- `docker compose stop app` — sebelum restore.
- Pantau volume PostgreSQL, retensi `server_metrics`, hasil backup, rate limit 429, dan token `degraded/offline`.
- Atur sinkronisasi/statistik tidak terlalu agresif. `serverPollSeconds` hanya membaca cache panel; `metricsRefreshSeconds` menyentuh UpCloud.

## 7. Checklist go-live

- [ ] `.env` permission ketat; encryption key tersimpan di secret manager terpisah.
- [ ] `APP_ORIGIN` HTTPS dan cookie Secure berfungsi.
- [ ] Admin unik sudah dibootstrap; tidak ada password default.
- [ ] Database dan port app tidak dapat diakses publik.
- [ ] Login, CSRF, logout, ganti password, dan session revocation diuji.
- [ ] Token nonproduksi divalidasi; server list sesuai izin token.
- [ ] Dark/light, mobile navigation, filter, pagination, dan semua dialog diuji.
- [ ] SSE live melalui reverse proxy dan reconnect setelah restart diuji.
- [ ] Backup berhasil diverifikasi; restore drill staging berhasil.
- [ ] Live UpCloud/read-only dan power test hanya pada VPS nonproduksi yang diotorisasi.
