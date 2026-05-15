import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  FileText,
  Search,
  Filter,
  ChevronLeft,
  ChevronRight,
  Clock,
  Shield,
  LogIn,
  LogOut,
  Plus,
  Pencil,
  Trash2,
  Database,
  Key,
  AlertTriangle,
  CheckCircle,
  XCircle,
} from 'lucide-react';
import { auditLogsApi } from '../../lib/api';

interface AuditLog {
  id: string;
  timestamp: string;
  userId: string | null;
  userName: string | null;
  action: string;
  actionFormatted: string;
  entityType: string;
  entityTypeFormatted: string;
  entityId: string | null;
  oldValues: any | null;
  newValues: any | null;
  ipAddress: string | null;
  userAgent: string | null;
  note: string | null;
}

interface FilterOptions {
  actions: { value: string; label: string }[];
  entityTypes: { value: string; label: string }[];
  users: { value: string; label: string }[];
}

const getActionIcon = (action: string) => {
  switch (action) {
    case 'LOGIN':
      return <LogIn className="w-4 h-4 text-green-600 dark:text-green-400" />;
    case 'LOGOUT':
      return <LogOut className="w-4 h-4 text-gray-600 dark:text-gray-400" />;
    case 'LOGIN_FAILED':
      return <XCircle className="w-4 h-4 text-red-600 dark:text-red-400" />;
    case 'CLOCK_IN':
      return <Clock className="w-4 h-4 text-blue-600 dark:text-blue-400" />;
    case 'CLOCK_OUT':
      return <Clock className="w-4 h-4 text-orange-600 dark:text-orange-400" />;
    case 'CREATE':
      return <Plus className="w-4 h-4 text-green-600 dark:text-green-400" />;
    case 'UPDATE':
      return <Pencil className="w-4 h-4 text-blue-600 dark:text-blue-400" />;
    case 'DELETE':
      return <Trash2 className="w-4 h-4 text-red-600 dark:text-red-400" />;
    case 'FINALIZE':
      return <CheckCircle className="w-4 h-4 text-purple-600 dark:text-purple-400" />;
    case 'PASSWORD_CHANGE':
      return <Key className="w-4 h-4 text-yellow-600 dark:text-yellow-400" />;
    case 'DB_BACKUP':
      return <Database className="w-4 h-4 text-blue-600 dark:text-blue-400" />;
    case 'DB_RESTORE':
      return <Database className="w-4 h-4 text-orange-600 dark:text-orange-400" />;
    default:
      return <FileText className="w-4 h-4 text-gray-600 dark:text-gray-400" />;
  }
};

const getActionBadgeColor = (action: string) => {
  switch (action) {
    case 'LOGIN':
    case 'CREATE':
      return 'bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-300';
    case 'LOGOUT':
      return 'bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200';
    case 'LOGIN_FAILED':
    case 'DELETE':
      return 'bg-red-100 dark:bg-red-900/40 text-red-800 dark:text-red-300';
    case 'CLOCK_IN':
    case 'UPDATE':
    case 'DB_BACKUP':
      return 'bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-300';
    case 'CLOCK_OUT':
    case 'DB_RESTORE':
      return 'bg-orange-100 dark:bg-orange-900/40 text-orange-800 dark:text-orange-300';
    case 'FINALIZE':
      return 'bg-purple-100 dark:bg-purple-900/40 text-purple-800 dark:text-purple-300';
    case 'PASSWORD_CHANGE':
      return 'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-800 dark:text-yellow-300';
    default:
      return 'bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200';
  }
};

