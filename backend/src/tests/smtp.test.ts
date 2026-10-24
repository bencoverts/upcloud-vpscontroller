import { describe, expect, it, vi } from 'vitest';
import { createHarness, withCsrf } from './helpers.js';

const mocks = vi.hoisted(() => ({ verify: vi.fn(), sendMail: vi.fn(), close: vi.fn(), createTransport: vi.fn() }));
vi.mock('nodemailer', () => ({ default: { createTransport: mocks.createTransport } }));

describe('SMTP integration', () => {
  it('verifies and sends through configured SMTP without exposing the password', async () => {
    mocks.verify.mockResolvedValue(true); mocks.close.mockReturnValue(undefined);
    mocks.sendMail.mockResolvedValue({ messageId: '<unit@smtp.example>' });
    mocks.createTransport.mockReturnValue({ verify: mocks.verify, sendMail: mocks.sendMail, close: mocks.close });
    const harness = await createHarness({ smtpHost: 'smtp.example.com', smtpPort: 587, smtpSecure: false, smtpUsername: 'panel@example.com', smtpPassword: 'smtp-secret-never-return', smtpFrom: 'Panel <panel@example.com>' });
    try {
      const status = await harness.agent.get('/api/integrations/smtp');
      expect(status.status).toBe(200); expect(status.body.data.configured).toBe(true);
      expect(JSON.stringify(status.body)).not.toContain('smtp-secret-never-return');
      const response = await withCsrf(harness, harness.agent.post('/api/integrations/smtp/test')).send({ recipient: 'admin@example.net' });
      expect(response.status).toBe(200); expect(response.body.data.accepted).toBe(true);
      expect(mocks.createTransport).toHaveBeenCalledWith(expect.objectContaining({ host: 'smtp.example.com', port: 587, disableFileAccess: true, disableUrlAccess: true, auth: { user: 'panel@example.com', pass: 'smtp-secret-never-return' } }));
      expect(mocks.verify).toHaveBeenCalledOnce();
      expect(mocks.sendMail).toHaveBeenCalledWith(expect.objectContaining({ from: 'Panel <panel@example.com>', to: 'admin@example.net' }));
      expect(mocks.close).toHaveBeenCalledOnce();
    } finally { await harness.close(); }
  });

  it('does not claim success when unconfigured or upstream rejects delivery', async () => {
    const unconfigured = await createHarness();
    try { expect((await withCsrf(unconfigured, unconfigured.agent.post('/api/integrations/smtp/test')).send({ recipient: 'admin@example.net' })).status).toBe(409); }
    finally { await unconfigured.close(); }
    mocks.verify.mockResolvedValue(true); mocks.sendMail.mockRejectedValue(new Error('550 mailbox rejected')); mocks.close.mockReturnValue(undefined);
    mocks.createTransport.mockReturnValue({ verify: mocks.verify, sendMail: mocks.sendMail, close: mocks.close });
    const harness = await createHarness({ smtpHost: 'smtp.example.com', smtpFrom: 'panel@example.com' });
    try {
      const response = await withCsrf(harness, harness.agent.post('/api/integrations/smtp/test')).send({ recipient: 'admin@example.net' });
      expect(response.status).toBe(502); expect(response.body.error.code).toBe('SMTP_FAILED');
    } finally { await harness.close(); }
  });
});
