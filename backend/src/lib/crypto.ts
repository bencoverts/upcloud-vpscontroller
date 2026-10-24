import { gcm } from '@noble/ciphers/aes.js';
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
}

export function hexToBytes(value: string): Uint8Array {
  if (!/^(?:[a-f0-9]{2})+$/i.test(value)) throw new Error('Invalid hex value.');
  const result = new Uint8Array(value.length / 2);
  for (let index = 0; index < result.length; index += 1) result[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  return result;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

export function randomId(): string {
  return globalThis.crypto.randomUUID();
}

export function decodeEncryptionKey(value: string): Uint8Array {
  const key = /^[a-f0-9]{64}$/i.test(value) ? hexToBytes(value) : base64ToBytes(value);
  if (key.length !== 32) throw new Error('TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes (base64 or 64 hex characters).');
  return key;
}

function aad(tokenId: string): Uint8Array {
  return encoder.encode(`cerdasnet:api-token:${tokenId}:v1`);
}

export class TokenCipher {
  private readonly key: Uint8Array;
  constructor(keyMaterial: string) {
    this.key = decodeEncryptionKey(keyMaterial);
  }

  encrypt(plaintext: string, tokenId: string): { ciphertext: Uint8Array; iv: Uint8Array; authTag: Uint8Array } {
    const iv = randomBytes(12);
    const sealed = gcm(this.key, iv, aad(tokenId)).encrypt(encoder.encode(plaintext));
    return {
      ciphertext: sealed.slice(0, -16), iv,
      authTag: sealed.slice(-16),
    };
  }

  decrypt(input: { ciphertext: Uint8Array; iv: Uint8Array; authTag: Uint8Array }, tokenId: string): string {
    const sealed = new Uint8Array(input.ciphertext.length + input.authTag.length);
    sealed.set(input.ciphertext);
    sealed.set(input.authTag, input.ciphertext.length);
    return decoder.decode(gcm(this.key, input.iv, aad(tokenId)).decrypt(sealed));
  }

  fingerprint(token: string): string {
    return bytesToHex(hmac(sha256, this.key, encoder.encode(`upcloud-token:${token}`)));
  }
}

export function randomToken(bytes = 32): string {
  return bytesToBase64(randomBytes(bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

export function randomHex(bytes = 32): string {
  return bytesToHex(randomBytes(bytes));
}

export function hashOpaqueToken(token: string): string {
  return bytesToHex(sha256(encoder.encode(token)));
}

export function safeHexEqual(left: string, right: string): boolean {
  if (!/^[a-f0-9]+$/i.test(left) || !/^[a-f0-9]+$/i.test(right) || left.length !== right.length) return false;
  const a = hexToBytes(left);
  const b = hexToBytes(right);
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a[index]! ^ b[index]!;
  return difference === 0;
}

export function maskUpCloudToken(token: string): string {
  const suffix = token.slice(-4);
  const prefix = token.startsWith('ucat_') ? 'ucat_' : '';
  return `${prefix}${'•'.repeat(10)}${suffix}`;
}
