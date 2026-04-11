import { S3Client, PutObjectCommand, ListObjectsV2Command, DeleteObjectCommand, HeadBucketCommand } from '@aws-sdk/client-s3';
import fs from 'fs';
import { BackupProvider, BackupProviderConfig, TestResult, RemoteFile } from './BaseProvider.js';

export class S3Provider implements BackupProvider {
  readonly type = 's3';

  private getClient(config: BackupProviderConfig): S3Client {
    const opts: any = {
      region: config.region || 'eu-central-1',
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    };
    if (config.endpoint) {
      opts.endpoint = config.endpoint;
      opts.forcePathStyle = config.forcePathStyle !== false;
    }
    return new S3Client(opts);
  }

  private getPrefix(config: BackupProviderConfig): string {
    return config.prefix ? (config.prefix.endsWith('/') ? config.prefix : config.prefix + '/') : '';
  }

  async testConnection(config: BackupProviderConfig): Promise<TestResult> {
    try {
      const client = this.getClient(config);
      await client.send(new HeadBucketCommand({ Bucket: config.bucket }));
      client.destroy();
      return { success: true, message: `Bucket "${config.bucket}" erreichbar` };
    } catch (error: any) {
      return { success: false, message: `S3-Fehler: ${error.message}` };
    }
  }

  async upload(config: BackupProviderConfig, filePath: string, remoteFilename: string): Promise<void> {
    const client = this.getClient(config);
    const body = fs.readFileSync(filePath);
    await client.send(new PutObjectCommand({
      Bucket: config.bucket,
      Key: this.getPrefix(config) + remoteFilename,
      Body: body,
    }));
    client.destroy();
  }

  async list(config: BackupProviderConfig): Promise<RemoteFile[]> {
    const client = this.getClient(config);
    const prefix = this.getPrefix(config);
    const result = await client.send(new ListObjectsV2Command({
      Bucket: config.bucket,
      Prefix: prefix,
    }));
    client.destroy();
    return (result.Contents || [])
      .filter(obj => obj.Key?.endsWith('.tar.gz'))
      .map(obj => ({
        name: obj.Key!.replace(prefix, ''),
        size: obj.Size || 0,
        date: obj.LastModified || new Date(),
      }))
      .sort((a, b) => b.date.getTime() - a.date.getTime());
  }

  async delete(config: BackupProviderConfig, remoteFilename: string): Promise<void> {
    const client = this.getClient(config);
    await client.send(new DeleteObjectCommand({
      Bucket: config.bucket,
      Key: this.getPrefix(config) + remoteFilename,
    }));
    client.destroy();
  }
}
