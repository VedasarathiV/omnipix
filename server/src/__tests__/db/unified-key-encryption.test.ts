import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { encryptUnifiedKeyAtRest, getDb, getUnifiedApiKey, initDb, regenerateUnifiedKey } from '../../db/index.js';

function storedValue(): string {
  return (getDb().prepare("SELECT value FROM settings WHERE key = 'unified_api_key'").get() as { value: string }).value;
}

describe('unified key at-rest encryption (SEC-03)', () => {
  beforeEach(() => {
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    initDb(':memory:');
  });

  afterEach(() => {
    delete process.env.ENCRYPTION_KEY;
  });

  it('stores a sealed triplet, never the plaintext', () => {
    const raw = storedValue();
    expect(raw.startsWith('{')).toBe(true);
    const triplet = JSON.parse(raw) as { encrypted: string; iv: string; authTag: string };
    expect(typeof triplet.encrypted).toBe('string');
    expect(typeof triplet.iv).toBe('string');
    expect(typeof triplet.authTag).toBe('string');
    expect(raw).not.toContain('omnipix-');
    expect(getUnifiedApiKey()).toMatch(/^omnipix-[0-9a-f]{48}$/);
  });

  it('converts legacy plaintext on boot and reads it back', () => {
    getDb().prepare("UPDATE settings SET value = ? WHERE key = 'unified_api_key'").run('omnipix-legacytestkey');
    encryptUnifiedKeyAtRest(getDb());
    expect(storedValue().startsWith('{')).toBe(true);
    expect(getUnifiedApiKey()).toBe('omnipix-legacytestkey');
    // Idempotent: a second pass leaves the sealed value untouched.
    const once = storedValue();
    encryptUnifiedKeyAtRest(getDb());
    expect(storedValue()).toBe(once);
  });

  it('regeneration seals the new key and returns it once', () => {
    const fresh = regenerateUnifiedKey();
    expect(fresh).toMatch(/^omnipix-[0-9a-f]{48}$/);
    expect(storedValue().startsWith('{')).toBe(true);
    expect(getUnifiedApiKey()).toBe(fresh);
  });

  it('seals with fresh randomness per write (no deterministic ciphertext)', () => {
    const first = storedValue();
    const key = getUnifiedApiKey();
    // Re-seal the same key material: IV rotation must change the bytes.
    getDb().prepare("UPDATE settings SET value = ? WHERE key = 'unified_api_key'").run(key);
    encryptUnifiedKeyAtRest(getDb());
    const second = storedValue();
    expect(second.startsWith('{')).toBe(true);
    expect(second).not.toBe(first);
    expect(getUnifiedApiKey()).toBe(key);
  });
});
