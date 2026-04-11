import SftpClient from 'ssh2-sftp-client';
import { BackupProvider, BackupProviderConfig, TestResult, RemoteFile } from './BaseProvider.js';

export class SftpProvider implements BackupProvider {
  readonly type = 'sftp';

  private getConnectConfig(config: BackupProviderConfig) {
    const opts: any = {
      host: config.host,
      port: config.port || 22,
      username: config.username,
    };
    if (config.authMethod === 'key' && config.privateKey) {
      opts.privateKey = config.privateKey;
    } else {
      opts.password = config.password;
    }
    return opts;
  }

  async testConnection(config: BackupProviderConfig): Promise<TestResult> {
    const sftp = new SftpClient();
    try {
      await sftp.connect(this.getConnectConfig(config));
      const remotePath = config.remotePath || '/';
      const exists = await sftp.exists(remotePath);
      if (!exists) {
        await sftp.mkdir(remotePath, true);
      }
      await sftp.end();
      return { success: true, message: `Verbindung zu ${config.host} erfolgreich` };
    } catch (error: any) {
      try { await sftp.end(); } catch {}
      return { success: false, message: `SFTP-Fehler: ${error.message}` };
    }
  }

  async upload(config: BackupProviderConfig, filePath: string, remoteFilename: string): Promise<void> {
    const sftp = new SftpClient();
    try {
      await sftp.connect(this.getConnectConfig(config));
      const remotePath = config.remotePath || '/';
      const exists = await sftp.exists(remotePath);
      if (!exists) {
        await sftp.mkdir(remotePath, true);
      }
      await sftp.put(filePath, `${remotePath}/${remoteFilename}`);
      await sftp.end();
    } catch (error) {
      try { await sftp.end(); } catch {}
      throw error;
    }
  }

  async list(config: BackupProviderConfig): Promise<RemoteFile[]> {
    const sftp = new SftpClient();
    try {
      await sftp.connect(this.getConnectConfig(config));
      const remotePath = config.remotePath || '/';
      const exists = await sftp.exists(remotePath);
      if (!exists) { await sftp.end(); return []; }
      const files = await sftp.list(remotePath);
      await sftp.end();
      return files
        .filter(f => f.name.endsWith('.tar.gz'))
        .map(f => ({ name: f.name, size: f.size, date: new Date(f.modifyTime) }))
        .sort((a, b) => b.date.getTime() - a.date.getTime());
    } catch (error) {
      try { await sftp.end(); } catch {}
      throw error;
    }
  }

  async delete(config: BackupProviderConfig, remoteFilename: string): Promise<void> {
    const sftp = new SftpClient();
    try {
      await sftp.connect(this.getConnectConfig(config));
      const remotePath = config.remotePath || '/';
      await sftp.delete(`${remotePath}/${remoteFilename}`);
      await sftp.end();
    } catch (error) {
      try { await sftp.end(); } catch {}
      throw error;
    }
  }
}
