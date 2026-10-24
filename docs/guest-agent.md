# Guest agent Linux untuk RAM, swap, filesystem, dan OS uptime

UpCloud server-statistics API yang digunakan panel tidak menyediakan penggunaan RAM/swap filesystem guest maupun OS uptime. `scripts/guest-agent.mjs` adalah collector opsional yang berjalan **di dalam VPS Linux** dan mengirim pengukuran aktual ke panel.

Tanpa agent, kartu dan grafik tersebut tetap menampilkan status tidak tersedia. Panel tidak menghitung filesystem usage dari kapasitas block storage atau disk throughput.

## Sumber dan arti metrik

- **Memory:** `/proc/meminfo`; used = `MemTotal - MemAvailable`.
- **Swap:** `/proc/meminfo`; used = `SwapTotal - SwapFree`.
- **Filesystem:** output byte `df -B1 -P`, hanya filesystem lokal dengan source `/dev/...`. Pseudo/network filesystem dikeluarkan dan bind mount dari source yang sama tidak dihitung dua kali.
- **OS uptime:** angka pertama `/proc/uptime`.

Total filesystem dapat berbeda dari kapasitas storage UpCloud karena partisi, RAID/LVM, reserved blocks, dan beberapa device. Nilai ini adalah penggunaan filesystem yang dilaporkan guest, bukan kapasitas block storage.

## Prasyarat

- Linux dengan `df`, `/proc/meminfo`, dan `/proc/uptime`.
- Node.js `>=22.12` pada VPS.
- Koneksi egress HTTPS ke origin panel. Agent tidak membuka port inbound.
- VPS sudah ditemukan/di-sync ke panel oleh admin.

Script tidak memiliki dependency npm dan tidak berbicara langsung dengan UpCloud.

## 1. Buat credential agent

Di panel admin, buka VPS → **Performance** → bagian **Guest agent**, lalu pilih rotasi/buat token. Token lengkap hanya ditampilkan sekali. Simpan sementara di secret manager; panel hanya menyimpan hash-nya.

Token agent hanya mengizinkan POST sampel untuk UUID VPS tersebut. Token tidak dapat login ke panel, membaca VPS lain, mengontrol power, rename, atau memanggil UpCloud.

## 2. Install script

Salin `scripts/guest-agent.mjs` ke VPS, misalnya dengan `scp`, lalu pada VPS:

```bash
sudo install -d -m 0755 /opt/cerdasnet-agent
sudo install -m 0755 guest-agent.mjs /opt/cerdasnet-agent/guest-agent.mjs
command -v node
```

Gunakan path Node pada `ExecStart` jika bukan `/usr/bin/node`.

## 3. Simpan konfigurasi rahasia

Buat file environment sebagai root. Masukkan token melalui prompt agar tidak menjadi hardcoded credential atau bagian dari command history.

```bash
sudo install -m 0600 /dev/null /etc/cerdasnet-agent.env
read -rp "Panel HTTPS origin: " PANEL_URL
read -rp "UpCloud server UUID: " SERVER_UUID
read -rsp "Agent token: " AGENT_TOKEN; echo

sudo sh -c 'umask 077; cat > /etc/cerdasnet-agent.env' <<EOF
PANEL_URL=$PANEL_URL
SERVER_UUID=$SERVER_UUID
AGENT_TOKEN=$AGENT_TOKEN
AGENT_INTERVAL_SECONDS=60
EOF
unset PANEL_URL SERVER_UUID AGENT_TOKEN
```

`PANEL_URL` harus origin panel (`https://panel.example.com`), bukan URL UpCloud. HTTP hanya diterima untuk localhost/127.0.0.1 pada development.

## 4. systemd service

Buat `/etc/systemd/system/cerdasnet-guest-agent.service`:

```ini
[Unit]
Description=CerdasNet read-only guest metrics agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
EnvironmentFile=/etc/cerdasnet-agent.env
ExecStart=/usr/bin/node /opt/cerdasnet-agent/guest-agent.mjs
DynamicUser=yes
Restart=always
RestartSec=15
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=strict
ProtectHome=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectControlGroups=yes
RestrictSUIDSGID=yes
LockPersonality=yes
MemoryDenyWriteExecute=yes
UMask=0077

[Install]
WantedBy=multi-user.target
```

Aktifkan dan periksa:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now cerdasnet-guest-agent
sudo systemctl status cerdasnet-guest-agent
sudo journalctl -u cerdasnet-guest-agent -n 50 --no-pager
```

Panel akan menampilkan `lastSeenAt` dan sampel aktual setelah submission pertama diterima (`202`). HTTP `401` biasanya berarti token salah/sudah dirotasi atau UUID tidak cocok. Agent tidak mencetak token dalam log.

## Rotasi, pemadaman, dan uninstall

- **Rotasi:** buat token baru di panel, ganti `AGENT_TOKEN` di environment file, lalu `sudo systemctl restart cerdasnet-guest-agent`. Token lama langsung tidak berlaku.
- **Jika dicurigai bocor:** rotasi token terlebih dahulu, lalu hentikan service dan perbarui secret. Jangan mengirim token melalui ticket/chat/log.
- **Uninstall:** `sudo systemctl disable --now cerdasnet-guest-agent`, hapus unit, script, dan `/etc/cerdasnet-agent.env`; rotasi token panel agar credential lama tidak dapat digunakan lagi.

Menghentikan agent hanya menghentikan pengiriman metrik OS. Agent tidak pernah mematikan VPS dan expiry akses client panel juga tidak mematikan VPS.
