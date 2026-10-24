import { z } from 'zod';
import type { Database } from '../db/index.js';
import type { PanelUser } from '../auth/service.js';
import { requireServerAccess } from '../auth/access.js';
import { AppError } from '../lib/errors.js';
import type { TokenService } from '../tokens/service.js';
import type { SyncService } from '../sync/service.js';
import type { UpCloudDeploymentInput, UpCloudRebuildInput } from '../upcloud/types.js';
import { getServer, persistServer, upsertMembership } from './catalog.js';

const hostname = z.string().trim().min(1).max(253).regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/);
const sshKeys = z.array(z.string().trim().min(20).max(8192).regex(/^(?:ssh-(?:rsa|ed25519)|ecdsa-sha2-nistp(?:256|384|521))\s+\S+(?:\s+[^\r\n]+)?$/)).max(8).default([]);
export const deploymentSchema = z.object({
  tokenId: z.string().uuid(), title: z.string().trim().min(1).max(255), confirmationTitle: z.string().trim().min(1).max(255), hostname,
  zone: z.string().trim().min(2).max(15), plan: z.string().trim().min(1).max(100),
  templateUuid: z.string().uuid(), storageGib: z.number().int().min(1).max(4096),
  storageTier: z.enum(['maxiops', 'standard', 'hdd']).default('maxiops'),
  sshKeys, passwordDelivery: z.enum(['none', 'email']).default('none'),
}).superRefine((value, context) => {
  if (value.title !== value.confirmationTitle) context.addIssue({ code: 'custom', message: 'Konfirmasi judul deployment tidak sama.', path: ['confirmationTitle'] });
  if (value.passwordDelivery === 'none' && value.sshKeys.length === 0) context.addIssue({ code: 'custom', message: 'Deployment tanpa email memerlukan SSH public key.' });
});
export const rebuildSchema = z.object({
  mode: z.enum(['change_os', 'reset_os']), templateUuid: z.string().uuid(), detachDisk: z.string().uuid(),
  deleteDetachedDisk: z.boolean().default(false), encrypted: z.boolean().default(false),
  storageTitle: z.string().trim().max(255).optional(), shutdownFirst: z.boolean().default(false),
  confirmationTitle: z.string().trim().min(1).max(255), sshKeys, passwordDelivery: z.enum(['none', 'email']).default('none'),
}).superRefine((value, context) => {
  if (value.passwordDelivery === 'none' && value.sshKeys.length === 0) context.addIssue({ code: 'custom', message: 'Rebuild tanpa email memerlukan SSH public key.' });
});

export const configurationSchema = z.object({
  confirmationTitle: z.string().trim().min(1).max(255), plan: z.string().trim().min(1).max(100).optional(),
  timezone: z.string().trim().min(1).max(64).optional(), bootOrder: z.string().trim().min(1).max(100).optional(),
  nicModel: z.enum(['e1000', 'rtl8139', 'virtio']).optional(), metadata: z.boolean().optional(),
}).refine((value) => ['plan', 'timezone', 'bootOrder', 'nicModel', 'metadata'].some((key) => value[key as keyof typeof value] !== undefined), 'Tidak ada konfigurasi yang diubah.');
export const deleteServerSchema = z.object({ confirmationTitle: z.string().trim().min(1).max(255), deleteStorages: z.boolean().default(false) });

export class LifecycleService {
  private readonly catalogs = new Map<string, Promise<Awaited<ReturnType<LifecycleService['fetchCatalog']>>>>();
  constructor(private readonly db: Database, private readonly tokens: TokenService, private readonly sync: SyncService) {}

  async catalog(tokenId: string, refresh = false) {
    if (refresh) this.catalogs.delete(tokenId);
    const existing = this.catalogs.get(tokenId);
    if (existing) return existing;
    const task = this.fetchCatalog(tokenId).catch((error) => { this.catalogs.delete(tokenId); throw error; });
    this.catalogs.set(tokenId, task);
    return task;
  }

