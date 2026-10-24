import { describe, expect, it } from 'vitest';
import supertest from 'supertest';
import { createHarness, withCsrf } from './helpers.js';

const onePixelPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
describe('branding assets and in-panel documentation', () => {
  it('updates public branding and validates image contents before serving them', async () => {
    const harness = await createHarness();
    try {
      const initial = await harness.agent.get('/api/branding');
      expect(initial.status).toBe(200);
      const updated = await withCsrf(harness, harness.agent.patch('/api/branding')).send({ siteName: 'Example Cloud', siteTagline: 'Customer VPS', accent: 'blue', defaultTheme: 'dark' });
      expect(updated.status).toBe(200);
      expect((await harness.agent.get('/api/branding')).body.data).toMatchObject({ siteName: 'Example Cloud', accent: 'blue', defaultTheme: 'dark' });
      const upload = await withCsrf(harness, harness.agent.put('/api/branding/assets/logo')).send({ dataUrl: `data:image/png;base64,${onePixelPng}` });
      expect(upload.status).toBe(200);
      const image = await harness.agent.get('/api/branding/assets/logo').buffer(true).parse((res, callback) => { const chunks: Buffer[] = []; res.on('data', (chunk) => chunks.push(chunk)); res.on('end', () => callback(null, Buffer.concat(chunks))); });
      expect(image.status).toBe(200); expect(image.headers['content-type']).toBe('image/png');
      expect(image.body.equals(Buffer.from(onePixelPng, 'base64'))).toBe(true);
      const forged = await withCsrf(harness, harness.agent.put('/api/branding/assets/logo')).send({ dataUrl: 'data:image/png;base64,bm90LWEtcG5nLWZpbGU=' });
      expect(forged.status).toBe(400);
      expect((await withCsrf(harness, harness.agent.delete('/api/branding/assets/logo')).send({})).status).toBe(200);
      expect((await harness.agent.get('/api/branding/assets/logo')).status).toBe(404);
    } finally { await harness.close(); }
  });

  it('accepts a logo up to 3 MiB and rejects larger files without replacing the stored asset', async () => {
    const harness = await createHarness();
    try {
      const bytes = Buffer.alloc(3 * 1024 * 1024);
      Buffer.from(onePixelPng, 'base64').copy(bytes);
      const upload = await withCsrf(harness, harness.agent.put('/api/branding/assets/logo'))
        .send({ dataUrl: `data:image/png;base64,${bytes.toString('base64')}` });
      expect(upload.status).toBe(200);
      expect(upload.body.data.logoUrl).toBe('/api/branding/assets/logo');

      const oversized = await withCsrf(harness, harness.agent.put('/api/branding/assets/logo'))
        .send({ dataUrl: `data:image/png;base64,${Buffer.concat([bytes, Buffer.alloc(1)]).toString('base64')}` });
      expect(oversized.status).toBe(413);
      expect(oversized.body.error).toMatchObject({ code: 'IMAGE_TOO_LARGE' });
      expect(oversized.body.error.message).toContain('3 MB');
      const stored = await harness.services.branding.asset('logo');
      expect(stored?.data).toBe(bytes.toString('base64'));
    } finally { await harness.close(); }
  });

  it('requires authentication for docs and exposes the real deployment contract', async () => {
    const harness = await createHarness();
    try {
      expect((await supertest(harness.app).get('/api/docs')).status).toBe(401);
      const docs = await harness.agent.get('/api/docs'); expect(docs.status).toBe(200);
      expect(docs.body.data.guides.map((row: any) => row.id)).toContain('billing');
      const openApi = await harness.agent.get('/api/docs/openapi.json');
      expect(openApi.status).toBe(200); expect(openApi.body.openapi).toBe('3.1.0');
      expect(openApi.body.paths['/deployments'].post).toBeDefined();
    } finally { await harness.close(); }
  });
});
