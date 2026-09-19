import { assertPasswordStrength, hashPassword, verifyPassword } from '../../src/modules/identity/password.util';

describe('assertPasswordStrength', () => {
  it('rejects passwords shorter than 8 characters', () => {
    expect(() => assertPasswordStrength('a1234')).toThrow('at least 8 characters');
  });

  it('rejects passwords with no letters', () => {
    expect(() => assertPasswordStrength('12345678')).toThrow('letters and digits');
  });

  it('rejects passwords with no digits', () => {
    expect(() => assertPasswordStrength('abcdefgh')).toThrow('letters and digits');
  });

  it('accepts a password with at least 8 characters, a letter and a digit', () => {
    expect(() => assertPasswordStrength('abc12345')).not.toThrow();
  });
});

describe('hashPassword / verifyPassword', () => {
  it('produces a hash that verifies against the original password', async () => {
    const hash = await hashPassword('correct-horse-1');
    await expect(verifyPassword(hash, 'correct-horse-1')).resolves.toBe(true);
  });

  it('rejects the wrong password against a hash', async () => {
    const hash = await hashPassword('correct-horse-1');
    await expect(verifyPassword(hash, 'wrong-password-1')).resolves.toBe(false);
  });

  it('never stores the password itself in the hash output', async () => {
    const hash = await hashPassword('correct-horse-1');
    expect(hash).not.toContain('correct-horse-1');
  });
});
