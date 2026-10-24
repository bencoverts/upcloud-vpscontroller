# Backup, restore, dan recovery

## Cakupan

Backup melindungi **database panel**: user/session hashes, encrypted API tokens, katalog VPS, grup, konfigurasi cache, sampel metrik, settings, sync jobs, dan audit logs. Backup tidak mencakup:

- Isi disk atau snapshot VPS UpCloud.
- `TOKEN_ENCRYPTION_KEY` dan database password dari `.env`.
- Container image atau host reverse-proxy configuration.

Simpan encryption key pada secret manager dengan backup terpisah. Tanpa key yang sama, token ciphertext yang berhasil direstore tidak dapat didekripsi; token harus diganti satu per satu.

## Format dan pengaman

`backup.sh` memakai PostgreSQL custom format (`pg_dump -Fc`), permission `0600`, temporary file, verifikasi katalog `pg_restore --list`, atomic rename, dan SHA-256 sidecar. `restore.sh` mewajibkan dua persetujuan eksplisit, memeriksa archive/database, membuat pre-restore safety dump, memakai `--single-transaction --exit-on-error`, dan memeriksa tabel wajib setelah restore.

## Backup dengan Compose

```bash
COMPOSE=1 ./scripts/backup.sh
# Contoh output: backups/cerdasnet-20261024T080000Z.dump
sha256sum -c backups/cerdasnet-20261024T080000Z.dump.sha256
```

`docker compose` membaca `.env` seperti biasa; script tidak mencetak password atau connection string. Simpan file pada storage terenkripsi di luar host dan uji retensi sesuai kebijakan organisasi.

## Backup dengan PostgreSQL client pada host

```bash
export DATABASE_URL='postgresql://USER:PASSWORD@DB_HOST:5432/cerdasnet'
./scripts/backup.sh
unset DATABASE_URL
```

Diperlukan `pg_dump`, `pg_restore`, `pg_isready`, dan `psql` dengan versi yang kompatibel. Jangan menaruh connection string berisi password dalam command history atau log CI.

## Restore dengan Compose

1. Pilih maintenance window dan pastikan archive berasal dari instans/key yang benar.
2. Verifikasi hash dan (idealnya) lakukan restore drill pada staging.
3. Hentikan app agar tidak ada write selama restore; biarkan database berjalan.
4. Jalankan guarded restore.
5. Start app, periksa readiness, login, token health, dan integritas server.

```bash
docker compose stop app
COMPOSE=1 APP_STOPPED=YES RESTORE_CONFIRM=YES \
  ./scripts/restore.sh backups/cerdasnet-20261024T080000Z.dump

docker compose start app
curl --fail http://127.0.0.1:3000/health/ready
docker compose logs --tail=100 app
```

Restore menggunakan `--clean --if-exists` dan bersifat destruktif terhadap schema target. Safety dump dibuat tepat sebelumnya tetapi bukan alasan untuk melewati staging drill. Jangan menjalankan dua restore bersamaan.

## Restore ke instans baru

1. Deploy versi aplikasi yang kompatibel dengan dump.
2. Gunakan `TOKEN_ENCRYPTION_KEY` lama jika ingin mempertahankan UpCloud token yang terenkripsi.
3. Restore ke database kosong khusus recovery, bukan database production lain.
4. Start tanpa traffic publik, jalankan migrasi/health check, lalu validasi data.
5. Jika key tidak tersedia, hapus/ganti token lokal melalui UI setelah recovery; jangan mencoba mendekripsi dengan key baru.

## Verifikasi setelah restore

- `schema_migrations`, `servers`, dan `api_tokens` dapat di-query.
- Admin dapat login; session lama yang masih valid harus ditinjau/dicabut sesuai insiden.
- Token status awal mungkin `unknown` sampai test/sync; jangan menganggap valid hanya karena ciphertext berhasil direstore.
- UUID server tidak terduplikasi dan relasi grup maksimal dua slot tetap utuh.
- Audit dan job lama tersedia; jangan retry power job lama secara otomatis.
- Lakukan token connection test dan sync nonproduksi secara bertahap; pantau 429.

## Retensi dan automasi

Backup terjadwal boleh memanggil `COMPOSE=1 /path/to/scripts/backup.sh` dari service/cron dengan working directory repository, environment minimal, dan permission ketat. Jangan log isi `.env`. Terapkan retention/offsite lifecycle setelah memverifikasi restore; jangan menghapus satu-satunya safety dump.
