import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createHarness } from './helpers.js';

describe('production same-origin frontend hosting', () => {
  it('serves immutable assets and SPA fallback without swallowing API 404s', async () => {
    const frontendDist = await mkdtemp(path.join(tmpdir(), 'cerdasnet-static-'));
    await mkdir(path.join(frontendDist, 'assets'));
    await writeFile(path.join(frontendDist, 'index.html'), '<!doctype html><html><body>CerdasNet test shell</body></html>');
    await writeFile(path.join(frontendDist, 'assets', 'app.js'), 'console.log("safe-test");');
    const harness = await createHarness({ frontendDist });
    try {
      const fallback = await harness.agent.get('/servers/some/client/route').set('Accept', 'text/html');
      expect(fallback.status).toBe(200);
      expect(fallback.text).toContain('CerdasNet test shell');
      expect(fallback.headers['cache-control']).toBe('no-cache');
      const asset = await harness.agent.get('/assets/app.js');
      expect(asset.status).toBe(200);
      expect(asset.headers['cache-control']).toContain('immutable');
      const apiMissing = await harness.agent.get('/api/not-a-route').set('Accept', 'text/html');
      expect(apiMissing.status).toBe(404);
      expect(apiMissing.body.error).toBeDefined();
    } finally {
      await harness.close();
      await rm(frontendDist, { recursive: true, force: true });
    }
  });
});
