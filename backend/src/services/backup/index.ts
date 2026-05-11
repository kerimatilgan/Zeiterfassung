import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import * as tar from 'tar';
import { PrismaClient } from '@prisma/client';
import { BackupProvider } from './providers/BaseProvider.js';
import { LocalProvider } from './providers/LocalProvider.js';
import { SftpProvider } from './providers/SftpProvider.js';
import { S3Provider } from './providers/S3Provider.js';
import { WebDavProvider } from './providers/WebDavProvider.js';
import { SmbProvider } from './providers/SmbProvider.js';
import { NfsProvider } from './providers/NfsProvider.js';
import { DropboxProvider } from './providers/DropboxProvider.js';
import { GDriveProvider } from './providers/GDriveProvider.js';
import { OneDriveProvider } from './providers/OneDriveProvider.js';
import { encryptConfig, decryptConfig } from './configEncryption.js';
import { encryptArchive, decryptArchive, isEncryptedArchive } from './archiveCrypto.js';

const prisma = new PrismaClient();

const BACKUP_DIR = '/opt/Zeiterfassung/backups';
const DB_PATH = path.resolve(process.cwd(), 'prisma/zeiterfassung.db');
const UPLOADS_DIR = path.resolve(process.cwd(), 'uploads');
const REPORTS_DIR = path.resolve(process.cwd(), 'reports');
const ENV_PATH = path.resolve(process.cwd(), '.env');

// Liest den DOCUMENT_ENCRYPTION_KEY aus der .env — wird (nur) in passphrase-
// verschlüsselte Backups als secrets.json mit eingepackt, damit das Backup
// self-contained ist. Klartext-Backups enthalten ihn NICHT.
function readDocumentEncryptionKey(): string | null {
  try {
    if (process.env.DOCUMENT_ENCRYPTION_KEY) return process.env.DOCUMENT_ENCRYPTION_KEY;
    const envContent = fs.readFileSync(ENV_PATH, 'utf8');
    const m = envContent.match(/^DOCUMENT_ENCRYPTION_KEY="?([a-f0-9]{64})"?/m);
    return m ? m[1] : null;
  } catch { return null; }
}

// Optionale Passphrase für geplante (automatische) Backups — aus .env.
// Wenn gesetzt, werden Scheduled-Backups verschlüsselt + enthalten den
// Document-Key. Wenn nicht gesetzt: Klartext-tar.gz (mit reports/ + uploads/).
function getScheduledBackupPassphrase(): string | null {
  const p = process.env.BACKUP_PASSPHRASE;
  return p && p.trim().length >= 8 ? p.trim() : null;
}

// Retention wird aus Settings geladen
async function getRetentionDays(): Promise<number> {
  try {
    const settings = await prisma.settings.findUnique({ where: { id: 'default' } });
    return (settings as any)?.backupRetentionDays || 30;
  } catch { return 30; }
}

const providers: Record<string, BackupProvider> = {
  local: new LocalProvider(),
  sftp: new SftpProvider(),
  s3: new S3Provider(),
  webdav: new WebDavProvider(),
  smb: new SmbProvider(),
  nfs: new NfsProvider(),
  dropbox: new DropboxProvider(),
  gdrive: new GDriveProvider(),
  onedrive: new OneDriveProvider(),
};

let isRunning = false;

export function getProvider(type: string): BackupProvider | undefined {
  return providers[type];
}

export { encryptConfig, decryptConfig };

