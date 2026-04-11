import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

let _cachedKey: Buffer | null = null;

export function getEncryptionKey(): Buffer {
  if (_cachedKey) return _cachedKey;

  // Try loading from .env file directly if not in process.env
  let key = process.env.DOCUMENT_ENCRYPTION_KEY;
  if (!key) {
    try {
      const envPath = path.join(process.cwd(), '.env');
      const envContent = fs.readFileSync(envPath, 'utf8');
      const match = envContent.match(/^DOCUMENT_ENCRYPTION_KEY="?([a-f0-9]{64})"?/m);
      if (match) {
        key = match[1];
        process.env.DOCUMENT_ENCRYPTION_KEY = key;
      }
    } catch {}
  }

  if (!key) {
    throw new Error('DOCUMENT_ENCRYPTION_KEY fehlt in .env! Bitte manuell setzen.');
  }
  _cachedKey = Buffer.from(key, 'hex');
  return _cachedKey;
}

export function encryptFile(inputPath: string, outputPath: string): void {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const input = fs.readFileSync(inputPath);
  const encrypted = Buffer.concat([cipher.update(input), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // Format: [IV (16 bytes)] [Auth Tag (16 bytes)] [Encrypted Data]
  fs.writeFileSync(outputPath, Buffer.concat([iv, authTag, encrypted]));
}

export function encryptBuffer(data: Buffer): Buffer {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return Buffer.concat([iv, authTag, encrypted]);
}

export function decryptFile(filePath: string): Buffer {
  const key = getEncryptionKey();
  const fileData = fs.readFileSync(filePath);

  const iv = fileData.subarray(0, IV_LENGTH);
  const authTag = fileData.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const encrypted = fileData.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}
