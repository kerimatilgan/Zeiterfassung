import { createClient, WebDAVClient } from 'webdav';
import fs from 'fs';
import { BackupProvider, BackupProviderConfig, TestResult, RemoteFile } from './BaseProvider.js';

export class WebDavProvider implements BackupProvider {
  readonly type = 'webdav';

  private getClient(config: BackupProviderConfig): WebDAVClient {
    return createClient(config.url, {
      username: config.username,
      password: config.password,
    });
  }

  private getPath(config: BackupProviderConfig): string {
    return config.path || '/';
  }

  async testConnection(config: BackupProviderConfig): Promise<TestResult> {
    try {
      if (!config.url?.startsWith('https://')) {
        return { success: false, message: 'Nur HTTPS-URLs sind erlaubt' };
      }
      const client = this.getClient(config);
      const exists = await client.exists(this.getPath(config));
      if (!exists) {
        await client.createDirectory(this.getPath(config), { recursive: true });
      }
      return { success: true, message: `WebDAV-Verbindung zu ${config.url} erfolgreich` };
    } catch (error: any) {
      return { success: false, message: `WebDAV-Fehler: ${error.message}` };
    }
  }

  async upload(config: BackupProviderConfig, filePath: string, remoteFilename: string): Promise<void> {
    const client = this.getClient(config);
    const remotePath = this.getPath(config);
    const exists = await client.exists(remotePath);
    if (!exists) {
      await client.createDirectory(remotePath, { recursive: true });
    }
    const data = fs.readFileSync(filePath);
    await client.putFileContents(`${remotePath}/${remoteFilename}`, data, { overwrite: true });
  }

  async list(config: BackupProviderConfig): Promise<RemoteFile[]> {
    try {
      const client = this.getClient(config);
      const remotePath = this.getPath(config);
      const exists = await client.exists(remotePath);
      if (!exists) return [];
      const items = await client.getDirectoryContents(remotePath) as any[];
      return items
        .filter(item => item.basename?.endsWith('.tar.gz'))
        .map(item => ({
          name: item.basename,
          size: item.size || 0,
          date: new Date(item.lastmod || Date.now()),
        }))
        .sort((a, b) => b.date.getTime() - a.date.getTime());
    } catch {
      return [];
    }
  }

  async delete(config: BackupProviderConfig, remoteFilename: string): Promise<void> {
    const client = this.getClient(config);
    const remotePath = this.getPath(config);
    await client.deleteFile(`${remotePath}/${remoteFilename}`);
  }
}
