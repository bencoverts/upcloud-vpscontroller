import { argon2idAsync } from '@noble/hashes/argon2.js';
import { base64ToBytes, bytesToBase64, randomBytes } from './crypto.js';

const parameters = { m: 19_456, t: 2, p: 1, dkLen: 32, version: 0x13, asyncTick: 10 } as const;
const encodedPattern = /^\$argon2id\$v=(\d+)\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+={0,2})\$([A-Za-z0-9+/]+={0,2})$/;

function decodeBase64(value: string): Uint8Array {
  return base64ToBytes(value + '='.repeat((4 - value.length % 4) % 4));
}

function encoded(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replaceAll('=', '');
}

function equal(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index]! ^ right[index]!;
  return difference === 0;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await argon2idAsync(password, salt, parameters);
  try {
    return `$argon2id$v=19$m=${parameters.m},t=${parameters.t},p=${parameters.p}$${encoded(salt)}$${encoded(derived)}`;
  } finally { derived.fill(0); }
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    const match = encodedPattern.exec(hash);
    if (!match) return false;
    const version = Number(match[1]);
    const m = Number(match[2]);
    const t = Number(match[3]);
    const p = Number(match[4]);
    if (![0x10, 0x13].includes(version) || m < 8 * p || m > 65_536 || t < 1 || t > 10 || p < 1 || p > 4) return false;
    const salt = decodeBase64(match[5]!);
    const expected = decodeBase64(match[6]!);
    if (salt.length < 8 || salt.length > 64 || expected.length < 16 || expected.length > 64) return false;
    const derived = await argon2idAsync(password, salt, { m, t, p, version: version as 16 | 19, dkLen: expected.length, asyncTick: 10 });
    try { return equal(derived, expected); } finally { derived.fill(0); }
  } catch {
    return false;
  }
}

export async function consumeDummyPasswordCheck(password: string): Promise<void> {
  await hashPassword(password);
}
