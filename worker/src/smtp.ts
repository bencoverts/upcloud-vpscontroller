import { connect } from 'cloudflare:sockets';
import type { AppConfig } from '../../backend/src/config.js';
import { AppError, sanitizeUpstreamMessage } from '../../backend/src/lib/errors.js';
import { bytesToBase64, randomId } from '../../backend/src/lib/crypto.js';
import { z } from 'zod';

const timeout = async <T>(operation: Promise<T>, milliseconds = 15_000): Promise<T> => {
  let timer: ReturnType<typeof setTimeout>;
  try { return await Promise.race([operation, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('SMTP timeout')), milliseconds); })]); }
  finally { clearTimeout(timer!); }
};
const encode = (value: string) => bytesToBase64(new TextEncoder().encode(value));
function mailbox(value: string): string {
  if (value.length > 320 || /[\r\n]/.test(value)) throw new AppError(400, 'SMTP_FROM_INVALID', 'Alamat SMTP_FROM tidak valid.');
  const address = value.includes('<') ? value.match(/<([^<>]+)>/)?.[1] : value;
  return z.string().email().parse(address?.trim());
}
class SmtpConnection {
  private reader: ReadableStreamDefaultReader<Uint8Array>;
  private writer: WritableStreamDefaultWriter<Uint8Array>;
  private buffer = '';
  constructor(private socket: Socket) {
    this.reader = socket.readable.getReader(); this.writer = socket.writable.getWriter();
  }
  private reset() {
    this.reader.releaseLock(); this.writer.releaseLock(); this.buffer = '';
    this.reader = this.socket.readable.getReader(); this.writer = this.socket.writable.getWriter();
  }
  async startTls(hostname: string) {
    this.socket = this.socket.startTls({ expectedServerHostname: hostname });
    await timeout(this.socket.opened); this.reset();
  }
  async read(expected: number[]): Promise<string[]> {
    const lines: string[] = []; let code = 0;
    while (true) {
      let index = this.buffer.indexOf('\r\n');
      while (index < 0) {
        if (this.buffer.length > 65_536) throw new Error('SMTP response too large');
        const { done, value } = await timeout(this.reader.read());
        if (done) throw new Error('SMTP connection closed unexpectedly');
        this.buffer += new TextDecoder().decode(value, { stream: true }); index = this.buffer.indexOf('\r\n');
      }
      const line = this.buffer.slice(0, index); this.buffer = this.buffer.slice(index + 2);
      const match = line.match(/^(\d{3})([ -])(.*)$/);
      if (!match) throw new Error('SMTP response malformed');
      code = Number(match[1]); lines.push(line);
      if (match[2] === ' ') {
        if (!expected.includes(code)) throw new Error(`SMTP ${code}: ${match[3]}`.slice(0, 300));
        return lines;
      }
    }
  }
  async command(command: string, expected: number[]): Promise<string[]> {
    await timeout(this.writer.write(new TextEncoder().encode(`${command}\r\n`)));
    return this.read(expected);
  }
  async writeRaw(value: string, expected: number[]): Promise<string[]> {
    await timeout(this.writer.write(new TextEncoder().encode(value)));
    return this.read(expected);
  }
  async close() { try { this.reader.releaseLock(); } catch { /* Lock already released by the runtime. */ } try { this.writer.releaseLock(); } catch { /* Lock already released by the runtime. */ } await this.socket.close().catch(() => undefined); }
}

export class WorkerSmtpService {
  constructor(private readonly config: AppConfig) {}
  status() {
    return { configured: Boolean(this.config.smtpHost && this.config.smtpFrom), host: this.config.smtpHost ? `${this.config.smtpHost}:${this.config.smtpPort}` : null,
      from: this.config.smtpFrom ?? null, secure: this.config.smtpSecure, note: 'Worker memakai TCP cloudflare:sockets dengan TLS; dukungan outbound/port bergantung pada platform.' };
  }
  async sendTest(recipient: string, siteName: string) {
    if (!this.config.smtpHost || !this.config.smtpFrom) throw new AppError(409, 'SMTP_NOT_CONFIGURED', 'Lengkapi SMTP_HOST dan SMTP_FROM pada Worker secrets/variables.');
    if (this.config.smtpPort === 25) throw new AppError(400, 'SMTP_PORT_PROHIBITED', 'Cloudflare Workers melarang outbound TCP port 25. Gunakan submission port 465 atau 587 yang diotorisasi provider.');
    const to = z.string().email().max(320).parse(recipient); const from = mailbox(this.config.smtpFrom);
    let connection: SmtpConnection | undefined;
    try {
      const socket = connect({ hostname: this.config.smtpHost, port: this.config.smtpPort }, { secureTransport: this.config.smtpSecure ? 'on' : 'off', allowHalfOpen: false });
      connection = new SmtpConnection(socket); await timeout(socket.opened); await connection.read([220]);
      let extensions = await connection.command(`EHLO panel-${randomId()}.local`, [250]);
      if (!this.config.smtpSecure) {
        if (!extensions.some((line) => line.toUpperCase().includes('STARTTLS'))) throw new Error('SMTP server does not advertise STARTTLS');
        await connection.command('STARTTLS', [220]); await connection.startTls(this.config.smtpHost);
        extensions = await connection.command(`EHLO panel-${randomId()}.local`, [250]);
      }
      if (this.config.smtpUsername) {
        const authLine = extensions.find((line) => /AUTH[ =]/i.test(line))?.toUpperCase() ?? '';
        if (authLine.includes('PLAIN')) await connection.command(`AUTH PLAIN ${encode(`\0${this.config.smtpUsername}\0${this.config.smtpPassword ?? ''}`)}`, [235]);
        else if (authLine.includes('LOGIN')) {
          await connection.command('AUTH LOGIN', [334]); await connection.command(encode(this.config.smtpUsername), [334]);
          await connection.command(encode(this.config.smtpPassword ?? ''), [235]);
        } else throw new Error('SMTP server does not advertise AUTH PLAIN or LOGIN');
      }
      await connection.command(`MAIL FROM:<${from}>`, [250]); await connection.command(`RCPT TO:<${to}>`, [250, 251]);
      await connection.command('DATA', [354]);
      const messageId = `<${randomId()}@panel.local>`;
      const safeSite = siteName.replace(/[\r\n]+/g, ' ').slice(0, 120);
      const message = [`From: <${from}>`, `To: <${to}>`, `Subject: [${safeSite}] SMTP test`, `Date: ${new Date().toUTCString()}`, `Message-ID: ${messageId}`, 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: 8bit', '', `SMTP untuk ${safeSite} berhasil dikonfigurasi.`, 'Email ini dikirim dari pengaturan admin panel.', '']
        .join('\r\n').split('\r\n').map((line) => line.startsWith('.') ? `.${line}` : line).join('\r\n');
      await connection.writeRaw(`${message}\r\n.\r\n`, [250]); await connection.command('QUIT', [221]).catch(() => undefined);
      return { accepted: true, messageId, recipient: to };
    } catch (error) {
      throw new AppError(502, 'SMTP_FAILED', sanitizeUpstreamMessage(error instanceof Error ? error.message : 'SMTP gagal.', [this.config.smtpPassword ?? '']));
    } finally { await connection?.close(); }
  }
}
