# Deployment penuh ke Cloudflare Workers

Deployment ini tidak mem-proxy API ke server Node.js. Worker menyajikan frontend statis dan seluruh API panel, sedangkan Durable Object menjalankan transaksi, job/scheduler, dan WebSocket.

## Arsitektur data

- **Workers Static Assets:** hasil build React dari `frontend/dist` dengan SPA fallback.
- **Worker API:** autentikasi, client assignment/expiry, encrypted UpCloud token, sync/power/rename, metrics, agent ingestion, settings, activity, dan backup.
- **`PanelDurableObject`:** satu instance bernama `global`; satu writer untuk transaksi, job, alarm, dan koneksi WebSocket.
- **R2:** satu object `database.json` pada bucket yang dikonfigurasi. R2 menyimpan data persisten; Durable Object mencegah lost update dan menyimpan cache konsisten selama instance aktif.
- **Secrets:** `TOKEN_ENCRYPTION_KEY` berada di Workers Secrets, bukan di R2, source, atau frontend bundle.

Model ini cocok untuk panel administrasi dengan satu writer logis. Setiap transaksi menulis dokumen JSON lengkap ke R2; gunakan retention metrik yang wajar dan backup berkala. Ini bukan database multi-region multi-writer.

## Prasyarat

1. Akun Cloudflare dengan Workers, Durable Objects, dan R2 tersedia.
2. Node.js `>=22.12`, npm, dan Wrangler yang sudah diautentikasi (`npx wrangler login` pada mesin Anda).
3. URL HTTPS final, misalnya custom domain atau `https://cerdasnet-vps-control.<subdomain>.workers.dev`.

Dari root checkout baru, install seluruh dependency build/shared:

```bash
npm run setup
npm --prefix worker ci --include=dev
```

Dependency backend tetap diperlukan **saat build** karena Worker membundle service portable yang sama. Dependency tersebut tidak menjadi server Node.js pada deployment.

## Konfigurasi

Edit `worker/wrangler.jsonc`:

- `name`: nama Worker Anda.
- `vars.APP_ORIGIN`: origin HTTPS final, tanpa path atau trailing slash.
- `r2_buckets[0].bucket_name`: bucket JSON Anda.
- Pertahankan `COOKIE_SECURE=true` untuk production.
- Sesuaikan interval sync/metrics/retention bila perlu.

Buat bucket dengan nama yang sama:

```bash
cd worker
npx wrangler r2 bucket create cerdasnet-panel-data
```

Jangan menaruh encryption key, UpCloud token, password admin, atau agent token di `wrangler.jsonc`.

## Build dan deploy

Dari root repository:

```bash
npm run build
npm --prefix worker run typecheck
npm --prefix worker run check
npm --prefix worker run deploy
```

`check` adalah Wrangler dry-run dan tidak mengubah deployment remote. Perintah `deploy` membangun ulang frontend lalu mempublikasikan Worker dan asetnya.

## Secrets dan bootstrap admin satu kali

Setelah Worker pertama kali ada, pasang encryption key. Simpan key yang sama di secret manager terpisah untuk pemulihan backup; jangan menulisnya ke file repository.

```bash
cd worker
TOKEN_ENCRYPTION_KEY="$(openssl rand -hex 32)"
printf '%s' "$TOKEN_ENCRYPTION_KEY" | npx wrangler secret put TOKEN_ENCRYPTION_KEY
```

Buat secret bootstrap acak. Secret ini hanya membuka endpoint pembuatan admin **selama database belum memiliki user**.

```bash
BOOTSTRAP_SECRET="$(openssl rand -hex 32)"
printf '%s' "$BOOTSTRAP_SECRET" | npx wrangler secret put BOOTSTRAP_SECRET
```

Pada shell yang sama, panggil endpoint satu kali. Ganti origin dengan `APP_ORIGIN` Anda dan masukkan credential baru secara interaktif:

```bash
PANEL_ORIGIN="https://panel.example.com"
read -rp "Admin username: " ADMIN_USERNAME
read -rsp "Admin password (min. 12 karakter): " ADMIN_PASSWORD; echo
export ADMIN_USERNAME ADMIN_PASSWORD

node -e 'process.stdout.write(JSON.stringify({username:process.env.ADMIN_USERNAME,password:process.env.ADMIN_PASSWORD}))' \
  | curl --fail-with-body --silent --show-error \
      --request POST "$PANEL_ORIGIN/api/auth/bootstrap" \
      --header "Origin: $PANEL_ORIGIN" \
      --header "X-Bootstrap-Key: $BOOTSTRAP_SECRET" \
      --header "Content-Type: application/json" \
      --data-binary @-
```

Password minimal 12 karakter dan harus memuat huruf besar, huruf kecil, serta angka. Setelah respons `201`, hapus jalur bootstrap dan variable shell:

```bash
npx wrangler secret delete BOOTSTRAP_SECRET
unset BOOTSTRAP_SECRET TOKEN_ENCRYPTION_KEY ADMIN_USERNAME ADMIN_PASSWORD
```

Bootstrap berikutnya ditolak (`409`) karena user sudah ada. Tidak ada kredensial default permanen. Login admin dan client kemudian menggunakan halaman yang sama.

## Verifikasi production

```bash
curl --fail "$PANEL_ORIGIN/health/live"
curl --fail "$PANEL_ORIGIN/health/ready"
```

Kemudian melalui browser:

1. Login sebagai admin dan tambahkan UpCloud API token melalui panel.
2. Pastikan seluruh VPS yang ditemukan muncul sebelum memilih maksimal dua VPS untuk grouping/display.
3. Buat client, tetapkan VPS dan expiry, lalu login sebagai client di browser/profile terpisah.
4. Uji hanya pada VPS nonproduction yang memang diizinkan untuk kontrol/rename.
5. Buka Settings dan download backup JSON; pastikan file dapat dibuka dan tidak berisi live `sessions`.
6. Pastikan indikator realtime tersambung. WebSocket menggunakan `/api/events` pada origin yang sama.

Jangan menjalankan power/rename test pada production hanya untuk menguji deployment.

## Backup dan pemulihan

- Menu **Settings → Download backup JSON** mengambil snapshot konsisten dari R2 melalui Durable Object. Live session dikosongkan; UpCloud token tetap berupa ciphertext AES-256-GCM.
- Backup tidak memuat `TOKEN_ENCRYPTION_KEY` dan tidak mem-backup disk VPS.
- Aktifkan versioning/retention R2 sesuai kebijakan organisasi. Uji pemulihan pada Worker/bucket nonproduction terlebih dahulu.
- Restore object secara manual harus dilakukan dalam maintenance window agar Durable Object tidak menulis snapshot lama kembali. Jangan menimpa `database.json` saat panel aktif.

## Development Worker lokal

`wrangler dev --local` menyimulasikan Durable Object dan R2 pada mesin lokal. Buat `worker/.dev.vars` (diabaikan Git) dengan key khusus development, bukan secret production:

```bash
{
  printf 'TOKEN_ENCRYPTION_KEY='
  openssl rand -hex 32
  printf 'APP_ORIGIN=http://localhost:8787\nCOOKIE_SECURE=false\n'
} > worker/.dev.vars
chmod 600 worker/.dev.vars
```

Key tersebut adalah 64 hex characters/32 byte. Dari root:

```bash
npm run build
npm --prefix worker run dev
```

Jangan menggunakan HTTP atau `COOKIE_SECURE=false` pada deployment production.
