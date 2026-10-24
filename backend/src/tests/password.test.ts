import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../lib/password.js';

const legacyHash = '$argon2id$v=19$m=19456,t=2,p=1$AAECAwQFBgcICQoLDA0ODw$k9AXHc+/IWygRUvWK4NvV9lhQJ4fjkScSK3Tczw7GmQ';

describe('portable Argon2id password hashing', () => {
  it('verifies existing encoded hashes without a runtime WebAssembly compiler', async () => {
    expect(await verifyPassword(legacyHash, 'TestPassword123!')).toBe(true);
    expect(await verifyPassword(legacyHash, 'incorrect-password')).toBe(false);
  });

  it('creates unique hashes and rejects malformed or excessive parameters', async () => {
    const first = await hashPassword('AnotherStrongPassword123');
    const second = await hashPassword('AnotherStrongPassword123');
    expect(first).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(first).not.toBe(second);
    expect(await verifyPassword(first, 'AnotherStrongPassword123')).toBe(true);
    expect(await verifyPassword(second, 'AnotherStrongPassword123')).toBe(true);
    expect(await verifyPassword('not-a-password-hash', 'AnotherStrongPassword123')).toBe(false);
    expect(await verifyPassword(first.replace('m=19456', 'm=999999999'), 'AnotherStrongPassword123')).toBe(false);
  });
});
