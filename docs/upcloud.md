# Kontrak UpCloud dan interpretasi data

Backend memakai origin tetap `https://api.upcloud.com/1.3` dan Bearer authentication. Referensi utama: [UpCloud API getting started](https://developers.upcloud.com/api/1.3/getting-started), [server resources](https://developers.upcloud.com/api/1.3/server), dan [account tokens](https://developers.upcloud.com/api/1.3/account-tokens).

## Endpoint yang digunakan

| Operasi | Endpoint |
|---|---|
| Validasi akun | `GET /account` |
| Discovery | `GET /server` dengan pagination |
| Detail konfigurasi | `GET /server/{uuid}` |
| Ubah title/hostname | `PUT /server/{uuid}` dengan envelope `server` |
| CPU | `GET /server/{uuid}/stats/cpu/daily` |
| Disk activity | `GET /server/{uuid}/stats/disk/bytes/daily` |
| Network activity | `GET /server/{uuid}/stats/network/bytes/daily` |
| Start | `POST /server/{uuid}/start` |
| Soft stop | `POST /server/{uuid}/stop` |
| Soft restart | `POST /server/{uuid}/restart` |

Response envelopes dinormalisasi dari `servers.server`, `server`, dan `stats.{period}.summary.variable`. Error mengenali `error.error_code` dan `error.error_message`; pesan disanitasi sebelum ditampilkan/disimpan.

## Rename title dan hostname

Request modification menggunakan envelope resmi:

```json
{
  "server": {
    "title": "Nama server baru",
    "hostname": "server-baru.example.com"
  }
}
```

Backend memvalidasi UUID, title, dan format hostname, membatasi perubahan pada admin atau client dengan assignment yang masih berlaku, dan menolak submit identitas ganda yang masih berjalan. Cache lokal baru diperbarui dari respons upstream setelah UpCloud menerima perubahan. Error upstream tidak diubah menjadi sukses; audit hanya mencatat identitas yang diterima, bukan secret.

## Power request

```json
// start
{ "server": { "start_type": "async" } }

// stop
{ "stop_server": { "stop_type": "soft", "timeout": "60" } }

// restart
{ "restart_server": { "stop_type": "soft", "timeout": "60", "timeout_action": "ignore" } }
```

Power POST tidak di-retry otomatis. Setelah response diterima, worker membaca detail server dan membutuhkan dua observasi state target berturut-turut. Timeout menghasilkan `verification_timeout`, bukan sukses. Ini memverifikasi power state yang dilaporkan API; bukan bukti SSH readiness, guest boot completion, atau health aplikasi. Restart adalah operasi resmi stop-and-start; panel tidak menambahkan tombol reboot dekoratif.

## Monitoring yang jujur

Statistik yang tersedia berasal dari **daily summary** dengan nilai `current`, `average`, `maximum`, `total`, dan unit. Panel menyimpan `current` yang valid setelah konversi unit konservatif. `sampledAt` adalah waktu panel menerima summary, bukan timestamp pengukuran deret waktu dari hypervisor.

| Data | Sumber / interpretasi |
|---|---|
| vCPU, RAM total, storage total, zone, plan | Konfigurasi server dari UpCloud |
| Power state | State resource dari UpCloud; bukan OS uptime |
| CPU usage | UpCloud CPU statistics bila tersedia |
| Disk read/write | Aktivitas block device; bukan filesystem usage |
| Network in/out | Traffic interface dari statistics; bukan reachability |
| IP, MAC, interface | Konfigurasi yang berhasil dibaca; bukan ping/port health |
| RAM/swap usage | Tidak tersedia melalui API ini; guest agent membaca `/proc/meminfo` bila dipasang |
| Filesystem used/free | Bukan kapasitas/throughput block storage; guest agent membaca `df` bila dipasang |
| OS uptime | Bukan power state; guest agent membaca `/proc/uptime` bila dipasang |

Sampel UpCloud dan guest agent disimpan sebagai record berbeda, lalu nilai aktual terakhir per field digabung dengan timestamp sumber. Agent hanya dapat mengirim ke UUID yang sesuai dengan hash token-nya. Lihat [guest-agent.md](guest-agent.md).

History hanya terbentuk dari sampel panel. Tidak ada backfill/interpolasi untuk waktu sebelum panel berjalan. Jika lebih dari 600 titik perlu ditampilkan, satu sampel aktual terakhir per time bucket dipilih; tidak ada rata-rata atau nilai baru yang direkayasa. Interval default 300 detik mengurangi request sia-sia karena upstream berupa daily summary.

Kegagalan sebagian CPU/disk/network disimpan sebagai partial sample dengan error per kategori. Kegagalan seluruh request menghasilkan sinkronisasi gagal/stale state, bukan angka nol palsu. Server stopped, izin token, atau retensi upstream dapat membuat nilai tidak tersedia.

## Multi-token dan group selection

- Setiap token divalidasi melalui account dan complete server list sebelum disimpan/diganti.
- Semua UUID yang ditemukan masuk katalog global; upsert berdasarkan UUID mencegah duplikasi antar-token.
- Maksimal dua VPS per token hanya mengatur `token_server_groups.slot` untuk tampilan grup.
- Batas ini **bukan** UpCloud ACL dan tidak mengubah hak token. Semua server hasil discovery tetap disinkronkan.
- Token failure mengubah status token tersebut dan mempertahankan cache; token lain tetap diproses.

## Masa berlaku dan penggunaan token

Bearer secret tidak memberikan token UUID yang dapat diandalkan untuk membaca metadata token Hub. Karena itu panel tidak mengklaim mengambil `expires_at`, `last_used_at`, atau allowed IP ranges upstream dari secret saja. Form masa berlaku adalah metadata admin dan diberi label demikian. `lastUsedAt` panel adalah penggunaan kredensial oleh panel.

Token kedaluwarsa/dicabut/filter IP tetap ditentukan oleh respons UpCloud saat request. Penghapusan lokal tidak mencabut token di Hub.

## Resilience

GET mempunyai timeout, response-size/JSON checks, redirect rejection, maksimal empat percobaan dengan jitter, dan penanganan `Retry-After`/429. Retry-After yang terlalu lama tidak ditunggu tanpa batas. Power operations tidak memakai automatic retry. Backend bukan generic proxy dan tidak menerima base URL dari browser.
