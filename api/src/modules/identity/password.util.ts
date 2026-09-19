import * as argon2 from 'argon2';
import { UnprocessableEntityException } from '@nestjs/common';

/**
 * Password rule, defined once and enforced at both the API layer (DTO)
 * and here in the business-rules layer, per section 10's defence-in-depth
 * design: minimum 8 characters, at least one letter and one digit.
 * (Kept deliberately simple for Milestone 1; a configurable, stronger
 * policy per BR-SEC-* is a candidate for a later phase.)
 */
export function assertPasswordStrength(password: string): void {
  if (password.length < 8) {
    throw new UnprocessableEntityException('Password must be at least 8 characters.');
  }
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
    throw new UnprocessableEntityException('Password must contain both letters and digits.');
  }
}

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password);
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  return argon2.verify(hash, password);
}
