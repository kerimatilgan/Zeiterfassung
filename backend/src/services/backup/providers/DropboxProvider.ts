import { Dropbox } from 'dropbox';
import fs from 'fs';
import { BackupProvider, BackupProviderConfig, TestResult, RemoteFile } from './BaseProvider.js';

export class DropboxProvider implements BackupProvider {
  readonly type = 'dropbox';

  private getClient(config: BackupProviderConfig): Dropbox {
    return new Dropbox({ accessToken: config.accessToken });
  }

  private getPath(config: BackupProviderConfig): string {
    const p = config.path || '/Zeiterfassung-Backups';
    return p.startsWith('/') ? p : '/' + p;
  }

  async testConnection(config: BackupProviderConfig): Promise<TestResult> {
    try {
      const dbx = this.getClient(config);
      const account = await dbx.usersGetCurrentAccount();
      // Ensure folder exists
      const folderPath = this.getPath(config);
      try {
        await dbx.filesGetMetadata({ path: folderPath });
      } catch {
        await dbx.filesCreateFolderV2({ path: folderPath, autorename: false });
      }
      return { success: true, message: `Dropbox-Verbindung erfolgreich (${account.result.email})` };
    } catch (error: any) {
      return { success: false, message: `Dropbox-Fehler: ${error.error?.error_summary || error.message}` };
    }
  }

  async upload(config: BackupProviderConfig, filePath: string, remoteFilename: string): Promise<void> {
    const dbx = this.getClient(config);
    const data = fs.readFileSync(filePath);
    const remotePath = `${this.getPath(config)}/${remoteFilename}`;
    await dbx.filesUpload({
      path: remotePath,
      contents: data,
      mode: { '.tag': 'overwrite' },
    });
  }

  async list(config: BackupProviderConfig): Promise<RemoteFile[]> {
    try {
      const dbx = this.getClient(config);
      const folderPath = this.getPath(config);
      const result = await dbx.filesListFolder({ path: folderPath });
      return result.result.entries
        .filter(e => e['.tag'] === 'file' && e.name.endsWith('.tar.gz'))
        .map(e => ({
          name: e.name,
          size: (e as any).size || 0,
          date: new Date((e as any).server_modified || Date.now()),
        }))
        .sort((a, b) => b.date.getTime() - a.date.getTime());
    } catch {
      return [];
    }
  }

  async delete(config: BackupProviderConfig, remoteFilename: string): Promise<void> {
    const dbx = this.getClient(config);
    const remotePath = `${this.getPath(config)}/${remoteFilename}`;
    await dbx.filesDeleteV2({ path: remotePath });
  }
}
