import crypto from 'node:crypto';
import { config } from './config.js';

const ALGO = 'aes-256-gcm';

function key() {
  return crypto.createHash('sha256').update(config.appSecret).digest();
}

export function encryptSecret(plain) {
  if (plain == null || plain === '') return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key(), iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
}

export function decryptSecret(ciphertext) {
  if (!ciphertext) return '';
  try {
    const [v, ivB64, tagB64, dataB64] = String(ciphertext).split(':');
    if (v !== 'v1') return '';
    const decipher = crypto.createDecipheriv(ALGO, key(), Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return '';
  }
}
