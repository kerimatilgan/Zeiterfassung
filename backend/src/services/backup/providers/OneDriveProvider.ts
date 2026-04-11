import { Client } from '@microsoft/microsoft-graph-client';
import { ConfidentialClientApplication } from '@azure/msal-node';
import fs from 'fs';
import { BackupProvider, BackupProviderConfig, TestResult, RemoteFile } from './BaseProvider.js';

export class OneDriveProvider implements BackupProvider {
  readonly type = 'onedrive';

  private async getClient(config: BackupProviderConfig): Promise<Client> {
    const cca = new ConfidentialClientApplication({
      auth: {
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        authority: `https://login.microsoftonline.com/${config.tenantId || 'common'}`,
      },
    });

    // Use refresh token to get new access token
    const result = await cca.acquireTokenByRefreshToken({
      refreshToken: config.refreshToken,
      scopes: ['https://graph.microsoft.com/Files.ReadWrite.All'],
    });

    return Client.init({
      authProvider: (done) => {
        done(null, result!.accessToken);
      },
    });
  }

  private getPath(config: BackupProviderConfig): string {
    return config.path || '/Zeiterfassung-Backups';
  }

  async testConnection(config: BackupProviderConfig): Promise<TestResult> {
    try {
      const client = await this.getClient(config);
      const me = await client.api('/me').get();
      // Ensure folder exists
      const folderPath = this.getPath(config);
      try {
        await client.api(`/me/drive/root:${folderPath}`).get();
      } catch {
        const parts = folderPath.split('/').filter(Boolean);
        let currentPath = '';
        for (const part of parts) {
          const parentPath = currentPath || '/me/drive/root';
          const api = currentPath
            ? `/me/drive/root:${currentPath}:/children`
            : '/me/drive/root/children';
          try {
            await client.api(api).post({
              name: part,
              folder: {},
              '@microsoft.graph.conflictBehavior': 'fail',
            });
          } catch {}
          currentPath += '/' + part;
        }
      }
      return { success: true, message: `OneDrive verbunden (${me.userPrincipalName || me.mail})` };
    } catch (error: any) {
      return { success: false, message: `OneDrive-Fehler: ${error.message}` };
    }
  }

  async upload(config: BackupProviderConfig, filePath: string, remoteFilename: string): Promise<void> {
    const client = await this.getClient(config);
    const folderPath = this.getPath(config);
    const data = fs.readFileSync(filePath);

    // For files < 4MB use simple upload, otherwise use upload session
    if (data.length < 4 * 1024 * 1024) {
      await client.api(`/me/drive/root:${folderPath}/${remoteFilename}:/content`).put(data);
    } else {
      const session = await client.api(`/me/drive/root:${folderPath}/${remoteFilename}:/createUploadSession`).post({
        item: { '@microsoft.graph.conflictBehavior': 'replace' },
      });
      // Upload in 3.2MB chunks
      const chunkSize = 3200 * 1024;
      for (let i = 0; i < data.length; i += chunkSize) {
        const chunk = data.subarray(i, Math.min(i + chunkSize, data.length));
        const end = Math.min(i + chunkSize, data.length) - 1;
        await fetch(session.uploadUrl, {
          method: 'PUT',
          headers: {
            'Content-Range': `bytes ${i}-${end}/${data.length}`,
            'Content-Length': chunk.length.toString(),
          },
          body: chunk,
        });
      }
    }
  }

  async list(config: BackupProviderConfig): Promise<RemoteFile[]> {
    try {
      const client = await this.getClient(config);
      const folderPath = this.getPath(config);
      const result = await client.api(`/me/drive/root:${folderPath}:/children`).get();
      return (result.value || [])
        .filter((item: any) => item.name?.endsWith('.tar.gz'))
        .map((item: any) => ({
          name: item.name,
          size: item.size || 0,
          date: new Date(item.lastModifiedDateTime || Date.now()),
        }))
        .sort((a: RemoteFile, b: RemoteFile) => b.date.getTime() - a.date.getTime());
    } catch {
      return [];
    }
  }

  async delete(config: BackupProviderConfig, remoteFilename: string): Promise<void> {
    const client = await this.getClient(config);
    const folderPath = this.getPath(config);
    await client.api(`/me/drive/root:${folderPath}/${remoteFilename}`).delete();
  }
}
