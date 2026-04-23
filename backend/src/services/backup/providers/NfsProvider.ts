import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { BackupProvider, BackupProviderConfig, TestResult, RemoteFile } from './BaseProvider.js';

export class NfsProvider implements BackupProvider {
  readonly type = 'nfs';

  private getMountPoint(config: BackupProviderConfig): string {
    return config.localMountPoint || '/tmp/zeiterfassung-nfs-backup';
  }

  // Whitelist-Regex für NFS-Mount-Options (verhindert Injection via options-Feld)
  private validateOptions(opts: string): string {
    if (!/^[a-zA-Z0-9=,_\-]+$/.test(opts)) {
      throw new Error('Ungültige NFS-Mount-Options: nur [a-zA-Z0-9=,_-] erlaubt');
    }
    return opts;
  }

  private mount(config: BackupProviderConfig): void {
    const mountPoint = this.getMountPoint(config);
    if (!fs.existsSync(mountPoint)) {
      fs.mkdirSync(mountPoint, { recursive: true });
    }
    // Check if already mounted
    try {
      const mounts = execFileSync('mount', [], { stdio: 'pipe' }).toString();
      if (mounts.includes(mountPoint)) return;
    } catch {}
    const opts = this.validateOptions(config.options || 'nolock,soft,timeo=30');
    const host = String(config.host || '');
    const exportPath = String(config.exportPath || '');
    // execFile mit argv-Array — keine Shell-Interpretation von host/exportPath
    execFileSync(
      'mount',
      ['-t', 'nfs', '-o', opts, `${host}:${exportPath}`, mountPoint],
      { timeout: 15000, stdio: 'pipe' },
    );
  }

  private unmount(config: BackupProviderConfig): void {
    const mountPoint = this.getMountPoint(config);
    try {
      execFileSync('umount', [mountPoint], { timeout: 10000, stdio: 'pipe' });
    } catch {}
  }

  private getTargetDir(config: BackupProviderConfig): string {
    const mountPoint = this.getMountPoint(config);
    return config.subPath ? path.join(mountPoint, config.subPath) : mountPoint;
  }

  async testConnection(config: BackupProviderConfig): Promise<TestResult> {
    try {
      this.mount(config);
      const targetDir = this.getTargetDir(config);
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }
      const testFile = path.join(targetDir, '.backup-test');
      fs.writeFileSync(testFile, 'test');
      fs.unlinkSync(testFile);
      this.unmount(config);
      return { success: true, message: `NFS ${config.host}:${config.exportPath} erreichbar und beschreibbar` };
    } catch (error: any) {
      this.unmount(config);
      return { success: false, message: `NFS-Fehler: ${error.message}` };
    }
  }

  async upload(config: BackupProviderConfig, filePath: string, remoteFilename: string): Promise<void> {
    try {
      this.mount(config);
      const targetDir = this.getTargetDir(config);
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }
      fs.copyFileSync(filePath, path.join(targetDir, remoteFilename));
      this.unmount(config);
    } catch (error) {
      this.unmount(config);
      throw error;
    }
  }

  async list(config: BackupProviderConfig): Promise<RemoteFile[]> {
    try {
      this.mount(config);
      const targetDir = this.getTargetDir(config);
      if (!fs.existsSync(targetDir)) { this.unmount(config); return []; }
      const files = fs.readdirSync(targetDir)
        .filter(f => f.endsWith('.tar.gz'))
        .map(f => {
          const stat = fs.statSync(path.join(targetDir, f));
          return { name: f, size: stat.size, date: stat.mtime };
        })
        .sort((a, b) => b.date.getTime() - a.date.getTime());
      this.unmount(config);
      return files;
    } catch {
      this.unmount(config);
      return [];
    }
  }

  async delete(config: BackupProviderConfig, remoteFilename: string): Promise<void> {
    try {
      this.mount(config);
      const targetDir = this.getTargetDir(config);
      const filePath = path.join(targetDir, remoteFilename);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      this.unmount(config);
    } catch (error) {
      this.unmount(config);
      throw error;
    }
  }
}