export default function AuditLogs() {
  const [page, setPage] = useState(1);
  const [limit] = useState(25);
  const [filters, setFilters] = useState({
    action: '',
    entityType: '',
    userId: '',
    search: '',
    from: '',
    to: '',
  });
  const [showFilters, setShowFilters] = useState(false);
  const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null);

  // Logs abrufen
  const { data: logsData, isLoading } = useQuery({
    queryKey: ['audit-logs', page, limit, filters],
    queryFn: async () => {
      const params: any = { page, limit };
      if (filters.action) params.action = filters.action;
      if (filters.entityType) params.entityType = filters.entityType;
      if (filters.userId) params.userId = filters.userId;
      if (filters.search) params.search = filters.search;
      if (filters.from) params.from = filters.from;
      if (filters.to) params.to = filters.to;
      const response = await auditLogsApi.getAll(params);
      return response.data;
    },
  });

  // Filter-Optionen abrufen
  const { data: filterOptions } = useQuery<FilterOptions>({
    queryKey: ['audit-log-filters'],
    queryFn: async () => {
      const response = await auditLogsApi.getFilterOptions();
      return response.data;
    },
  });

  // Statistiken abrufen
  const { data: stats } = useQuery({
    queryKey: ['audit-log-stats'],
    queryFn: async () => {
      const response = await auditLogsApi.getStats();
      return response.data;
    },
  });


  const renderChanges = (oldValues: any, newValues: any) => {
    if (!oldValues && !newValues) return null;

    const allKeys = new Set([
      ...Object.keys(oldValues || {}),
      ...Object.keys(newValues || {}),
    ]);

    const changes: JSX.Element[] = [];

    allKeys.forEach((key) => {
      const oldVal = oldValues?.[key];
      const newVal = newValues?.[key];

      // Ignoriere timestamps und interne Felder
      if (['createdAt', 'updatedAt', 'passwordHash', 'id'].includes(key)) return;

      const formatValue = (val: any) => {
        if (val === null || val === undefined) return <span className="text-gray-400 dark:text-gray-500">-</span>;
        if (typeof val === 'boolean') return val ? 'Ja' : 'Nein';
        if (val instanceof Date || (typeof val === 'string' && val.match(/^\d{4}-\d{2}-\d{2}/))) {
          try {
            return new Date(val).toLocaleString('de-DE');
          } catch {
            return String(val);
          }
        }
        if (typeof val === 'object') return JSON.stringify(val);
        return String(val);
      };

      const oldValStr = JSON.stringify(oldVal);
      const newValStr = JSON.stringify(newVal);

      if (oldValStr !== newValStr) {
        changes.push(
          <div key={key} className="py-1 border-b border-gray-100 dark:border-gray-800 last:border-0">
            <span className="font-medium text-gray-700 dark:text-gray-300">{key}:</span>
            {oldVal !== undefined && (
              <span className="ml-2 text-red-600 dark:text-red-400 line-through">{formatValue(oldVal)}</span>
            )}
            {newVal !== undefined && (
              <span className="ml-2 text-green-600 dark:text-green-400">{formatValue(newVal)}</span>
            )}
          </div>
        );
      }
    });

    if (changes.length === 0) return null;

    return <div className="text-sm mt-2">{changes}</div>;
  };

  const selectCls =
    'w-full px-3 py-2 bg-surface-container-lowest dark:bg-surface-container border border-outline-variant rounded-lg font-body-md text-body-md text-on-surface focus:outline-none focus:ring-2 focus:ring-primary-container focus:border-transparent transition-shadow';

  return (
    <div className="space-y-stack_lg">
      {/* Header */}
      <header className="flex items-center gap-3">
        <Shield className="w-8 h-8 text-on-surface-variant" />
        <div>
          <h1 className="font-display text-display text-on-surface">Audit-Log</h1>
          <p className="font-body-md text-body-md text-on-surface-variant mt-1">Protokoll aller sicherheitsrelevanten Systemaktivitäten.</p>
        </div>
      </header>

      {/* Statistiken */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-gutter">
          <div className="bg-surface dark:bg-surface-container-high border border-outline-variant rounded-xl shadow-sm p-stack_md">
            <div className="font-stat-number text-stat-number text-on-surface">{stats.totalLogs}</div>
            <div className="font-label-md text-label-md uppercase text-on-surface-variant mt-1">Gesamt</div>
          </div>
          <div className="bg-surface dark:bg-surface-container-high border border-outline-variant rounded-xl shadow-sm p-stack_md">
            <div className="font-stat-number text-stat-number text-blue-600 dark:text-blue-400">{stats.logsToday}</div>
            <div className="font-label-md text-label-md uppercase text-on-surface-variant mt-1">Heute</div>
          </div>
          <div className="bg-surface dark:bg-surface-container-high border border-outline-variant rounded-xl shadow-sm p-stack_md">
            <div className="font-stat-number text-stat-number text-indigo-600 dark:text-indigo-400">{stats.logsThisWeek}</div>
            <div className="font-label-md text-label-md uppercase text-on-surface-variant mt-1">Diese Woche</div>
          </div>
          <div className="bg-surface dark:bg-surface-container-high border border-outline-variant rounded-xl shadow-sm p-stack_md">
            <div className="font-stat-number text-stat-number text-green-600 dark:text-green-400">{stats.loginsToday}</div>
            <div className="font-label-md text-label-md uppercase text-on-surface-variant mt-1">Logins heute</div>
          </div>
          <div className="bg-surface dark:bg-surface-container-high border border-outline-variant rounded-xl shadow-sm p-stack_md">
            <div className="font-stat-number text-stat-number text-red-600 dark:text-red-400">{stats.failedLoginsToday}</div>
            <div className="font-label-md text-label-md uppercase text-on-surface-variant mt-1 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" />
              Fehlversuche heute
            </div>
          </div>
        </div>
      )}

      {/* Filter + Tabelle */}
      <div className="bg-surface dark:bg-surface-container-high border border-outline-variant rounded-xl shadow-sm overflow-hidden">
        <div className="p-stack_md border-b border-outline-variant">
          <div className="flex items-center gap-stack_md">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-on-surface-variant" />
              <input
                type="text"
                placeholder="Suchen…"
                value={filters.search}
                onChange={(e) => {
                  setFilters((f) => ({ ...f, search: e.target.value }));
                  setPage(1);
                }}
                className="w-full pl-10 pr-4 py-2 bg-surface-container-lowest dark:bg-surface-container border border-outline-variant rounded-lg font-body-md text-body-md text-on-surface placeholder:text-on-surface-variant/70 focus:outline-none focus:ring-2 focus:ring-primary-container focus:border-transparent transition-shadow"
              />
            </div>
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg border font-body-md text-body-md font-medium transition-colors ${
                showFilters
                  ? 'bg-secondary-container text-on-secondary-container border-transparent'
                  : 'bg-surface-container dark:bg-surface-container border-outline-variant text-on-surface hover:bg-surface-container-high dark:hover:bg-surface-container-highest'
              }`}
            >
              <Filter className="w-5 h-5" />
              Filter
            </button>
          </div>

          {showFilters && (
            <div className="mt-stack_md grid grid-cols-2 md:grid-cols-5 gap-stack_md">
              <div>
                <label className="font-label-md text-label-md uppercase text-on-surface-variant block mb-1">Aktion</label>
                <select
                  value={filters.action}
                  onChange={(e) => { setFilters((f) => ({ ...f, action: e.target.value })); setPage(1); }}
                  className={selectCls}
                >
                  <option value="">Alle</option>
                  {filterOptions?.actions.map((a) => (
                    <option key={a.value} value={a.value}>{a.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="font-label-md text-label-md uppercase text-on-surface-variant block mb-1">Bereich</label>
                <select
                  value={filters.entityType}
                  onChange={(e) => { setFilters((f) => ({ ...f, entityType: e.target.value })); setPage(1); }}
                  className={selectCls}
                >
                  <option value="">Alle</option>
                  {filterOptions?.entityTypes.map((e) => (
                    <option key={e.value} value={e.value}>{e.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="font-label-md text-label-md uppercase text-on-surface-variant block mb-1">Benutzer</label>
                <select
                  value={filters.userId}
                  onChange={(e) => { setFilters((f) => ({ ...f, userId: e.target.value })); setPage(1); }}
                  className={selectCls}
                >
                  <option value="">Alle</option>
                  {filterOptions?.users.map((u) => (
                    <option key={u.value} value={u.value}>{u.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="font-label-md text-label-md uppercase text-on-surface-variant block mb-1">Von</label>
                <input
                  type="date"
                  value={filters.from}
                  onChange={(e) => { setFilters((f) => ({ ...f, from: e.target.value })); setPage(1); }}
                  className={selectCls}
                />
              </div>
              <div>
                <label className="font-label-md text-label-md uppercase text-on-surface-variant block mb-1">Bis</label>
                <input
                  type="date"
                  value={filters.to}
                  onChange={(e) => { setFilters((f) => ({ ...f, to: e.target.value })); setPage(1); }}
                  className={selectCls}
                />
              </div>
            </div>
          )}
        </div>

        {/* Log-Tabelle */}
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-surface-container-low dark:bg-surface-container border-b border-outline-variant">
              <tr>
                <th className="px-stack_md py-stack_sm font-label-md text-label-md uppercase text-on-surface-variant w-32">Zeitpunkt</th>
                <th className="px-stack_md py-stack_sm font-label-md text-label-md uppercase text-on-surface-variant w-40">Typ</th>
                <th className="px-stack_md py-stack_sm font-label-md text-label-md uppercase text-on-surface-variant w-36">Mitarbeiter</th>
                <th className="px-stack_md py-stack_sm font-label-md text-label-md uppercase text-on-surface-variant">Text</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant">
              {isLoading ? (
                <tr><td colSpan={4} className="p-stack_lg text-center font-body-md text-body-md text-on-surface-variant">Lade Audit-Logs…</td></tr>
              ) : logsData?.logs?.length === 0 ? (
                <tr><td colSpan={4} className="p-stack_lg text-center font-body-md text-body-md text-on-surface-variant">Keine Einträge gefunden</td></tr>
              ) : (
                logsData?.logs?.map((log: AuditLog) => {
                  const isExpanded = selectedLog?.id === log.id;
                  // Beschreibungstext zusammenbauen
                  const buildDescription = () => {
                    const parts: string[] = [];
                    if (log.entityTypeFormatted) parts.push(log.entityTypeFormatted);
                    if (log.note) parts.push(log.note);
                    if (log.ipAddress && log.action === 'LOGIN') parts.push(`(IP: ${log.ipAddress})`);
                    if (log.userAgent && log.action === 'LOGIN') parts.push(`- ${log.userAgent.substring(0, 80)}`);
                    if (parts.length === 0 && log.entityId) parts.push(`ID: ${log.entityId.substring(0, 8)}`);
                    return parts.join(' - ') || log.actionFormatted;
                  };

                  return (
                    <tr key={log.id} className={`cursor-pointer transition-colors ${isExpanded ? 'bg-secondary-container/40 dark:bg-secondary-container/50' : 'hover:bg-surface-container-low dark:hover:bg-surface-container'}`} onClick={() => setSelectedLog(isExpanded ? null : log)}>
                      <td className="px-stack_md py-stack_sm font-body-md text-body-md text-on-surface align-top whitespace-nowrap">
                        <div className="font-medium">{new Date(log.timestamp).toLocaleDateString('de-DE')}</div>
                        <div className="font-label-md text-label-md text-on-surface-variant">{new Date(log.timestamp).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr</div>
                      </td>
                      <td className="px-stack_md py-stack_sm align-top">
                        <div className="flex items-center gap-2">
                          {getActionIcon(log.action)}
                          <span className={`inline-flex items-center px-2 py-0.5 rounded font-label-md text-label-md font-medium ${getActionBadgeColor(log.action)}`}>
                            {log.actionFormatted}
                          </span>
                        </div>
                      </td>
                      <td className="px-stack_md py-stack_sm font-body-md text-body-md text-on-surface align-top">
                        {log.userName || <span className="text-on-surface-variant">System</span>}
                      </td>
                      <td className="px-stack_md py-stack_sm font-body-md text-body-md text-on-surface-variant align-top">
                        <div>{buildDescription()}</div>
                        {isExpanded && (log.oldValues || log.newValues) && (
                          <div className="mt-stack_sm p-stack_sm bg-surface-container-lowest dark:bg-surface-container border border-outline-variant rounded-lg font-label-md text-label-md">
                            {log.ipAddress && <div className="text-on-surface-variant mb-1">IP: {log.ipAddress}</div>}
                            {renderChanges(log.oldValues, log.newValues)}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {logsData?.pagination && (
          <div className="p-stack_md border-t border-outline-variant flex items-center justify-between">
            <div className="font-body-md text-body-md text-on-surface-variant">
              Eintrag {((logsData.pagination.page - 1) * limit) + 1} bis {Math.min(logsData.pagination.page * limit, logsData.pagination.total)} von {logsData.pagination.total}
            </div>
            {logsData.pagination.totalPages > 1 && (
              <div className="flex items-center gap-1">
                <button onClick={() => setPage(1)} disabled={page === 1}
                  className="px-2 py-1 font-body-md text-body-md rounded-lg border border-outline-variant hover:bg-surface-container-low dark:hover:bg-surface-container disabled:opacity-30">1</button>
                <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}
                  className="p-1 rounded-lg border border-outline-variant hover:bg-surface-container-low dark:hover:bg-surface-container disabled:opacity-30">
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="px-3 py-1 font-body-md text-body-md font-medium bg-secondary-container text-on-secondary-container rounded-lg">{page}</span>
                <button onClick={() => setPage((p) => Math.min(logsData.pagination.totalPages, p + 1))} disabled={page === logsData.pagination.totalPages}
                  className="p-1 rounded-lg border border-outline-variant hover:bg-surface-container-low dark:hover:bg-surface-container disabled:opacity-30">
                  <ChevronRight className="w-4 h-4" />
                </button>
                <button onClick={() => setPage(logsData.pagination.totalPages)} disabled={page === logsData.pagination.totalPages}
                  className="px-2 py-1 font-body-md text-body-md rounded-lg border border-outline-variant hover:bg-surface-container-low dark:hover:bg-surface-container disabled:opacity-30">{logsData.pagination.totalPages}</button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
