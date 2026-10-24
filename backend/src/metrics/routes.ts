import { Router } from 'express';
import { z } from 'zod';
import { AppError } from '../lib/errors.js';
import type { AgentService } from './agent.js';

const byteCount = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const nullableByteCount = byteCount.nullable();
const metricSchema = z.object({
  serverUuid: z.string().uuid(),
  filesystemUsedBytes: byteCount, filesystemTotalBytes: byteCount,
  filesystemCount: z.number().int().min(1).max(1024),
  memoryUsedBytes: nullableByteCount, memoryTotalBytes: nullableByteCount,
  swapUsedBytes: nullableByteCount, swapTotalBytes: nullableByteCount,
  osUptimeSeconds: z.number().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable(),
  load1: z.number().nonnegative().max(1_000_000).nullable().optional(), load5: z.number().nonnegative().max(1_000_000).nullable().optional(),
  load15: z.number().nonnegative().max(1_000_000).nullable().optional(), processCount: z.number().int().min(1).max(10_000_000).nullable().optional(),
  filesystems: z.array(z.object({ source: z.string().max(255), mount: z.string().max(1024), totalBytes: byteCount, usedBytes: byteCount })).max(64).optional(),
  osName: z.string().max(200).nullable().optional(), agentVersion: z.string().max(20).optional(),
}).superRefine((value, context) => {
  for (const [used, total, name] of [
    [value.filesystemUsedBytes, value.filesystemTotalBytes, 'filesystem'],
    [value.memoryUsedBytes, value.memoryTotalBytes, 'memory'],
    [value.swapUsedBytes, value.swapTotalBytes, 'swap'],
  ] as const) {
    if (used !== null && total !== null && used > total) context.addIssue({ code: 'custom', message: `${name} used tidak boleh melebihi total.` });
  }
});

export function agentRoutes(agents: AgentService): Router {
  const router = Router();
  router.post('/v1/metrics', async (req, res, next) => {
    try {
      const authorization = req.get('authorization');
      if (!authorization?.startsWith('Bearer ')) throw new AppError(401, 'AGENT_UNAUTHORIZED', 'Bearer agent token diperlukan.');
      const input = metricSchema.parse(req.body);
      const sample = await agents.ingest(input.serverUuid, authorization.slice(7), input);
      res.status(202).json({ data: { accepted: true, sampledAt: sample.sampledAt } });
    } catch (error) { next(error); }
  });
  return router;
}
