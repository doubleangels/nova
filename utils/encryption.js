const crypto = require('crypto');

/**
 * AES-256-GCM encryption utility for securing sensitive data at rest.
 * Uses a unique IV for every encryption and includes an authentication tag for integrity.
 */

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;

/**
 * Derives a 32-byte key from a secret string.
 * @param {string} secret 
 * @returns {Buffer}
 */
function deriveKey(secret) {
  if (!secret) throw new Error('Encryption secret is required.');
  return crypto.createHash('sha256').update(secret).digest();
}

/**
 * Encrypts a string or object.
 * @param {string|Object} data - Data to encrypt
 * @param {string} secret - Secret key for encryption
 * @returns {string} Encrypted string in format: iv:authTag:content
 */
function encrypt(data, secret) {
  const key = deriveKey(secret);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  
  const strData = typeof data === 'string' ? data : JSON.stringify(data);
  let encrypted = cipher.update(strData, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  const authTag = cipher.getAuthTag().toString('hex');
  
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

/**
 * Decrypts data.
 * @param {string} encryptedData - Format: iv:authTag:content
 * @param {string} secret - Secret key for decryption
 * @returns {string|Object} Decrypted data
 */
function decrypt(encryptedData, secret) {
  const key = deriveKey(secret);
  if (typeof encryptedData !== 'string') {
    throw new Error('Encrypted data must be a string.');
  }

  const parts = encryptedData.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted data format: expected three colon-separated parts.');
  }

  const [ivHex, authTagHex, contentHex] = parts;
  
  // Verify hex format to avoid partial/garbage parsing
  const hexRegex = /^[0-9a-f]+$/i;
  if (!hexRegex.test(ivHex) || !hexRegex.test(authTagHex) || !hexRegex.test(contentHex)) {
    throw new Error('Invalid encrypted data: components must be hex-encoded.');
  }

  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');

  if (iv.length !== IV_LENGTH) {
    throw new Error(`Invalid initialization vector length (expected ${IV_LENGTH}, got ${iv.length}).`);
  }
  if (authTag.length !== AUTH_TAG_LENGTH) {
    throw new Error(`Invalid auth tag length (expected ${AUTH_TAG_LENGTH}, got ${authTag.length}).`);
  }

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  
  let decrypted = decipher.update(contentHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  
  try {
    return JSON.parse(decrypted);
  } catch {
    return decrypted;
  }
}

module.exports = {
  encrypt,
  decrypt
};
