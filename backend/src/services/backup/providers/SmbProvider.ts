import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { BackupProvider, BackupProviderConfig, TestResult, RemoteFile } from './BaseProvider.js';

export class SmbProvider implements BackupProvider {
  readonly type = 'smb';

  private buildAuthArgs(config: BackupProviderConfig): string {
    const user = config.username || 'guest';
    const pass = config.password || '';
    const domain = config.domain ? `-W ${this.shellEscape(config.domain)}` : '';
    return `-U ${this.shellEscape(user + '%' + pass)} ${domain}`;
  }

  private buildSharePath(config: BackupProviderConfig): string {
    const port = config.port ? `-p ${config.port}` : '';
    return `//${config.host}/${config.share} ${port}`;
  }

  private shellEscape(s: string): string {
    return `'${s.replace(/'/g, "'\\''")}'`;
  }

  private getRemoteDir(config: BackupProviderConfig): string {
    return config.path ? config.path.replace(/^\//, '').replace(/\/$/, '') : '';
  }

  async testConnection(config: BackupProviderConfig): Promise<TestResult> {
    try {
      const auth = this.buildAuthArgs(config);
      const share = this.buildSharePath(config);
      const remoteDir = this.getRemoteDir(config);
      const cmd = remoteDir
        ? `smbclient ${share} ${auth} -c ${this.shellEscape(`cd ${remoteDir}; ls`)}`
        : `smbclient ${share} ${auth} -c 'ls'`;
      execSync(cmd, { timeout: 15000, stdio: 'pipe' });
      return { success: true, message: `SMB-Freigabe //${config.host}/${config.share} erreichbar` };
    } catch (error: any) {
      return { success: false, message: `SMB-Fehler: ${error.stderr?.toString() || error.message}` };
    }
  }

  async upload(config: BackupProviderConfig, filePath: string, remoteFilename: string): Promise<void> {
    const auth = this.buildAuthArgs(config);
    const share = this.buildSharePath(config);
    const remoteDir = this.getRemoteDir(config);
    const cdCmd = remoteDir ? `cd ${remoteDir}; ` : '';
    const cmd = `smbclient ${share} ${auth} -c ${this.shellEscape(`${cdCmd}put ${filePath} ${remoteFilename}`)}`;
    execSync(cmd, { timeout: 120000, stdio: 'pipe' });
  }

  async list(config: BackupProviderConfig): Promise<RemoteFile[]> {
    try {
      const auth = this.buildAuthArgs(config);
      const share = this.buildSharePath(config);
      const remoteDir = this.getRemoteDir(config);
      const cdCmd = remoteDir ? `cd ${remoteDir}; ` : '';
      const cmd = `smbclient ${share} ${auth} -c ${this.shellEscape(`${cdCmd}ls *.tar.gz`)}`;
      const output = execSync(cmd, { timeout: 15000, stdio: 'pipe' }).toString();
      const files: RemoteFile[] = [];
      for (const line of output.split('\n')) {
        const match = line.match(/^\s+(\S+\.tar\.gz)\s+\w+\s+(\d+)\s+(.+)$/);
        if (match) {
          files.push({
            name: match[1],
            size: parseInt(match[2], 10),
            date: new Date(match[3]),
          });
        }
      }
      return files.sort((a, b) => b.date.getTime() - a.date.getTime());
    } catch {
      return [];
    }
  }

  async delete(config: BackupProviderConfig, remoteFilename: string): Promise<void> {
    const auth = this.buildAuthArgs(config);
    const share = this.buildSharePath(config);
    const remoteDir = this.getRemoteDir(config);
    const cdCmd = remoteDir ? `cd ${remoteDir}; ` : '';
    const cmd = `smbclient ${share} ${auth} -c ${this.shellEscape(`${cdCmd}del ${remoteFilename}`)}`;
    execSync(cmd, { timeout: 15000, stdio: 'pipe' });
  }
}
