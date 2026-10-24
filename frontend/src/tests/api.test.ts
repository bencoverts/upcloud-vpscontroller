import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, setApiCsrf, setUnauthorizedHandler } from '../api';

const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
afterEach(() => { setApiCsrf(null); setUnauthorizedHandler(null); });

describe('same-origin API client', () => {
  it('unwraps API envelopes and supports direct health responses', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ data: { totalServers: 2 } }))
      .mockResolvedValueOnce(response({ status: 'ready', database: 'ok' }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(api.get('/api/dashboard')).resolves.toEqual({ totalServers: 2 });
    await expect(api.get('/health/ready')).resolves.toEqual({ status: 'ready', database: 'ok' });
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/dashboard', expect.objectContaining({ credentials: 'same-origin' }));
  });

  it('sends CSRF only on mutations and preserves safe API errors', async () => {
    setApiCsrf('csrf-test-value');
    const fetchMock = vi.fn().mockResolvedValue(response({ error: { code: 'CONFLICT', message: 'Job aktif.' } }, 409));
    vi.stubGlobal('fetch', fetchMock);
    const request = api.post('/api/sync/all', {});
    await expect(request).rejects.toMatchObject({ code: 'CONFLICT', status: 409, message: 'Job aktif.' });
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({ 'x-csrf-token': 'csrf-test-value', 'Content-Type': 'application/json' });
  });
});
