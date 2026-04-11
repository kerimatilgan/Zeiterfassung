import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { backupApi } from '../../lib/api';
import {
  Database, Plus, Play, Trash2, TestTube, Check, X, Download,
  Clock, Server, HardDrive, Globe, Cloud, Terminal, RefreshCw,
  ChevronLeft, ChevronRight, AlertTriangle,
} from 'lucide-react';

// Provider-Typen und ihre Konfigurationsfelder
const OAUTH_PROVIDERS = ['onedrive', 'gdrive', 'dropbox'];

const PROVIDER_TYPES: Record<string, { label: string; icon: any; fields: FieldDef[]; oauth?: boolean }> = {
  local: {
    label: 'Lokal',
    icon: HardDrive,
    fields: [
      { name: 'path', label: 'Verzeichnis', type: 'text', default: '/opt/Zeiterfassung/backups/', required: true },
    ],
  },
  smb: {
    label: 'SMB-Freigabe',
    icon: Server,
    fields: [
      { name: 'host', label: 'Server', type: 'text', placeholder: '192.168.1.100', required: true },
      { name: 'share', label: 'Freigabe', type: 'text', placeholder: 'backups', required: true },
      { name: 'path', label: 'Unterordner', type: 'text', placeholder: 'zeiterfassung' },
      { name: 'username', label: 'Benutzername', type: 'text', required: true },
      { name: 'password', label: 'Passwort', type: 'password', required: true },
      { name: 'domain', label: 'Domäne', type: 'text', placeholder: 'WORKGROUP' },
    ],
  },
  nfs: {
    label: 'NFS-Share',
    icon: Server,
    fields: [
      { name: 'host', label: 'Server', type: 'text', placeholder: '192.168.1.100', required: true },
      { name: 'exportPath', label: 'Export-Pfad', type: 'text', placeholder: '/export/backups', required: true },
      { name: 'subPath', label: 'Unterordner', type: 'text', placeholder: 'zeiterfassung' },
      { name: 'options', label: 'Mount-Optionen', type: 'text', default: 'nolock,soft,timeo=30' },
    ],
  },
  sftp: {
    label: 'SFTP',
    icon: Terminal,
    fields: [
      { name: 'host', label: 'Server', type: 'text', placeholder: 'backup.example.com', required: true },
      { name: 'port', label: 'Port', type: 'number', default: '22' },
      { name: 'username', label: 'Benutzername', type: 'text', required: true },
      { name: 'authMethod', label: 'Authentifizierung', type: 'select', options: [
        { value: 'password', label: 'Passwort' },
        { value: 'key', label: 'Private Key' },
      ], default: 'password', required: true },
      { name: 'password', label: 'Passwort', type: 'password', showWhen: { authMethod: 'password' } },
      { name: 'privateKey', label: 'Private Key', type: 'textarea', showWhen: { authMethod: 'key' } },
      { name: 'remotePath', label: 'Remote-Pfad', type: 'text', placeholder: '/backups/zeiterfassung', required: true },
    ],
  },
  webdav: {
    label: 'WebDAV',
    icon: Globe,
    fields: [
      { name: 'url', label: 'URL (HTTPS)', type: 'text', placeholder: 'https://cloud.example.com/remote.php/dav/files/user/', required: true },
      { name: 'username', label: 'Benutzername', type: 'text', required: true },
      { name: 'password', label: 'Passwort', type: 'password', required: true },
      { name: 'path', label: 'Unterordner', type: 'text', placeholder: '/Zeiterfassung-Backups' },
    ],
  },
  dropbox: {
    label: 'Dropbox',
    icon: Cloud,
    oauth: true,
    fields: [
      { name: 'clientId', label: 'App Key', type: 'text', required: true },
      { name: 'clientSecret', label: 'App Secret', type: 'password', required: true },
      { name: 'path', label: 'Ordner', type: 'text', default: '/Zeiterfassung-Backups' },
    ],
  },
  gdrive: {
    label: 'Google Drive',
    icon: Cloud,
    oauth: true,
    fields: [
      { name: 'clientId', label: 'Client ID', type: 'text', required: true },
      { name: 'clientSecret', label: 'Client Secret', type: 'password', required: true },
      { name: 'folderId', label: 'Ordner-ID (optional)', type: 'text', placeholder: 'Automatisch erstellt' },
    ],
  },
  onedrive: {
    label: 'OneDrive',
    icon: Cloud,
    oauth: true,
    fields: [
      { name: 'clientId', label: 'Application (Client) ID', type: 'text', required: true },
      { name: 'clientSecret', label: 'Client Secret', type: 'password', required: true },
      { name: 'tenantId', label: 'Tenant ID', type: 'text', default: 'common', required: true },
      { name: 'path', label: 'Ordner', type: 'text', default: '/Zeiterfassung-Backups' },
    ],
  },
  s3: {
    label: 'S3 / S3-kompatibel',
    icon: Database,
    fields: [
      { name: 'endpoint', label: 'Endpoint (leer für AWS)', type: 'text', placeholder: 'https://s3.example.com' },
      { name: 'region', label: 'Region', type: 'text', default: 'eu-central-1', required: true },
      { name: 'bucket', label: 'Bucket', type: 'text', required: true },
      { name: 'prefix', label: 'Prefix/Ordner', type: 'text', placeholder: 'zeiterfassung/' },
      { name: 'accessKeyId', label: 'Access Key ID', type: 'text', required: true },
      { name: 'secretAccessKey', label: 'Secret Access Key', type: 'password', required: true },
      { name: 'forcePathStyle', label: 'Path-Style (MinIO/Backblaze)', type: 'checkbox' },
    ],
  },
};

