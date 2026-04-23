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

const prisma = new PrismaClient();

const BACKUP_DIR = '/opt/Zeiterfassung/backups';
const DB_PATH = path.resolve(process.cwd(), 'prisma/zeiterfassung.db');
const UPLOADS_DIR = path.resolve(process.cwd(), 'uploads');
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

async function createArchive(): Promise<{ filePath: string; filename: string; fileSize: number }> {
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }

  const timestamp = formatDate(new Date());
  const filename = `zeiterfassung_${timestamp}.tar.gz`;
  const archivePath = path.join(BACKUP_DIR, filename);
  const tmpDbPath = path.join(BACKUP_DIR, `_tmp_backup_${timestamp}.db`);

  try {
    // Create consistent SQLite copy using VACUUM INTO (execFile: keine Shell)
    execFileSync('sqlite3', [DB_PATH, `VACUUM INTO '${tmpDbPath.replace(/'/g, "''")}'`], { timeout: 30000 });
  } catch {
    // Fallback: direct copy
    fs.copyFileSync(DB_PATH, tmpDbPath);
  }

  // Build list of files to archive
  const filesToArchive: { cwd: string; files: string[] }[] = [
    { cwd: BACKUP_DIR, files: [path.basename(tmpDbPath)] },
  ];

  if (fs.existsSync(UPLOADS_DIR)) {
    filesToArchive.push({ cwd: path.dirname(UPLOADS_DIR), files: ['uploads'] });
  }

  // Create tar.gz: first the db, then uploads
  await tar.create(
    {
      gzip: true,
      file: archivePath,
      cwd: BACKUP_DIR,
    },
    [path.basename(tmpDbPath)],
  );

  // If uploads exist, append them
  if (fs.existsSync(UPLOADS_DIR)) {
    await tar.create(
      {
        gzip: true,
        file: archivePath,
        cwd: path.dirname(UPLOADS_DIR),
      },
      ['uploads'],
    );
  }

  // Actually, let's redo: create a staging dir and tar everything together
  const stageDir = path.join(BACKUP_DIR, `_stage_${timestamp}`);
  fs.mkdirSync(stageDir, { recursive: true });
  fs.renameSync(tmpDbPath, path.join(stageDir, 'zeiterfassung.db'));

  // Symlink uploads if exists
  if (fs.existsSync(UPLOADS_DIR)) {
    // Copy uploads directory listing
    fs.cpSync(UPLOADS_DIR, path.join(stageDir, 'uploads'), { recursive: true, dereference: true });
  }

  // Remove old incomplete archive
  if (fs.existsSync(archivePath)) fs.unlinkSync(archivePath);

  await tar.create(
    {
      gzip: true,
      file: archivePath,
      cwd: stageDir,
    },
    fs.readdirSync(stageDir),
  );

  // Cleanup staging
  fs.rmSync(stageDir, { recursive: true, force: true });

  const stat = fs.statSync(archivePath);
  return { filePath: archivePath, filename, fileSize: stat.size };
}

export async function runBackup(trigger: 'scheduled' | 'manual' = 'manual'): Promise<any[]> {
  if (isRunning) {
    throw new Error('Ein Backup läuft bereits');
  }
  isRunning = true;

  try {
    // Create archive
    const { filePath, filename, fileSize } = await createArchive();
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

  // Delete old local files
  if (fs.existsSync(BACKUP_DIR)) {
    for (const file of fs.readdirSync(BACKUP_DIR)) {
      if (!file.endsWith('.tar.gz')) continue;
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