  private async fetchCatalog(tokenId: string) {
    const token = await this.tokens.requireRecord(tokenId);
    if (!token.enabled) throw new AppError(409, 'CONFLICT', 'Token sedang dinonaktifkan.');
    const client = this.tokens.gatewayFor(token);
    const [templates, plans, zones] = await Promise.all([client.listTemplates(), client.listPlans(), client.listZones()]);
    return {
      token: { id: token.id, name: token.name },
      templates: templates.filter((template) => !template.access || template.access === 'public'),
      plans, zones, source: 'upcloud_api', note: 'Template, plan, dan zona dibaca langsung dari upstream; harga tidak disediakan oleh endpoint ini.',
    };
  }

  async deploy(raw: unknown, actor: PanelUser) {
    const input = deploymentSchema.parse(raw);
    const catalog = await this.catalog(input.tokenId, true);
    if (!catalog.templates.some((row) => row.uuid === input.templateUuid)) throw new AppError(400, 'TEMPLATE_UNAVAILABLE', 'Template OS tidak tersedia untuk token ini.');
    const plan = catalog.plans.find((row) => row.name === input.plan);
    if (!plan) throw new AppError(400, 'PLAN_UNAVAILABLE', 'Plan tidak tersedia untuk token ini.');
    if (!catalog.zones.some((row) => row.id === input.zone)) throw new AppError(400, 'ZONE_UNAVAILABLE', 'Zona tidak tersedia untuk token ini.');
    const template = catalog.templates.find((row) => row.uuid === input.templateUuid)!;
    if (input.storageGib < Math.max(template.sizeGib, plan.storageGib)) throw new AppError(400, 'STORAGE_TOO_SMALL', `Storage minimal ${Math.max(template.sizeGib, plan.storageGib)} GiB untuk template dan plan ini.`);
    const { confirmationTitle: _confirmation, ...deploymentFields } = input;
    const deployment: UpCloudDeploymentInput = { ...deploymentFields };
    return this.sync.enqueueDeployment(input.tokenId, deployment, actor.id);
  }

  async rebuildCatalog(uuid: string, actor: PanelUser) {
    await requireServerAccess(this.db, actor, uuid);
    const { token } = await this.sync.upstreamForServer(uuid);
    return this.catalog(token.id);
  }

  async rebuild(uuid: string, raw: unknown, actor: PanelUser) {
    const input = rebuildSchema.parse(raw);
    await requireServerAccess(this.db, actor, uuid);
    const server = await getServer(this.db, uuid, actor);
    if (!server) throw new AppError(404, 'NOT_FOUND', 'Server tidak ditemukan atau akses telah berakhir.');
    if (server.title !== input.confirmationTitle) throw new AppError(400, 'CONFIRMATION_INVALID', 'Judul konfirmasi tidak sama dengan judul VPS.');
    if (!['started', 'stopped'].includes(server.state)) throw new AppError(409, 'SERVER_STATE_ILLEGAL', `Rebuild tidak dapat dimulai dari status ${server.state}.`);
    if (server.state !== 'stopped' && !input.shutdownFirst) throw new AppError(409, 'SERVER_NOT_STOPPED', 'VPS harus di-shutdown terlebih dahulu. Pilih shutdown otomatis atau hentikan VPS secara manual.');
    const disk = server.storages.find((row) => row.uuid === input.detachDisk && row.attached);
    if (!disk || disk.deviceType === 'cdrom') throw new AppError(400, 'DISK_UNAVAILABLE', 'Disk OS yang akan diganti harus merupakan disk yang sedang terlampir.');
    const { token } = await this.sync.upstreamForServer(uuid);
    const catalog = await this.catalog(token.id, true);
    if (!catalog.templates.some((row) => row.uuid === input.templateUuid)) throw new AppError(400, 'TEMPLATE_UNAVAILABLE', 'Template rebuild harus berupa public template yang tersedia.');
    const rebuild: UpCloudRebuildInput & { shutdownFirst: boolean; mode: 'change_os' | 'reset_os' } = {
      mode: input.mode, templateUuid: input.templateUuid, detachDisk: input.detachDisk,
      deleteDetachedDisk: input.deleteDetachedDisk, encrypted: input.encrypted,
      storageTitle: input.storageTitle, shutdownFirst: input.shutdownFirst,
      sshKeys: input.sshKeys, passwordDelivery: input.passwordDelivery,
    };
    return this.sync.enqueueRebuild(uuid, rebuild, actor.id);
  }

