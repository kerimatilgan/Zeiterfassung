import crypto from 'crypto';
import fs from 'fs';

// Passphrase-Verschlüsselung für Backup-Archive (AES-256-GCM, Key via PBKDF2).
// Datei-Layout des verschlüsselten Archivs:
//   [MAGIC 8 bytes "ZTBKP1\0\0"] [salt 16] [iv 12] [authTag 16] [ciphertext ...]
//
// Anders als utils/encryption.ts (das den festen DOCUMENT_ENCRYPTION_KEY nutzt)
// wird hier der Schlüssel aus einer vom Admin gewählten Passphrase abgeleitet —
// das verschlüsselte Backup ist damit self-contained und kann den Document-Key
// gefahrlos mit einpacken.

const MAGIC = Buffer.from('ZTBKP1\0\0', 'latin1'); // 8 bytes
const SALT_LEN = 16;
const IV_LEN = 12; // GCM-Standard
const TAG_LEN = 16;
const PBKDF2_ITER = 200_000;
const KEY_LEN = 32;

function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return crypto.pbkdf2Sync(passphrase, salt, PBKDF2_ITER, KEY_LEN, 'sha256');
}

/** Verschlüsselt `inputPath` → `outputPath` mit der Passphrase. */
export function encryptArchive(inputPath: string, outputPath: string, passphrase: string): void {
  const salt = crypto.randomBytes(SALT_LEN);
  const iv = crypto.randomBytes(IV_LEN);
  const key = deriveKey(passphrase, salt);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  const plaintext = fs.readFileSync(inputPath);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();

  fs.writeFileSync(outputPath, Buffer.concat([MAGIC, salt, iv, authTag, ciphertext]));
}

/** Erkennt am Magic-Header, ob eine Datei ein passphrase-verschlüsseltes Archiv ist. */
export function isEncryptedArchive(filePath: string): boolean {
  try {
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(MAGIC.length);
    fs.readSync(fd, buf, 0, MAGIC.length, 0);
    fs.closeSync(fd);
    return buf.equals(MAGIC);
  } catch {
    return false;
  }
}

/** Entschlüsselt `inputPath` (verschlüsseltes Archiv) → `outputPath` (Klartext-tar.gz). */
export function decryptArchive(inputPath: string, outputPath: string, passphrase: string): void {
  const data = fs.readFileSync(inputPath);
  if (data.length < MAGIC.length + SALT_LEN + IV_LEN + TAG_LEN) {
    throw new Error('Datei zu klein / kein gültiges verschlüsseltes Backup');
  }
  let off = 0;
  const magic = data.subarray(off, off += MAGIC.length);
  if (!magic.equals(MAGIC)) throw new Error('Kein gültiges verschlüsseltes Zeiterfassung-Backup');
  const salt = data.subarray(off, off += SALT_LEN);
  const iv = data.subarray(off, off += IV_LEN);
  const authTag = data.subarray(off, off += TAG_LEN);
  const ciphertext = data.subarray(off);

  const key = deriveKey(passphrase, salt);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  let plaintext: Buffer;
  try {
    plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    // GCM-Tag-Check fehlgeschlagen → falsche Passphrase (oder beschädigte Datei)
    throw new Error('Falsche Passphrase oder beschädigtes Backup');
  }
  fs.writeFileSync(outputPath, plaintext);
}
