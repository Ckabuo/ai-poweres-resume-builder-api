/**
 * Password validation rules:
 * - At least 8 characters
 * - At least one digit
 * - At least one special character
 * - At least one uppercase letter
 * - At least one lowercase letter
 */
const MIN_LENGTH = 8;
const HAS_DIGIT = /\d/;
const HAS_SPECIAL = /[!@#$%^&*()_+\-=\[\]{}|;':",./<>?`~\\]/;
const HAS_UPPERCASE = /[A-Z]/;
const HAS_LOWERCASE = /[a-z]/;

export function validatePassword(password: string): { valid: boolean; error?: string } {
  if (typeof password !== 'string') {
    return { valid: false, error: 'Password is required' };
  }
  if (password.length < MIN_LENGTH) {
    return { valid: false, error: 'Password must be at least 8 characters' };
  }
  if (!HAS_DIGIT.test(password)) {
    return { valid: false, error: 'Password must contain at least one number' };
  }
  if (!HAS_SPECIAL.test(password)) {
    return { valid: false, error: 'Password must contain at least one special character (!@#$%^&* etc.)' };
  }
  if (!HAS_UPPERCASE.test(password)) {
    return { valid: false, error: 'Password must contain at least one uppercase letter' };
  }
  if (!HAS_LOWERCASE.test(password)) {
    return { valid: false, error: 'Password must contain at least one lowercase letter' };
  }
  return { valid: true };
}

export const PASSWORD_REQUIREMENTS =
  'At least 8 characters, one number, one special character, and uppercase & lowercase letters';