  async deploymentTargets() {
    return this.db.read((data) => data.api_tokens.filter((row) => row.enabled).map((row) => ({ id: row.id, name: row.name })));
  }

  async updateConfiguration(uuid: string, raw: unknown, actor: PanelUser) {
    const input = configurationSchema.parse(raw);
    await requireServerAccess(this.db, actor, uuid);
    const server = await getServer(this.db, uuid, actor);
    if (!server) throw new AppError(404, 'NOT_FOUND', 'Server tidak ditemukan atau akses telah berakhir.');
    if (server.title !== input.confirmationTitle) throw new AppError(400, 'CONFIRMATION_INVALID', 'Judul konfirmasi tidak sama dengan judul VPS.');
    if (server.activeJob) throw new AppError(409, 'JOB_ACTIVE', 'Tunggu job server aktif selesai sebelum mengubah konfigurasi.');
    if (input.plan && server.state !== 'stopped') throw new AppError(409, 'SERVER_NOT_STOPPED', 'Perubahan plan memerlukan VPS dalam status stopped.');
    const { token, client } = await this.sync.upstreamForServer(uuid);
    if (input.plan) {
      const catalog = await this.catalog(token.id, true);
      if (!catalog.plans.some((row) => row.name === input.plan)) throw new AppError(400, 'PLAN_UNAVAILABLE', 'Plan tidak tersedia untuk token ini.');
    }
    const changes = { plan: input.plan, timezone: input.timezone, bootOrder: input.bootOrder, nicModel: input.nicModel, metadata: input.metadata };
    await client.updateConfiguration(uuid, changes);
    const verified = await client.getServer(uuid);
    if (input.plan && verified.plan !== input.plan) throw new AppError(502, 'VERIFICATION_FAILED', 'UpCloud belum melaporkan plan yang diminta; sinkronkan dan periksa sebelum mencoba lagi.');
    await this.db.withTransaction(({ data }) => { persistServer(data, verified); upsertMembership(data, token.id, uuid); });
    this.sync.publishServer(uuid);
    return getServer(this.db, uuid, actor);
  }

  async delete(uuid: string, raw: unknown, actor: PanelUser) {
    if (actor.role !== 'admin') throw new AppError(403, 'FORBIDDEN', 'Penghapusan VPS hanya dapat dilakukan admin.');
    const input = deleteServerSchema.parse(raw);
    const server = await getServer(this.db, uuid, actor);
    if (!server) throw new AppError(404, 'NOT_FOUND', 'Server tidak ditemukan.');
    if (server.title !== input.confirmationTitle) throw new AppError(400, 'CONFIRMATION_INVALID', 'Judul konfirmasi tidak sama dengan judul VPS.');
    if (server.state !== 'stopped') throw new AppError(409, 'SERVER_NOT_STOPPED', 'VPS harus stopped sebelum dihapus.');
    if (server.activeJob) throw new AppError(409, 'JOB_ACTIVE', 'Tunggu job server aktif selesai sebelum menghapus VPS.');
    const { client } = await this.sync.upstreamForServer(uuid);
    await client.deleteServer(uuid, input.deleteStorages);
    const remaining = await client.listServers();
    if (remaining.some((row) => row.uuid === uuid)) throw new AppError(502, 'VERIFICATION_FAILED', 'UpCloud masih melaporkan VPS setelah permintaan delete. Jangan ulangi; periksa upstream terlebih dahulu.');
    await this.db.withTransaction(({ data }) => {
      data.servers = data.servers.filter((row) => row.uuid !== uuid);
      for (const key of ['token_server_memberships', 'token_server_groups', 'server_storage', 'server_networks', 'server_metrics', 'client_server_access', 'server_agents'] as const) {
        data[key] = data[key].filter((row: any) => row.server_uuid !== uuid) as any;
      }
    });
    this.sync.publishServer(uuid);
    return { deleted: true, uuid, storagesDeleted: input.deleteStorages };
  }
}
