export function cx(...values: Array<string | false | null | undefined>): string { return values.filter(Boolean).join(' '); }
export function formatDate(value: string | Date | null | undefined, includeSeconds = false): string {
  if (!value) return 'Belum pernah';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Tidak diketahui';
  return new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: includeSeconds ? 'medium' : 'short' }).format(date);
}
export function relativeTime(value: string | Date | null | undefined): string {
  if (!value) return 'Belum pernah';
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return 'Tidak diketahui';
  const seconds = Math.round((timestamp - Date.now()) / 1000);
  const formatter = new Intl.RelativeTimeFormat('id', { numeric: 'auto' });
  if (Math.abs(seconds) < 60) return formatter.format(seconds, 'second');
  const minutes = Math.round(seconds / 60);
  if (Math.abs(minutes) < 60) return formatter.format(minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return formatter.format(hours, 'hour');
  return formatter.format(Math.round(hours / 24), 'day');
}
export function formatMemory(mib: number): string {
  if (!Number.isFinite(mib) || mib <= 0) return '0 GiB';
  if (mib < 1024) return `${mib.toLocaleString('id-ID')} MiB`;
  return `${(mib / 1024).toLocaleString('id-ID', { maximumFractionDigits: 1 })} GiB`;
}
export function formatStorage(gib: number): string {
  if (gib >= 1024) return `${(gib / 1024).toLocaleString('id-ID', { maximumFractionDigits: 2 })} TiB`;
  return `${gib.toLocaleString('id-ID', { maximumFractionDigits: 1 })} GiB`;
}
export function formatRate(value: number | null | undefined, kind: 'bytes' | 'bits'): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'Tidak tersedia';
  const units = kind === 'bytes' ? ['B/s', 'KiB/s', 'MiB/s', 'GiB/s'] : ['bit/s', 'Kbit/s', 'Mbit/s', 'Gbit/s'];
  const divisor = kind === 'bytes' ? 1024 : 1000;
  let index = 0;
  let scaled = value;
  while (scaled >= divisor && index < units.length - 1) { scaled /= divisor; index += 1; }
  return `${scaled.toLocaleString('id-ID', { maximumFractionDigits: 2 })} ${units[index]}`;
}
export function shortUuid(uuid: string): string { return `${uuid.slice(0, 8)}…${uuid.slice(-4)}`; }
export function isStale(value: string | null | undefined, seconds: number): boolean {
  if (!value) return true;
  const timestamp = new Date(value).getTime();
  return !Number.isFinite(timestamp) || Date.now() - timestamp > seconds * 1000;
}
export const stateLabels: Record<string, string> = {
  started: 'Aktif', stopped: 'Berhenti', maintenance: 'Maintenance', error: 'Bermasalah', unknown: 'Tidak diketahui',
  ok: 'Tersinkron', degraded: 'Sebagian', not_found: 'Tidak ditemukan', valid: 'Valid', invalid: 'Tidak valid', expired: 'Kedaluwarsa',
  online: 'Online', offline: 'Offline', queued: 'Antre', running: 'Berjalan', verifying: 'Verifikasi',
  succeeded: 'Berhasil', failed: 'Gagal', verification_timeout: 'Verifikasi timeout',
  success: 'Sukses', failure: 'Gagal', accepted: 'Diterima', info: 'Info',
};
