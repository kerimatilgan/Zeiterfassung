import fs from 'fs';
import path from 'path';
import { BackupProvider, BackupProviderConfig, TestResult, RemoteFile } from './BaseProvider.js';

export class LocalProvider implements BackupProvider {
  readonly type = 'local';

  async testConnection(config: BackupProviderConfig): Promise<TestResult> {
    try {
      const dir = config.path || '/opt/Zeiterfassung/backups';
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      // Test write access
      const testFile = path.join(dir, '.backup-test');
      fs.writeFileSync(testFile, 'test');
      fs.unlinkSync(testFile);
      return { success: true, message: `Verzeichnis ${dir} ist beschreibbar` };
    } catch (error: any) {
      return { success: false, message: `Zugriffsfehler: ${error.message}` };
    }
  }

  async upload(config: BackupProviderConfig, filePath: string, remoteFilename: string): Promise<void> {
    const dir = config.path || '/opt/Zeiterfassung/backups';
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const dest = path.join(dir, remoteFilename);
    fs.copyFileSync(filePath, dest);
  }

  async list(config: BackupProviderConfig): Promise<RemoteFile[]> {
    const dir = config.path || '/opt/Zeiterfassung/backups';
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
      .filter(f => f.endsWith('.tar.gz'))
      .map(f => {
        const stat = fs.statSync(path.join(dir, f));
        return { name: f, size: stat.size, date: stat.mtime };
      })
      .sort((a, b) => b.date.getTime() - a.date.getTime());
  }

  async delete(config: BackupProviderConfig, remoteFilename: string): Promise<void> {
    const dir = config.path || '/opt/Zeiterfassung/backups';
    const filePath = path.join(dir, remoteFilename);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }
}
