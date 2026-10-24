# Backup, restore, dan recovery JSON

## Cakupan

Backup melindungi **database JSON panel**: user/session hashes, encrypted API tokens, katalog VPS, grup, konfigurasi cache, sampel metrik, settings, sync jobs, dan audit logs. Backup tidak mencakup:

- Isi disk atau snapshot VPS UpCloud.
- `TOKEN_ENCRYPTION_KEY` dari `.env` atau secret manager.
- Container image, frontend build, PM2 configuration, atau host reverse-proxy configuration.

Simpan encryption key pada secret manager dengan backup terpisah. Tanpa key yang sama, token ciphertext yang berhasil direstore tidak dapat didekripsi; token harus diganti satu per satu.

## Format dan pengaman

`backup.mjs` membaca satu snapshot JSON yang konsisten, memvalidasi strukturnya, memakai permission `0600`, temporary file, publikasi atomik tanpa menimpa backup lama, dan SHA-256 sidecar. Karena database ditulis melalui atomic rename, backup dapat berjalan ketika panel aktif.

`restore.mjs` mewajibkan `APP_STOPPED=YES` dan `RESTORE_CONFIRM=YES`, memeriksa PID pada database lock, memvalidasi JSON dan checksum sidecar bila tersedia, membuat pre-restore safety backup, mengganti file melalui atomic rename, lalu membaca dan memvalidasi hasilnya. Restore tidak boleh dijalankan bersamaan dengan panel atau restore lain.

## Backup pada Node.js/PM2

Jalankan dari direktori proyek:

```bash
node scripts/backup.mjs
# Contoh output: backups/cerdasnet-20261024T080000Z.json
sha256sum -c backups/cerdasnet-20261024T080000Z.json.sha256
```

Script membaca `DATA_FILE` dari environment/`.env`; default-nya `data/database.json`. `BACKUP_DIR` opsional menentukan direktori output. Script tidak memerlukan PostgreSQL client dan tidak mencetak isi database. Simpan file pada storage terenkripsi di luar host dan terapkan retensi sesuai kebijakan organisasi.

## Restore pada Node.js/PM2

1. Pilih maintenance window dan pastikan archive berasal dari instans/key yang benar.
2. Verifikasi hash dan lakukan restore drill pada staging.
3. Hentikan app agar tidak ada write selama restore.
4. Jalankan guarded restore.
5. Start app, periksa readiness, login, token health, dan integritas server.

```bash
pm2 stop cerdasnet-vps-control
APP_STOPPED=YES RESTORE_CONFIRM=YES \
  node scripts/restore.mjs backups/cerdasnet-20261024T080000Z.json

pm2 restart cerdasnet-vps-control
curl --fail http://127.0.0.1:3000/health/ready
pm2 logs --lines 100 cerdasnet-vps-control
```

Jika menjalankan `node server.js` secara langsung, hentikan process dengan SIGINT/SIGTERM dan jalankan kembali setelah restore. Safety backup dibuat tepat sebelum penggantian, tetapi bukan alasan untuk melewati staging drill.

## Backup dan restore dengan Compose

Backup saat container berjalan:

```bash
docker compose exec app node scripts/backup.mjs
# Archive berada di /app/backups pada volume panel-backups.
mkdir -p backups
docker compose cp app:/app/backups/. ./backups/
```

Untuk restore, salin archive dan sidecar pilihan ke direktori `backups` host, lalu:

```bash
docker compose stop app
# Jika archive belum berada pada container:
docker compose cp ./backups/cerdasnet-20261024T080000Z.json app:/app/backups/cerdasnet-20261024T080000Z.json
docker compose cp ./backups/cerdasnet-20261024T080000Z.json.sha256 app:/app/backups/cerdasnet-20261024T080000Z.json.sha256

docker compose run --rm --no-deps \
  -e APP_STOPPED=YES -e RESTORE_CONFIRM=YES \
  app node scripts/restore.mjs /app/backups/cerdasnet-20261024T080000Z.json

docker compose start app
curl --fail http://127.0.0.1:3000/health/ready
```

`docker compose run` memakai named volume yang sama. Jangan menjalankan app utama sampai restore selesai.

## Restore ke instans baru

1. Deploy versi aplikasi yang kompatibel dengan `schemaVersion` archive.
2. Gunakan `TOKEN_ENCRYPTION_KEY` lama jika ingin mempertahankan UpCloud token yang terenkripsi.
3. Restore ke direktori data kosong khusus recovery, bukan database production lain.
4. Jika belum ada database target, restore melewati safety backup dan membuat file baru.
5. Start tanpa traffic publik, jalankan health check, lalu validasi data.
6. Jika key tidak tersedia, hapus/ganti token lokal melalui UI setelah recovery; jangan mencoba mendekripsi dengan key baru.

## Verifikasi setelah restore

- `schemaVersion` tetap `1`; koleksi users, servers, tokens, jobs, dan audit dapat dibaca aplikasi.
- Admin dapat login; session lama yang masih valid harus ditinjau/dicabut sesuai insiden.
- Token status awal mungkin `unknown` sampai test/sync; jangan menganggap valid hanya karena ciphertext berhasil direstore.
- UUID server tidak terduplikasi dan relasi grup maksimal dua slot tetap utuh.
- Audit dan job lama tersedia; jangan retry power job lama secara otomatis.
- Lakukan token connection test dan sync nonproduksi secara bertahap; pantau 429.

## Retensi dan automasi

Backup terjadwal boleh memanggil `node /path/to/scripts/backup.mjs` dari service/cron dengan working directory repository, environment minimal, dan permission ketat. Jangan log isi `.env` atau database. Terapkan retention/offsite lifecycle setelah memverifikasi restore; jangan menghapus satu-satunya safety backup.
