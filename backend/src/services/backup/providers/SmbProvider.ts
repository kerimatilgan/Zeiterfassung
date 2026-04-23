import { execFile } from 'child_process';
import { promisify } from 'util';
import { BackupProvider, BackupProviderConfig, TestResult, RemoteFile } from './BaseProvider.js';

const execFileAsync = promisify(execFile);

export class SmbProvider implements BackupProvider {
  readonly type = 'smb';

  // Baut argv-Array für smbclient. Keine Shell-Interpretation, daher kein
  // Command-Injection-Vektor mehr durch Host/Share/Domain/Port.
  private baseArgs(config: BackupProviderConfig, cCommand: string): string[] {
    const share = `//${config.host}/${config.share}`;
    const user = config.username || 'guest';
    const pass = config.password || '';
    const args = [share, '-U', `${user}%${pass}`];
    if (config.domain) args.push('-W', String(config.domain));
    if (config.port) args.push('-p', String(config.port));
    args.push('-c', cCommand);
    return args;
  }

  // Escaping *innerhalb* des -c Commands (smbclient-interne Parser-Ebene,
  // nicht OS-Ebene). Wrapt dynamische Werte in einfache Quotes.
  private smbEscape(s: string): string {
    return `"${String(s).replace(/["\\]/g, '\\$&')}"`;
  }

  private getRemoteDir(config: BackupProviderConfig): string {
    return config.path ? config.path.replace(/^\//, '').replace(/\/$/, '') : '';
  }

  private async run(args: string[], timeoutMs: number): Promise<string> {
    const { stdout } = await execFileAsync('smbclient', args, {
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
    });
    return stdout;
  }

  async testConnection(config: BackupProviderConfig): Promise<TestResult> {
    try {
      const remoteDir = this.getRemoteDir(config);
      const cCmd = remoteDir ? `cd ${this.smbEscape(remoteDir)}; ls` : 'ls';
      await this.run(this.baseArgs(config, cCmd), 15000);
      return { success: true, message: `SMB-Freigabe //${config.host}/${config.share} erreichbar` };
    } catch (error: any) {
      return { success: false, message: `SMB-Fehler: ${error.stderr?.toString() || error.message}` };
    }
  }

  async upload(config: BackupProviderConfig, filePath: string, remoteFilename: string): Promise<void> {
    const remoteDir = this.getRemoteDir(config);
    const cdCmd = remoteDir ? `cd ${this.smbEscape(remoteDir)}; ` : '';
    const cCmd = `${cdCmd}put ${this.smbEscape(filePath)} ${this.smbEscape(remoteFilename)}`;
    await this.run(this.baseArgs(config, cCmd), 120000);
  }

  async list(config: BackupProviderConfig): Promise<RemoteFile[]> {
    try {
      const remoteDir = this.getRemoteDir(config);
      const cdCmd = remoteDir ? `cd ${this.smbEscape(remoteDir)}; ` : '';
      const cCmd = `${cdCmd}ls *.tar.gz`;
      const output = await this.run(this.baseArgs(config, cCmd), 15000);
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
    const remoteDir = this.getRemoteDir(config);
    const cdCmd = remoteDir ? `cd ${this.smbEscape(remoteDir)}; ` : '';
    const cCmd = `${cdCmd}del ${this.smbEscape(remoteFilename)}`;
    await this.run(this.baseArgs(config, cCmd), 15000);
  }
}