interface FieldDef {
  name: string;
  label: string;
  type: 'text' | 'password' | 'number' | 'select' | 'textarea' | 'checkbox';
  placeholder?: string;
  default?: string;
  required?: boolean;
  options?: { value: string; label: string }[];
  showWhen?: Record<string, string>;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDateTime(dateStr: string): string {
  return new Date(dateStr).toLocaleString('de-DE', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

// ==================== Target Modal ====================
function TargetModal({ target, onClose, onSave }: {
  target?: any;
  onClose: () => void;
  onSave: (data: any) => void;
}) {
  const [name, setName] = useState(target?.name || '');
  const [type, setType] = useState(target?.type || 'local');
  const [config, setConfig] = useState<Record<string, any>>(() => {
    if (target?.config) return target.config;
    const defaults: Record<string, any> = {};
    const providerFields = PROVIDER_TYPES[type]?.fields || [];
    providerFields.forEach(f => { if (f.default) defaults[f.name] = f.default; });
    return defaults;
  });
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [oauthStatus, setOauthStatus] = useState<'idle' | 'pending' | 'success' | 'error'>('idle');
  const [oauthError, setOauthError] = useState('');

  const providerDef = PROVIDER_TYPES[type];
  const isOAuthProvider = providerDef?.oauth === true;
  const hasOAuthTokens = isOAuthProvider && (config.refreshToken || config.accessToken);

  const handleTypeChange = (newType: string) => {
    setType(newType);
    const defaults: Record<string, any> = {};
    PROVIDER_TYPES[newType]?.fields.forEach(f => { if (f.default) defaults[f.name] = f.default; });
    setConfig(defaults);
    setTestResult(null);
    setOauthStatus('idle');
  };

  const updateConfig = (field: string, value: any) => {
    setConfig(prev => ({ ...prev, [field]: value }));
    setTestResult(null);
  };

  // OAuth Login Flow
  const handleOAuthLogin = async () => {
    if (!config.clientId || !config.clientSecret) {
      setOauthError('Client ID und Client Secret müssen zuerst ausgefüllt werden');
      setOauthStatus('error');
      return;
    }

    setOauthStatus('pending');
    setOauthError('');

    try {
      const res = await backupApi.startOAuth({
        provider: type,
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        tenantId: config.tenantId,
      });

      const { authUrl, state } = res.data;

      // Open popup
      const popup = window.open(authUrl, 'oauth-login', 'width=600,height=700,left=200,top=100');

      // Listen for postMessage from popup
      const handleMessage = async (event: MessageEvent) => {
        if (event.data?.type === 'oauth-success' && event.data?.state === state) {
          window.removeEventListener('message', handleMessage);
          try {
            const tokenRes = await backupApi.getOAuthResult(state);
            const tokens = tokenRes.data;
            setConfig(prev => ({ ...prev, ...tokens }));
            setOauthStatus('success');
          } catch {
            setOauthStatus('error');
            setOauthError('Token konnte nicht abgerufen werden');
          }
        }
      };
      window.addEventListener('message', handleMessage);

      // Fallback: check if popup was closed without success
      const checkClosed = setInterval(() => {
        if (popup?.closed) {
          clearInterval(checkClosed);
          // Give postMessage a moment to arrive
          setTimeout(() => {
            if (oauthStatus === 'pending') {
              // Try to get result anyway (popup might have closed after success)
              backupApi.getOAuthResult(state).then(tokenRes => {
                const tokens = tokenRes.data;
                setConfig(prev => ({ ...prev, ...tokens }));
                setOauthStatus('success');
                window.removeEventListener('message', handleMessage);
              }).catch(() => {
                setOauthStatus('idle');
                window.removeEventListener('message', handleMessage);
              });
            }
          }, 1000);
        }
      }, 500);
    } catch (error: any) {
      setOauthStatus('error');
      setOauthError(error.response?.data?.error || error.message);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await backupApi.testConfig(type, config);
      setTestResult(res.data);
    } catch (error: any) {
      setTestResult({ success: false, message: error.response?.data?.message || error.message });
    }
    setTesting(false);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave({ name, type, config });
      onClose();
    } catch {
      setSaving(false);
    }
  };

  const shouldShow = (field: FieldDef) => {
    if (!field.showWhen) return true;
    return Object.entries(field.showWhen).every(([key, val]) => config[key] === val);
  };

  const getOAuthLabel = () => {
    switch (type) {
      case 'onedrive': return 'Mit Microsoft anmelden';
      case 'gdrive': return 'Mit Google anmelden';
      case 'dropbox': return 'Mit Dropbox anmelden';
      default: return 'Anmelden';
    }
  };

  const getOAuthColor = () => {
    switch (type) {
      case 'onedrive': return 'bg-[#0078d4] hover:bg-[#006cbe]';
      case 'gdrive': return 'bg-[#4285f4] hover:bg-[#3574d4]';
      case 'dropbox': return 'bg-[#0061fe] hover:bg-[#0050d4]';
      default: return 'bg-blue-600 hover:bg-blue-700';
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="p-6 border-b">
          <h3 className="text-lg font-semibold">{target ? 'Backup-Ziel bearbeiten' : 'Neues Backup-Ziel'}</h3>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
            <input type="text" value={name} onChange={e => setName(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg" placeholder="z.B. Office NAS" />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Typ</label>
            <select value={type} onChange={e => handleTypeChange(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg" disabled={!!target}>
              {Object.entries(PROVIDER_TYPES).map(([key, val]) => (
                <option key={key} value={key}>{val.label}</option>
              ))}
            </select>
          </div>

          <div className="border-t pt-4">
            <h4 className="text-sm font-medium text-gray-700 mb-3">Konfiguration</h4>
            <div className="space-y-3">
              {providerDef?.fields.filter(shouldShow).map(field => (
                <div key={field.name}>
                  <label className="block text-sm text-gray-600 mb-1">
                    {field.label} {field.required && <span className="text-red-500">*</span>}
                  </label>
                  {field.type === 'select' ? (
                    <select value={config[field.name] || field.default || ''}
                      onChange={e => updateConfig(field.name, e.target.value)}
                      className="w-full px-3 py-2 border rounded-lg text-sm">
                      {field.options?.map(opt => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  ) : field.type === 'textarea' ? (
                    <textarea value={config[field.name] || ''}
                      onChange={e => updateConfig(field.name, e.target.value)}
                      className="w-full px-3 py-2 border rounded-lg text-sm font-mono" rows={4}
                      placeholder={field.placeholder} />
                  ) : field.type === 'checkbox' ? (
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={!!config[field.name]}
                        onChange={e => updateConfig(field.name, e.target.checked)}
                        className="rounded" />
                      <span className="text-sm text-gray-600">Aktiviert</span>
                    </label>
                  ) : (
                    <input type={field.type} value={config[field.name] || ''}
                      onChange={e => updateConfig(field.name, field.type === 'number' ? parseInt(e.target.value) || '' : e.target.value)}
                      className="w-full px-3 py-2 border rounded-lg text-sm"
                      placeholder={field.placeholder} />
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* OAuth Login Button */}
          {isOAuthProvider && (
            <div className="border-t pt-4">
              <h4 className="text-sm font-medium text-gray-700 mb-3">Kontoverknüpfung</h4>
              {hasOAuthTokens && oauthStatus !== 'pending' ? (
                <div className="flex items-center gap-2 p-3 bg-green-50 rounded-lg text-sm text-green-700 mb-3">
                  <Check size={16} /> Konto verknüpft
                </div>
              ) : null}
              <button onClick={handleOAuthLogin} disabled={oauthStatus === 'pending'}
                className={`w-full flex items-center justify-center gap-2 px-4 py-2.5 text-white rounded-lg text-sm font-medium disabled:opacity-50 ${getOAuthColor()}`}>
                {oauthStatus === 'pending' ? (
                  <><RefreshCw size={16} className="animate-spin" /> Warte auf Anmeldung...</>
                ) : (
                  <>{hasOAuthTokens ? 'Erneut anmelden' : getOAuthLabel()}</>
                )}
              </button>
              {oauthStatus === 'success' && (
                <div className="mt-2 p-3 bg-green-50 text-green-700 rounded-lg text-sm flex items-center gap-2">
                  <Check size={14} /> Anmeldung erfolgreich! Tokens wurden übernommen.
                </div>
              )}
              {oauthStatus === 'error' && oauthError && (
                <div className="mt-2 p-3 bg-red-50 text-red-700 rounded-lg text-sm flex items-center gap-2">
                  <X size={14} /> {oauthError}
                </div>
              )}
            </div>
          )}

          {/* Test */}
          <div className="border-t pt-4">
            <button onClick={handleTest} disabled={testing}
              className="flex items-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm disabled:opacity-50">
              {testing ? <RefreshCw size={16} className="animate-spin" /> : <TestTube size={16} />}
              {testing ? 'Teste...' : 'Verbindung testen'}
            </button>
            {testResult && (
              <div className={`mt-2 p-3 rounded-lg text-sm ${testResult.success ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                {testResult.success ? <Check size={14} className="inline mr-1" /> : <X size={14} className="inline mr-1" />}
                {testResult.message}
              </div>
            )}
          </div>
        </div>

        <div className="p-6 border-t flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 border rounded-lg hover:bg-gray-50">Abbrechen</button>
          <button onClick={handleSave} disabled={!name || saving}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
            {saving ? 'Speichern...' : 'Speichern'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ==================== Main Component ====================
export default function BackupSettings() {
  const queryClient = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [editTarget, setEditTarget] = useState<any>(null);
  const [historyPage, setHistoryPage] = useState(1);
  const [savingSettings, setSavingSettings] = useState(false);

  // Queries
  const { data: status } = useQuery({
    queryKey: ['backupStatus'],
    queryFn: () => backupApi.getStatus().then(r => r.data),
    refetchInterval: 5000,
  });

  const { data: targets, refetch: refetchTargets } = useQuery({
    queryKey: ['backupTargets'],
    queryFn: () => backupApi.getTargets().then(r => r.data),
  });

  const { data: history, refetch: refetchHistory } = useQuery({
    queryKey: ['backupHistory', historyPage],
    queryFn: () => backupApi.getHistory({ page: historyPage, limit: 10 }).then(r => r.data),
  });

  const { data: backupSettings, refetch: refetchSettings } = useQuery({
    queryKey: ['backupSettings'],
    queryFn: () => backupApi.getSettings().then(r => r.data),
  });

  const [bsFrequency, setBsFrequency] = useState('');
  const [bsTime, setBsTime] = useState('');
  const [bsWeekday, setBsWeekday] = useState(1);
  const [bsRetention, setBsRetention] = useState(30);

  // Sync local state with loaded settings
  useState(() => { /* init handled via useEffect below */ });
  const settingsLoaded = backupSettings && !bsFrequency;
  if (settingsLoaded) {
    setBsFrequency(backupSettings.backupFrequency);
    setBsTime(backupSettings.backupTime);
    setBsWeekday(backupSettings.backupWeekday);
    setBsRetention(backupSettings.backupRetentionDays);
  }

  const handleSaveSettings = async () => {
    setSavingSettings(true);
    try {
      await backupApi.updateSettings({
        backupFrequency: bsFrequency,
        backupTime: bsTime,
        backupWeekday: bsWeekday,
        backupRetentionDays: bsRetention,
      });
      refetchSettings();
      queryClient.invalidateQueries({ queryKey: ['backupStatus'] });
    } catch {}
    setSavingSettings(false);
  };

  // Mutations
  const runBackupMut = useMutation({
    mutationFn: () => backupApi.runBackup(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['backupStatus'] });
      queryClient.invalidateQueries({ queryKey: ['backupHistory'] });
    },
  });

  const deleteTargetMut = useMutation({
    mutationFn: (id: string) => backupApi.deleteTarget(id),
    onSuccess: () => refetchTargets(),
  });

  const testTargetMut = useMutation({
    mutationFn: (id: string) => backupApi.testTarget(id),
    onSuccess: () => refetchTargets(),
  });

  const deleteRecordMut = useMutation({
    mutationFn: (id: string) => backupApi.deleteRecord(id),
    onSuccess: () => refetchHistory(),
  });

  const handleSaveTarget = async (data: any) => {
    if (editTarget?.id) {
      await backupApi.updateTarget(editTarget.id, data);
    } else {
      await backupApi.createTarget(data);
    }
    refetchTargets();
  };

  const handleEditTarget = async (target: any) => {
    try {
      const res = await backupApi.getTargetConfig(target.id);
      setEditTarget(res.data);
      setShowModal(true);
    } catch {
      setEditTarget(target);
      setShowModal(true);
    }
  };

  const handleDownload = async (recordId: string, filename: string) => {
    try {
      const res = await backupApi.downloadBackup(recordId);
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch {}
  };

  const getProviderIcon = (type: string) => {
    const Icon = PROVIDER_TYPES[type]?.icon || Database;
    return <Icon size={16} />;
  };

  return (
    <div className="space-y-6">
      {/* Status */}
      <div className="card p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-lg bg-blue-100">
              <Database className="w-6 h-6 text-blue-600" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900">Backup-Status</h3>
              <p className="text-sm text-gray-500">
                {status?.activeTargets || 0} aktive Ziele | Nächstes Backup: {status?.nextScheduled || '02:00 Uhr'}
              </p>
            </div>
          </div>
          <button
            onClick={() => runBackupMut.mutate()}
            disabled={runBackupMut.isPending || status?.isRunning}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm"
          >
            {(runBackupMut.isPending || status?.isRunning) ? (
              <><RefreshCw size={16} className="animate-spin" /> Läuft...</>
            ) : (
              <><Play size={16} /> Backup jetzt</>
            )}
          </button>
        </div>
        {status?.lastBackup && (
          <div className="bg-gray-50 rounded-lg p-3 text-sm">
            <span className="text-gray-500">Letztes Backup:</span>{' '}
            <span className="font-medium">{formatDateTime(status.lastBackup.completedAt)}</span>
            <span className="text-gray-400 mx-2">|</span>
            <span className="text-gray-500">{formatFileSize(status.lastBackup.fileSize)}</span>
            <span className="text-gray-400 mx-2">|</span>
            <span className="text-gray-500">{status.lastBackup.targetName}</span>
          </div>
        )}
        {runBackupMut.isSuccess && (
          <div className="mt-3 p-3 bg-green-50 text-green-700 rounded-lg text-sm flex items-center gap-2">
            <Check size={16} /> Backup erfolgreich erstellt
          </div>
        )}
        {runBackupMut.isError && (
          <div className="mt-3 p-3 bg-red-50 text-red-700 rounded-lg text-sm flex items-center gap-2">
            <X size={16} /> {(runBackupMut.error as any)?.response?.data?.error || 'Backup fehlgeschlagen'}
          </div>
        )}
      </div>

      {/* Backup-Einstellungen */}
      {bsFrequency && (
        <div className="card p-6">
          <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <Clock size={18} /> Zeitplan & Aufbewahrung
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Häufigkeit</label>
              <select value={bsFrequency} onChange={e => setBsFrequency(e.target.value)}
                className="w-full px-3 py-2 border rounded-lg text-sm">
                <option value="hourly">Stündlich</option>
                <option value="daily">Täglich</option>
                <option value="weekly">Wöchentlich</option>
              </select>
            </div>
            {bsFrequency !== 'hourly' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Uhrzeit</label>
                <input type="time" value={bsTime} onChange={e => setBsTime(e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg text-sm" />
              </div>
            )}
            {bsFrequency === 'weekly' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Wochentag</label>
                <select value={bsWeekday} onChange={e => setBsWeekday(parseInt(e.target.value))}
                  className="w-full px-3 py-2 border rounded-lg text-sm">
                  <option value={1}>Montag</option>
                  <option value={2}>Dienstag</option>
                  <option value={3}>Mittwoch</option>
                  <option value={4}>Donnerstag</option>
                  <option value={5}>Freitag</option>
                  <option value={6}>Samstag</option>
                  <option value={0}>Sonntag</option>
                </select>
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Aufbewahrung (Tage)</label>
              <input type="number" min={1} max={365} value={bsRetention}
                onChange={e => setBsRetention(parseInt(e.target.value) || 30)}
                className="w-full px-3 py-2 border rounded-lg text-sm" />
            </div>
          </div>
          <div className="mt-4 flex justify-end">
            <button onClick={handleSaveSettings} disabled={savingSettings}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm disabled:opacity-50">
              {savingSettings ? 'Speichern...' : 'Einstellungen speichern'}
            </button>
          </div>
        </div>
      )}

      {/* Backup-Ziele */}
      <div className="card">
        <div className="p-6 border-b flex items-center justify-between">
          <h3 className="font-semibold text-gray-900">Backup-Ziele</h3>
          <button onClick={() => { setEditTarget(null); setShowModal(true); }}
            className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm">
            <Plus size={16} /> Neues Ziel
          </button>
        </div>
        {targets?.length ? (
          <div className="divide-y">
            {targets.map((target: any) => (
              <div key={target.id} className="p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-lg ${target.isActive ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-400'}`}>
                    {getProviderIcon(target.type)}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-gray-900">{target.name}</p>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                        {PROVIDER_TYPES[target.type]?.label || target.type}
                      </span>
                      {!target.isActive && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700">Inaktiv</span>
                      )}
                    </div>
                    {target.lastTestAt && (
                      <p className="text-xs text-gray-500">
                        Letzter Test: {formatDateTime(target.lastTestAt)}
                        {target.lastTestOk ? (
                          <span className="ml-1 text-green-600">OK</span>
                        ) : (
                          <span className="ml-1 text-red-600">Fehler</span>
                        )}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => testTargetMut.mutate(target.id)} title="Verbindung testen"
                    className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg">
                    <TestTube size={16} />
                  </button>
                  <button onClick={() => handleEditTarget(target)} title="Bearbeiten"
                    className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-50 rounded-lg">
                    <Clock size={16} />
                  </button>
                  <button onClick={() => { if (confirm('Backup-Ziel wirklich löschen?')) deleteTargetMut.mutate(target.id); }}
                    title="Löschen"
                    className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg">
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-8 text-center text-gray-500">
            Keine Backup-Ziele konfiguriert. Backups werden nur lokal gespeichert.
          </div>
        )}
      </div>

      {/* Backup-Verlauf */}
      <div className="card">
        <div className="p-6 border-b">
          <h3 className="font-semibold text-gray-900">Backup-Verlauf</h3>
        </div>
        {history?.records?.length ? (
          <>
            <div className="divide-y">
              {history.records.map((record: any) => (
                <div key={record.id} className="p-4 flex items-center justify-between">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={`p-2 rounded-lg shrink-0 ${
                      record.status === 'success' ? 'bg-green-100 text-green-600' :
                      record.status === 'failed' ? 'bg-red-100 text-red-600' :
                      'bg-yellow-100 text-yellow-600'
                    }`}>
                      {record.status === 'success' ? <Check size={16} /> :
                       record.status === 'failed' ? <X size={16} /> :
                       <RefreshCw size={16} className="animate-spin" />}
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium text-gray-900 text-sm truncate">{record.filename}</p>
                      <p className="text-xs text-gray-500">
                        {formatDateTime(record.startedAt)}
                        <span className="mx-1">|</span>
                        {formatFileSize(record.fileSize)}
                        <span className="mx-1">|</span>
                        {record.trigger === 'scheduled' ? 'Geplant' : 'Manuell'}
                        {record.target && (
                          <><span className="mx-1">|</span>{record.target.name}</>
                        )}
                      </p>
                      {record.status === 'failed' && record.errorMessage && (
                        <p className="text-xs text-red-600 mt-0.5 flex items-center gap-1">
                          <AlertTriangle size={12} /> {record.errorMessage}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {record.status === 'success' && (
                      <button onClick={() => handleDownload(record.id, record.filename)} title="Herunterladen"
                        className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg">
                        <Download size={16} />
                      </button>
                    )}
                    <button onClick={() => { if (confirm('Backup-Eintrag löschen?')) deleteRecordMut.mutate(record.id); }}
                      title="Löschen"
                      className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg">
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
            {/* Pagination */}
            {history.totalPages > 1 && (
              <div className="p-4 border-t flex items-center justify-between text-sm">
                <span className="text-gray-500">
                  Seite {history.page} von {history.totalPages} ({history.total} Einträge)
                </span>
                <div className="flex gap-2">
                  <button onClick={() => setHistoryPage(p => Math.max(1, p - 1))}
                    disabled={historyPage <= 1}
                    className="p-1 rounded hover:bg-gray-100 disabled:opacity-30">
                    <ChevronLeft size={20} />
                  </button>
                  <button onClick={() => setHistoryPage(p => Math.min(history.totalPages, p + 1))}
                    disabled={historyPage >= history.totalPages}
                    className="p-1 rounded hover:bg-gray-100 disabled:opacity-30">
                    <ChevronRight size={20} />
                  </button>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="p-8 text-center text-gray-500">Noch keine Backups vorhanden</div>
        )}
      </div>

      {/* Modal */}
      {showModal && (
        <TargetModal
          target={editTarget}
          onClose={() => { setShowModal(false); setEditTarget(null); }}
          onSave={handleSaveTarget}
        />
      )}
    </div>
  );
}