function formatDate(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/**
 * Erstellt ein vollständiges Backup-Archiv:
 *   stage/
 *     zeiterfassung.db        (konsistente Kopie via VACUUM INTO)
 *     uploads/                (MA-Fotos, hochgeladene Dokumente, Logos)
 *     reports/                (finalisierte Abrechnungs-PDFs)
 *     secrets.json            (nur wenn passphrase gesetzt: DOCUMENT_ENCRYPTION_KEY)
 *
 * Ohne Passphrase: gzip-tar in `zeiterfassung_<ts>.tar.gz`.
 * Mit Passphrase:  zusätzlich AES-256-GCM-verschlüsselt → `zeiterfassung_<ts>.tar.gz.enc`,
 *                  und secrets.json wird mit eingepackt (Backup ist dann self-contained).
 */
export async function createArchive(passphrase?: string | null): Promise<{ filePath: string; filename: string; fileSize: number }> {
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

  const timestamp = formatDate(new Date());
  const stageDir = path.join(BACKUP_DIR, `_stage_${timestamp}`);
  const tarPath = path.join(BACKUP_DIR, `zeiterfassung_${timestamp}.tar.gz`);

  try {
    fs.mkdirSync(stageDir, { recursive: true });

    // 1) Konsistente DB-Kopie
    const stagedDb = path.join(stageDir, 'zeiterfassung.db');
    try {
      execFileSync('sqlite3', [DB_PATH, `VACUUM INTO '${stagedDb.replace(/'/g, "''")}'`], { timeout: 30000 });
    } catch {
      fs.copyFileSync(DB_PATH, stagedDb);
    }

    // 2) uploads/ + reports/
    if (fs.existsSync(UPLOADS_DIR)) {
      fs.cpSync(UPLOADS_DIR, path.join(stageDir, 'uploads'), { recursive: true, dereference: true });
    }
    if (fs.existsSync(REPORTS_DIR)) {
      fs.cpSync(REPORTS_DIR, path.join(stageDir, 'reports'), { recursive: true, dereference: true });
    }

    // 3) secrets.json — NUR bei passphrase-verschlüsseltem Backup
    if (passphrase) {
      const docKey = readDocumentEncryptionKey();
      fs.writeFileSync(
        path.join(stageDir, 'secrets.json'),
        JSON.stringify({ DOCUMENT_ENCRYPTION_KEY: docKey || null, createdAt: new Date().toISOString() }, null, 2),
      );
    }

    // 4) tar.gz
    if (fs.existsSync(tarPath)) fs.unlinkSync(tarPath);
    await tar.create({ gzip: true, file: tarPath, cwd: stageDir }, fs.readdirSync(stageDir));

    // 5) Optional verschlüsseln
    if (passphrase) {
      const encPath = `${tarPath}.enc`;
      encryptArchive(tarPath, encPath, passphrase);
      fs.unlinkSync(tarPath);
      const stat = fs.statSync(encPath);
      return { filePath: encPath, filename: path.basename(encPath), fileSize: stat.size };
    }

    const stat = fs.statSync(tarPath);
    return { filePath: tarPath, filename: path.basename(tarPath), fileSize: stat.size };
  } finally {
    fs.rmSync(stageDir, { recursive: true, force: true });
  }
}

/**
 * Stellt aus einem Backup-Archiv (.tar.gz oder .tar.gz.enc) die Daten wieder her:
 * überschreibt die SQLite-DB, mergt uploads/ und reports/.
 * `passphrase` ist nur nötig, wenn das Archiv verschlüsselt ist.
 *
 * WICHTIG: kümmert sich NICHT um die laufende Prisma-Connection — der Aufrufer
 * muss vorher $disconnect() und nachher $connect() machen.
 */
export async function restoreFromArchive(archivePath: string, passphrase?: string | null): Promise<{ restoredDb: boolean; restoredUploads: boolean; restoredReports: boolean; hadSecrets: boolean }> {
  const workDir = path.join(BACKUP_DIR, `_restore_${Date.now()}`);
  fs.mkdirSync(workDir, { recursive: true });
  const dbBackupPath = `${DB_PATH}.before_restore_${Date.now()}`;

  try {
    // 1) Ggf. entschlüsseln
    let tarPath = archivePath;
    if (isEncryptedArchive(archivePath)) {
      if (!passphrase) throw new Error('Dieses Backup ist passphrase-verschlüsselt — bitte Passphrase angeben.');
      tarPath = path.join(workDir, 'archive.tar.gz');
      decryptArchive(archivePath, tarPath, passphrase);
    }

    // 2) Entpacken
    const extractDir = path.join(workDir, 'extract');
    fs.mkdirSync(extractDir, { recursive: true });
    await tar.extract({ file: tarPath, cwd: extractDir });

    // 3) Plausi: enthält das Archiv eine DB?
    const extractedDb = path.join(extractDir, 'zeiterfassung.db');
    if (!fs.existsSync(extractedDb)) {
      throw new Error('Archiv enthält keine zeiterfassung.db — kein gültiges Zeiterfassung-Backup.');
    }
    // Test: ist die DB lesbar?
    try {
      execFileSync('sqlite3', [extractedDb, 'SELECT count(*) FROM sqlite_master;'], { timeout: 15000 });
    } catch {
      throw new Error('Die zeiterfassung.db im Archiv ist beschädigt oder keine gültige SQLite-Datei.');
    }

    // 4) Aktuelle DB sichern, dann ersetzen
    if (fs.existsSync(DB_PATH)) fs.copyFileSync(DB_PATH, dbBackupPath);
    fs.copyFileSync(extractedDb, DB_PATH);

    // 5) uploads/ + reports/ mergen (vorhandene Dateien überschreiben)
    const extUploads = path.join(extractDir, 'uploads');
    const extReports = path.join(extractDir, 'reports');
    let restoredUploads = false, restoredReports = false;
    if (fs.existsSync(extUploads)) {
      fs.cpSync(extUploads, UPLOADS_DIR, { recursive: true, force: true });
      restoredUploads = true;
    }
    if (fs.existsSync(extReports)) {
      fs.cpSync(extReports, REPORTS_DIR, { recursive: true, force: true });
      restoredReports = true;
    }

    // 6) secrets.json — DOCUMENT_ENCRYPTION_KEY in .env eintragen falls fehlt
    let hadSecrets = false;
    const extSecrets = path.join(extractDir, 'secrets.json');
    if (fs.existsSync(extSecrets)) {
      hadSecrets = true;
      try {
        const secrets = JSON.parse(fs.readFileSync(extSecrets, 'utf8'));
        const key = secrets?.DOCUMENT_ENCRYPTION_KEY;
        if (key && /^[a-f0-9]{64}$/.test(key)) {
          const envContent = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf8') : '';
          if (!/^DOCUMENT_ENCRYPTION_KEY=/m.test(envContent)) {
            // Key fehlt in .env → anhängen, damit verschlüsselte Dateien lesbar bleiben
            fs.appendFileSync(ENV_PATH, `${envContent.endsWith('\n') || !envContent ? '' : '\n'}DOCUMENT_ENCRYPTION_KEY="${key}"\n`);
            process.env.DOCUMENT_ENCRYPTION_KEY = key;
          }
        }
      } catch {/* secrets.json kaputt — ignorieren, DB-Restore hat trotzdem geklappt */}
    }

    return { restoredDb: true, restoredUploads, restoredReports, hadSecrets };
  } catch (err) {
    // Bei Fehler: DB zurückrollen falls schon ersetzt
    if (fs.existsSync(dbBackupPath)) {
      try { fs.copyFileSync(dbBackupPath, DB_PATH); } catch {}
    }
    throw err;
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

export async function runBackup(trigger: 'scheduled' | 'manual' = 'manual'): Promise<any[]> {
  if (isRunning) {
    throw new Error('Ein Backup läuft bereits');
  }
  isRunning = true;

  try {
    // Geplante Backups werden verschlüsselt, wenn BACKUP_PASSPHRASE in .env gesetzt ist
    const { filePath, filename, fileSize } = await createArchive(getScheduledBackupPassphrase());
    const retentionDays = await getRetentionDays();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + retentionDays);

    // Get active targets
    const targets = await prisma.backupTarget.findMany({ where: { isActive: true } });

    // If no targets configured, still save locally
    if (targets.length === 0) {
      const record = await prisma.backupRecord.create({
        data: {
          filename, fileSize, status: 'success', trigger,
          completedAt: new Date(), expiresAt,
        },
      });
      return [record];
    }

    // Upload to each target
    const results = await Promise.allSettled(
      targets.map(async (target) => {
        const record = await prisma.backupRecord.create({
          data: {
            targetId: target.id, filename, fileSize, status: 'pending', trigger, expiresAt,
          },
        });

        try {
          const provider = providers[target.type];
          if (!provider) throw new Error(`Unbekannter Provider: ${target.type}`);
          const config = decryptConfig(target.config);

          // For local provider, the archive is already in place
          if (target.type !== 'local' || config.path !== BACKUP_DIR) {
            await provider.upload(config, filePath, filename);
          }

          return await prisma.backupRecord.update({
            where: { id: record.id },
            data: { status: 'success', completedAt: new Date() },
          });
        } catch (error: any) {
          return await prisma.backupRecord.update({
            where: { id: record.id },
            data: { status: 'failed', errorMessage: error.message, completedAt: new Date() },
          });
        }
      }),
    );

    return results.map(r => r.status === 'fulfilled' ? r.value : r.reason);
  } finally {
    isRunning = false;
  }
}

export async function cleanupOldBackups(): Promise<void> {
  const retentionDays = await getRetentionDays();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - retentionDays);

  // Delete old local files (Klartext .tar.gz und verschlüsselte .tar.gz.enc)
  if (fs.existsSync(BACKUP_DIR)) {
    for (const file of fs.readdirSync(BACKUP_DIR)) {
      if (!file.endsWith('.tar.gz') && !file.endsWith('.tar.gz.enc')) continue;
      const filePath = path.join(BACKUP_DIR, file);
      const stat = fs.statSync(filePath);
      if (stat.mtime < cutoff) {
        fs.unlinkSync(filePath);
      }
    }
  }

  // Delete old remote backups
  const oldRecords = await prisma.backupRecord.findMany({
    where: { expiresAt: { lt: new Date() }, status: 'success' },
    include: { target: true },
  });

  for (const record of oldRecords) {
    if (record.target) {
      try {
        const provider = providers[record.target.type];
        const config = decryptConfig(record.target.config);
        await provider?.delete(config, record.filename);
      } catch {}
    }
  }

  // Delete expired records from DB
  await prisma.backupRecord.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
}

export function getBackupStatus() {
  return { isRunning };
}

export async function testTarget(targetId: string): Promise<{ success: boolean; message: string }> {
  const target = await prisma.backupTarget.findUnique({ where: { id: targetId } });
  if (!target) return { success: false, message: 'Backup-Ziel nicht gefunden' };

  const provider = providers[target.type];
  if (!provider) return { success: false, message: `Unbekannter Provider: ${target.type}` };

  const config = decryptConfig(target.config);
  const result = await provider.testConnection(config);

  await prisma.backupTarget.update({
    where: { id: targetId },
    data: { lastTestAt: new Date(), lastTestOk: result.success },
  });

  return result;
}

export async function testProviderConfig(type: string, config: Record<string, any>): Promise<{ success: boolean; message: string }> {
  const provider = providers[type];
  if (!provider) return { success: false, message: `Unbekannter Provider: ${type}` };
  return provider.testConnection(config);
}
