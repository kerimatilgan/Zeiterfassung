export interface BackupProviderConfig {
  [key: string]: any;
}

export interface TestResult {
  success: boolean;
  message: string;
}

export interface RemoteFile {
  name: string;
  size: number;
  date: Date;
}

export interface BackupProvider {
  readonly type: string;
  testConnection(config: BackupProviderConfig): Promise<TestResult>;
  upload(config: BackupProviderConfig, filePath: string, remoteFilename: string): Promise<void>;
  list(config: BackupProviderConfig): Promise<RemoteFile[]>;
  delete(config: BackupProviderConfig, remoteFilename: string): Promise<void>;
}
