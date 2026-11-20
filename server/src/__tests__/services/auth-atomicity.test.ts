import { beforeEach, describe, expect, it } from 'vitest';
import { getDb, initDb } from '../../db/index.js';
import {
  createSession,
  createUser,
  updateEmail,
  updatePassword,
  validateSession,
} from '../../services/auth.js';

// Auth writes must fail with typed errors, never raw SQLite constraint
// violations, and multi-statement writes must commit atomically.
describe('auth write atomicity', () => {
  beforeEach(() => {
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    initDb(':memory:');
  });

  it('maps duplicate-email races to email_taken, not SQLITE errors', () => {
    createUser('a@test.com', 'password-one');
    try {
      createUser('a@test.com', 'password-two');
      expect.unreachable('duplicate create must throw');
    } catch (err: any) {
      expect(err.code).toBe('email_taken');
      expect(String(err.code)).not.toContain('SQLITE');
    }
    // Case-insensitive: the normalized form collides too.
    try {
      createUser('A@test.com', 'password-three');
      expect.unreachable('case-variant duplicate must throw');
    } catch (err: any) {
      expect(err.code).toBe('email_taken');
    }
  });

  it('updateEmail conflicts are typed and leave the row untouched', () => {
    const u1 = createUser('one@test.com', 'password-one');
    createUser('two@test.com', 'password-two');
    try {
      updateEmail(u1.userId, 'password-one', 'two@test.com');
      expect.unreachable('conflicting update must throw');
    } catch (err: any) {
      expect(err.code).toBe('email_taken');
    }
    const row = getDb().prepare('SELECT email FROM users WHERE id = ?').get(u1.userId) as { email: string };
    expect(row.email).toBe('one@test.com');
  });

  it('updatePassword changes the secret and kills sessions atomically', () => {
    const u = createUser('pw@test.com', 'password-one');
    const token = createSession(u.userId);
    expect(validateSession(token)).toBeTruthy();
    expect(updatePassword(u.userId, 'password-one', 'password-two')).toBe(true);
    // Old sessions are dead...
    expect(validateSession(token)).toBeFalsy();
    // ...and the new password verifies (implicitly: wrong old password now fails).
    expect(updatePassword(u.userId, 'password-one', 'password-three')).toBe(false);
    expect(updatePassword(u.userId, 'password-two', 'password-three')).toBe(true);
  });
});
