import nodemailer from 'nodemailer';
import { z } from 'zod';
import type { AppConfig } from '../config.js';
import { AppError, sanitizeUpstreamMessage } from '../lib/errors.js';

export class SmtpService {
  constructor(private readonly config: AppConfig) {}
  status() {
    return {
      configured: Boolean(this.config.smtpHost && this.config.smtpFrom),
      host: this.config.smtpHost ? `${this.config.smtpHost}:${this.config.smtpPort}` : null,
      from: this.config.smtpFrom ?? null, secure: this.config.smtpSecure,
      note: 'SMTP password hanya dibaca dari environment dan tidak pernah disimpan/dikembalikan API.',
    };
  }
  async sendTest(recipient: string, siteName: string) {
    if (!this.config.smtpHost || !this.config.smtpFrom) throw new AppError(409, 'SMTP_NOT_CONFIGURED', 'Lengkapi SMTP_HOST dan SMTP_FROM pada environment Node.js.');
    const email = z.string().email().max(320).parse(recipient);
    const transport = nodemailer.createTransport({
      host: this.config.smtpHost, port: this.config.smtpPort, secure: this.config.smtpSecure,
      auth: this.config.smtpUsername ? { user: this.config.smtpUsername, pass: this.config.smtpPassword ?? '' } : undefined,
      connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 15_000,
      disableFileAccess: true, disableUrlAccess: true,
    });
    try {
      await transport.verify();
      const result = await transport.sendMail({
        from: this.config.smtpFrom, to: email, subject: `[${siteName}] SMTP test`,
        text: `SMTP untuk ${siteName} berhasil dikonfigurasi. Email ini dikirim dari pengaturan admin panel.`,
      });
      return { accepted: true, messageId: result.messageId ?? null, recipient: email };
    } catch (error) {
      throw new AppError(502, 'SMTP_FAILED', sanitizeUpstreamMessage(error instanceof Error ? error.message : 'SMTP gagal.'));
    } finally { transport.close(); }
  }
}
