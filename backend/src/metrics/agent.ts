import type { Database } from '../db/index.js';
import { AppError } from '../lib/errors.js';
import { hashOpaqueToken, randomToken, safeHexEqual } from '../lib/crypto.js';
import type { MetricsService, AgentMetricInput } from './service.js';

export class AgentService {
  constructor(private readonly db: Database, private readonly metrics: MetricsService) {}

  async rotate(serverUuid: string, label = 'Linux guest agent') {
    const token = `cna_${randomToken(32)}`;
    const tokenHash = hashOpaqueToken(token);
    await this.db.withTransaction(({ data }) => {
      if (!data.servers.some((row) => row.uuid === serverUuid)
        || !data.token_server_memberships.some((row) => row.server_uuid === serverUuid && row.active)) {
        throw new AppError(404, 'NOT_FOUND', 'Server tidak ditemukan.');
      }
      const current = data.server_agents.find((row) => row.server_uuid === serverUuid);
      if (current) Object.assign(current, { token_hash: tokenHash, label, revoked: false });
      else data.server_agents.push({
        server_uuid: serverUuid, token_hash: tokenHash, label, revoked: false,
        created_at: new Date().toISOString(), last_seen_at: null,
      });
    });
    return { token, note: 'Token hanya ditampilkan sekali. Rotasi ini menggantikan token agent sebelumnya.' };
  }

  async status(serverUuid: string) {
    return this.db.read((data) => {
      const agent = data.server_agents.find((row) => row.server_uuid === serverUuid && !row.revoked);
      return { configured: Boolean(agent), label: agent?.label ?? null, lastSeenAt: agent?.last_seen_at ?? null };
    });
  }

  async ingest(serverUuid: string, token: string, input: AgentMetricInput) {
    if (token.length > 200) throw new AppError(401, 'AGENT_UNAUTHORIZED', 'Agent token tidak valid.');
    const tokenHash = hashOpaqueToken(token);
    const authorized = await this.db.read((data) => {
      const agent = data.server_agents.find((row) => row.server_uuid === serverUuid && !row.revoked);
      return Boolean(agent && safeHexEqual(agent.token_hash, tokenHash)
        && data.token_server_memberships.some((row) => row.server_uuid === serverUuid && row.active));
    });
    if (!authorized) throw new AppError(401, 'AGENT_UNAUTHORIZED', 'Agent token tidak valid atau sudah diganti.');
    return this.metrics.ingestAgent(serverUuid, input);
  }
}
