import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export function decodeEncryptionKey(value: string): Buffer {
  let key: Buffer;
  if (/^[a-f0-9]{64}$/i.test(value)) key = Buffer.from(value, 'hex');
  else key = Buffer.from(value, 'base64');
  if (key.length !== 32) throw new Error('TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes (base64 or 64 hex characters).');
  return key;
}

export class TokenCipher {
  private readonly key: Buffer;
  constructor(keyMaterial: string) {
    this.key = decodeEncryptionKey(keyMaterial);
  }

  encrypt(plaintext: string, tokenId: string): { ciphertext: Buffer; iv: Buffer; authTag: Buffer } {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(`cerdasnet:api-token:${tokenId}:v1`));
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return { ciphertext, iv, authTag: cipher.getAuthTag() };
  }

  decrypt(input: { ciphertext: Buffer; iv: Buffer; authTag: Buffer }, tokenId: string): string {
    const decipher = createDecipheriv('aes-256-gcm', this.key, input.iv);
    decipher.setAAD(Buffer.from(`cerdasnet:api-token:${tokenId}:v1`));
    decipher.setAuthTag(input.authTag);
    return Buffer.concat([decipher.update(input.ciphertext), decipher.final()]).toString('utf8');
  }

  fingerprint(token: string): string {
    return createHmac('sha256', this.key).update(`upcloud-token:${token}`).digest('hex');
  }
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function randomHex(bytes = 32): string {
  return randomBytes(bytes).toString('hex');
}

export function hashOpaqueToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function safeHexEqual(left: string, right: string): boolean {
  if (!/^[a-f0-9]+$/i.test(left) || !/^[a-f0-9]+$/i.test(right)) return false;
  const a = Buffer.from(left, 'hex');
  const b = Buffer.from(right, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

export function maskUpCloudToken(token: string): string {
  const suffix = token.slice(-4);
  const prefix = token.startsWith('ucat_') ? 'ucat_' : '';
  return `${prefix}${'•'.repeat(10)}${suffix}`;
}
