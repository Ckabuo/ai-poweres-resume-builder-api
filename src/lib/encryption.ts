import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;

function getKey(): Buffer | null {
  const key = process.env.ENCRYPTION_KEY;
  if (!key || key.length < 16) return null;

  // If 64-char hex, use as raw key
  if (/^[a-fA-F0-9]{64}$/.test(key)) {
    return Buffer.from(key, 'hex');
  }
  // Otherwise derive from passphrase
  return crypto.scryptSync(key, 'resume-tailor-salt', KEY_LENGTH);
}

export function isEncryptionEnabled(): boolean {
  return getKey() !== null;
}

/**
 * Encrypt plaintext. Returns plaintext if ENCRYPTION_KEY is not set.
 */
export function encrypt(plaintext: string | null | undefined): string {
  if (plaintext == null || plaintext === '') return plaintext ?? '';
  const key = getKey();
  if (!key) return plaintext;

  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return 'enc:' + Buffer.concat([iv, authTag, encrypted]).toString('base64');
}

/**
 * Decrypt ciphertext. Returns as-is if not encrypted or key not set.
 */
export function decrypt(ciphertext: string | null | undefined): string {
  if (ciphertext == null || ciphertext === '') return ciphertext ?? '';
  const key = getKey();
  if (!key || !ciphertext.startsWith('enc:')) return ciphertext;

  try {
    const data = Buffer.from(ciphertext.slice(4), 'base64');
    if (data.length < IV_LENGTH + AUTH_TAG_LENGTH) return ciphertext;

    const iv = data.subarray(0, IV_LENGTH);
    const authTag = data.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
    const encrypted = data.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    return decipher.update(encrypted) + decipher.final('utf8');
  } catch {
    return ciphertext;
  }
}
