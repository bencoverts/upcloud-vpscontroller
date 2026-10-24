import { AppError } from '../lib/errors.js';
import type { Database } from '../db/index.js';
import type { AppConfig } from '../config.js';
import { base64ToBytes } from '../lib/crypto.js';

export type Branding = { siteName: string; siteTagline: string; accent: 'teal' | 'blue' | 'violet' | 'rose' | 'amber'; defaultTheme: 'system' | 'light' | 'dark' };
export type BrandingAsset = { mime: string; data: string; updatedAt: string };
const defaults = (config: AppConfig): Branding => ({ siteName: config.siteName, siteTagline: config.siteTagline, accent: 'teal', defaultTheme: 'system' });

export class BrandingService {
  constructor(private readonly db: Database, private readonly config: AppConfig) {}
  async get(): Promise<Branding & { logoUrl: string | null; faviconUrl: string | null }> {
    return this.db.read((data) => {
      const values = new Map(data.app_settings.map((row) => [row.key, row.value]));
      const base = defaults(this.config);
      return {
        siteName: typeof values.get('siteName') === 'string' ? String(values.get('siteName')) : base.siteName,
        siteTagline: typeof values.get('siteTagline') === 'string' ? String(values.get('siteTagline')) : base.siteTagline,
        accent: ['teal', 'blue', 'violet', 'rose', 'amber'].includes(String(values.get('accent'))) ? values.get('accent') as Branding['accent'] : base.accent,
        defaultTheme: ['system', 'light', 'dark'].includes(String(values.get('defaultTheme'))) ? values.get('defaultTheme') as Branding['defaultTheme'] : base.defaultTheme,
        logoUrl: values.has('asset:logo') ? '/api/branding/assets/logo' : null,
        faviconUrl: values.has('asset:favicon') ? '/api/branding/assets/favicon' : null,
      };
    });
  }
  async update(input: Branding) {
    await this.db.withTransaction(({ data }) => {
      for (const [key, value] of Object.entries(input)) {
        const current = data.app_settings.find((row) => row.key === key);
        if (current) { current.value = value; current.updated_at = new Date().toISOString(); }
        else data.app_settings.push({ key, value, updated_at: new Date().toISOString() });
      }
    });
    return this.get();
  }
  async setAsset(kind: 'logo' | 'favicon', dataUrl: string) {
    const match = dataUrl.match(/^data:(image\/(?:png|jpeg|webp|x-icon|vnd\.microsoft\.icon));base64,([A-Za-z0-9+/=]+)$/);
    if (!match) throw new AppError(400, 'IMAGE_INVALID', 'Gunakan PNG, JPEG, WebP, atau ICO yang valid.');
    const mime = match[1]!.includes('icon') ? 'image/x-icon' : match[1]!;
    const allowed = kind === 'logo' ? ['image/png', 'image/jpeg', 'image/webp'] : ['image/png', 'image/x-icon'];
    if (!allowed.includes(mime)) throw new AppError(400, 'IMAGE_INVALID', `Format ${mime} tidak diizinkan untuk ${kind}.`);
    const bytes = base64ToBytes(match[2]!);
    if (bytes.length < 8 || bytes.length > 512 * 1024) throw new AppError(413, 'IMAGE_TOO_LARGE', 'Ukuran gambar maksimal 512 KiB.');
    const signature = (values: number[]) => values.every((value, index) => bytes[index] === value);
    const valid = mime === 'image/png' ? signature([137, 80, 78, 71, 13, 10, 26, 10])
      : mime === 'image/jpeg' ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
        : mime === 'image/webp' ? new TextDecoder().decode(bytes.subarray(0, 4)) === 'RIFF' && new TextDecoder().decode(bytes.subarray(8, 12)) === 'WEBP'
          : signature([0, 0, 1, 0]);
    if (!valid) throw new AppError(400, 'IMAGE_INVALID', 'Isi file tidak sesuai dengan format gambar.');
    const asset: BrandingAsset = { mime, data: match[2]!, updatedAt: new Date().toISOString() };
    await this.db.withTransaction(({ data }) => {
      const key = `asset:${kind}`;
      const current = data.app_settings.find((row) => row.key === key);
      if (current) { current.value = asset; current.updated_at = asset.updatedAt; }
      else data.app_settings.push({ key, value: asset, updated_at: asset.updatedAt });
    });
    return this.get();
  }
  async asset(kind: 'logo' | 'favicon'): Promise<BrandingAsset | null> {
    return this.db.read((data) => {
      const value = data.app_settings.find((row) => row.key === `asset:${kind}`)?.value as BrandingAsset | undefined;
      return value && typeof value.data === 'string' && typeof value.mime === 'string' ? value : null;
    });
  }
  async removeAsset(kind: 'logo' | 'favicon') {
    await this.db.withTransaction(({ data }) => { data.app_settings = data.app_settings.filter((row) => row.key !== `asset:${kind}`); });
    return this.get();
  }
}
