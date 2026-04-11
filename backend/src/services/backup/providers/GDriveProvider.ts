import { google } from 'googleapis';
import fs from 'fs';
import { BackupProvider, BackupProviderConfig, TestResult, RemoteFile } from './BaseProvider.js';

export class GDriveProvider implements BackupProvider {
  readonly type = 'gdrive';

  private getAuth(config: BackupProviderConfig) {
    const oauth2 = new google.auth.OAuth2(config.clientId, config.clientSecret);
    oauth2.setCredentials({ refresh_token: config.refreshToken });
    return oauth2;
  }

  private getDrive(config: BackupProviderConfig) {
    return google.drive({ version: 'v3', auth: this.getAuth(config) });
  }

  private async ensureFolder(config: BackupProviderConfig): Promise<string> {
    const drive = this.getDrive(config);
    if (config.folderId) return config.folderId;

    const folderName = config.folderName || 'Zeiterfassung-Backups';
    const query = `name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
    const res = await drive.files.list({ q: query, fields: 'files(id,name)' });
    if (res.data.files && res.data.files.length > 0) {
      return res.data.files[0].id!;
    }
    const folder = await drive.files.create({
      requestBody: { name: folderName, mimeType: 'application/vnd.google-apps.folder' },
      fields: 'id',
    });
    return folder.data.id!;
  }

  async testConnection(config: BackupProviderConfig): Promise<TestResult> {
    try {
      const drive = this.getDrive(config);
      const about = await drive.about.get({ fields: 'user' });
      const folderId = await this.ensureFolder(config);
      return { success: true, message: `Google Drive verbunden (${about.data.user?.emailAddress}), Ordner-ID: ${folderId}` };
    } catch (error: any) {
      return { success: false, message: `Google Drive-Fehler: ${error.message}` };
    }
  }

  async upload(config: BackupProviderConfig, filePath: string, remoteFilename: string): Promise<void> {
    const drive = this.getDrive(config);
    const folderId = await this.ensureFolder(config);
    await drive.files.create({
      requestBody: { name: remoteFilename, parents: [folderId] },
      media: { mimeType: 'application/gzip', body: fs.createReadStream(filePath) },
    });
  }

  async list(config: BackupProviderConfig): Promise<RemoteFile[]> {
    try {
      const drive = this.getDrive(config);
      const folderId = await this.ensureFolder(config);
      const res = await drive.files.list({
        q: `'${folderId}' in parents and trashed=false and name contains '.tar.gz'`,
        fields: 'files(id,name,size,modifiedTime)',
        orderBy: 'modifiedTime desc',
      });
      return (res.data.files || []).map(f => ({
        name: f.name!,
        size: parseInt(f.size || '0', 10),
        date: new Date(f.modifiedTime || Date.now()),
      }));
    } catch {
      return [];
    }
  }

  async delete(config: BackupProviderConfig, remoteFilename: string): Promise<void> {
    const drive = this.getDrive(config);
    const folderId = await this.ensureFolder(config);
    const res = await drive.files.list({
      q: `'${folderId}' in parents and name='${remoteFilename}' and trashed=false`,
      fields: 'files(id)',
    });
    if (res.data.files && res.data.files.length > 0) {
      await drive.files.delete({ fileId: res.data.files[0].id! });
    }
  }
}
