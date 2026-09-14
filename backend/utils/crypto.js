const crypto = require('crypto');
const ALGO = 'aes-256-gcm';
const LEGACY_DEV_SECRET = 'dev-secret-do-not-use-in-prod-0123456789abcdef';

const deriveKey = (secret) => crypto.createHash('sha256').update(secret).digest();

function getSecret() {
  const secret = process.env.AGENT_KEY_ENC_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('AGENT_KEY_ENC_SECRET must be set in production');
    }
    // Dev fallback: stable dev secret. Hash it to a 32-byte key like the prod path.
    return deriveKey(LEGACY_DEV_SECRET);
  }
  // Derive a 32-byte key from the secret
  return deriveKey(secret);
}

function encrypt(plaintext) {
  if (plaintext == null) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, getSecret(), iv);
  const enc = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
}

function decryptWithKey(ciphertext, key) {
  const [ivB64, tagB64, encB64] = String(ciphertext).split(':');
  if (!ivB64 || !tagB64 || !encB64) throw new Error('Invalid ciphertext format');
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const enc = Buffer.from(encB64, 'base64');
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}

function decrypt(ciphertext) {
  if (!ciphertext) return null;
  try {
    return decryptWithKey(ciphertext, getSecret());
  } catch (error) {
    // Older development installs encrypted BYOK values before start-project.ps1
    // began generating a local secret. Keep those installs readable, but never
    // allow the well-known fallback in production.
    if (process.env.NODE_ENV !== 'production' && process.env.AGENT_KEY_ENC_SECRET) {
      try {
        return decryptWithKey(ciphertext, deriveKey(LEGACY_DEV_SECRET));
      } catch (_) {
        // Preserve the primary failure; callers must treat unreadable keys as unavailable.
      }
    }
    throw error;
  }
}

module.exports = { encrypt, decrypt };
