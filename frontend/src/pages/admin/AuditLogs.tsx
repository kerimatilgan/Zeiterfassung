import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  FileText,
  Search,
  Filter,
  ChevronLeft,
  ChevronRight,
  Clock,
  User,
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
      return <LogIn className="w-4 h-4 text-green-600" />;
    case 'LOGOUT':
      return <LogOut className="w-4 h-4 text-gray-600" />;
    case 'LOGIN_FAILED':
      return <XCircle className="w-4 h-4 text-red-600" />;
    case 'CLOCK_IN':
      return <Clock className="w-4 h-4 text-blue-600" />;
    case 'CLOCK_OUT':
      return <Clock className="w-4 h-4 text-orange-600" />;
    case 'CREATE':
      return <Plus className="w-4 h-4 text-green-600" />;
    case 'UPDATE':
      return <Pencil className="w-4 h-4 text-blue-600" />;
    case 'DELETE':
      return <Trash2 className="w-4 h-4 text-red-600" />;
    case 'FINALIZE':
      return <CheckCircle className="w-4 h-4 text-purple-600" />;
    case 'PASSWORD_CHANGE':
      return <Key className="w-4 h-4 text-yellow-600" />;
    case 'DB_BACKUP':
      return <Database className="w-4 h-4 text-blue-600" />;
    case 'DB_RESTORE':
      return <Database className="w-4 h-4 text-orange-600" />;
    default:
      return <FileText className="w-4 h-4 text-gray-600" />;
  }
};

const getActionBadgeColor = (action: string) => {
  switch (action) {
    case 'LOGIN':
    case 'CREATE':
      return 'bg-green-100 text-green-800';
    case 'LOGOUT':
      return 'bg-gray-100 text-gray-800';
    case 'LOGIN_FAILED':
    case 'DELETE':
      return 'bg-red-100 text-red-800';
    case 'CLOCK_IN':
    case 'UPDATE':
    case 'DB_BACKUP':
      return 'bg-blue-100 text-blue-800';
    case 'CLOCK_OUT':
    case 'DB_RESTORE':
      return 'bg-orange-100 text-orange-800';
    case 'FINALIZE':
      return 'bg-purple-100 text-purple-800';
    case 'PASSWORD_CHANGE':
      return 'bg-yellow-100 text-yellow-800';
    default:
      return 'bg-gray-100 text-gray-800';
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

  const formatDateTime = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleString('de-DE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

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
        if (val === null || val === undefined) return <span className="text-gray-400">-</span>;
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
          <div key={key} className="py-1 border-b border-gray-100 last:border-0">
            <span className="font-medium text-gray-700">{key}:</span>
            {oldVal !== undefined && (
              <span className="ml-2 text-red-600 line-through">{formatValue(oldVal)}</span>
            )}
            {newVal !== undefined && (
              <span className="ml-2 text-green-600">{formatValue(newVal)}</span>
            )}
          </div>
        );
      }
    });

    if (changes.length === 0) return null;

    return <div className="text-sm mt-2">{changes}</div>;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Shield className="w-8 h-8 text-indigo-600" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Audit-Log</h1>
            <p className="text-gray-600">Protokoll aller Systemaktivitäten</p>
          </div>
        </div>
      </div>

      {/* Statistiken */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <div className="bg-white rounded-lg shadow p-4">
            <div className="text-2xl font-bold text-gray-900">{stats.totalLogs}</div>
            <div className="text-sm text-gray-600">Gesamt</div>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <div className="text-2xl font-bold text-blue-600">{stats.logsToday}</div>
            <div className="text-sm text-gray-600">Heute</div>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <div className="text-2xl font-bold text-indigo-600">{stats.logsThisWeek}</div>
            <div className="text-sm text-gray-600">Diese Woche</div>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <div className="text-2xl font-bold text-green-600">{stats.loginsToday}</div>
            <div className="text-sm text-gray-600">Logins heute</div>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <div className="text-2xl font-bold text-red-600">{stats.failedLoginsToday}</div>
            <div className="text-sm text-gray-600 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" />
              Fehlversuche heute
            </div>
          </div>
        </div>
      )}

      {/* Filter */}
      <div className="bg-white rounded-lg shadow">
        <div className="p-4 border-b border-gray-200">
          <div className="flex items-center gap-4">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                type="text"
                placeholder="Suchen..."
                value={filters.search}
                onChange={(e) => {
                  setFilters((f) => ({ ...f, search: e.target.value }));
                  setPage(1);
                }}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              />
            </div>
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`flex items-center gap-2 px-4 py-2 border rounded-lg transition-colors ${
                showFilters ? 'bg-indigo-50 border-indigo-300 text-indigo-700' : 'border-gray-300 text-gray-700 hover:bg-gray-50'
              }`}
            >
              <Filter className="w-5 h-5" />
              Filter
            </button>
          </div>

          {showFilters && (
            <div className="mt-4 grid grid-cols-2 md:grid-cols-5 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Aktion</label>
                <select
                  value={filters.action}
                  onChange={(e) => {
                    setFilters((f) => ({ ...f, action: e.target.value }));
                    setPage(1);
                  }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="">Alle</option>
                  {filterOptions?.actions.map((a) => (
                    <option key={a.value} value={a.value}>
                      {a.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Bereich</label>
                <select
                  value={filters.entityType}
                  onChange={(e) => {
                    setFilters((f) => ({ ...f, entityType: e.target.value }));
                    setPage(1);
                  }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="">Alle</option>
                  {filterOptions?.entityTypes.map((e) => (
                    <option key={e.value} value={e.value}>
                      {e.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Benutzer</label>
                <select
                  value={filters.userId}
                  onChange={(e) => {
                    setFilters((f) => ({ ...f, userId: e.target.value }));
                    setPage(1);
                  }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="">Alle</option>
                  {filterOptions?.users.map((u) => (
                    <option key={u.value} value={u.value}>
                      {u.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Von</label>
                <input
                  type="date"
                  value={filters.from}
                  onChange={(e) => {
                    setFilters((f) => ({ ...f, from: e.target.value }));
                    setPage(1);
                  }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Bis</label>
                <input
                  type="date"
                  value={filters.to}
                  onChange={(e) => {
                    setFilters((f) => ({ ...f, to: e.target.value }));
                    setPage(1);
                  }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>
          )}
        </div>

        {/* Log-Liste */}
        <div className="divide-y divide-gray-200">
          {isLoading ? (
            <div className="p-8 text-center text-gray-500">Lade Audit-Logs...</div>
          ) : logsData?.logs?.length === 0 ? (
            <div className="p-8 text-center text-gray-500">Keine Einträge gefunden</div>
          ) : (
            logsData?.logs?.map((log: AuditLog) => (
              <div
                key={log.id}
                className="p-4 hover:bg-gray-50 cursor-pointer transition-colors"
                onClick={() => setSelectedLog(selectedLog?.id === log.id ? null : log)}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3">
                    <div className="mt-1">{getActionIcon(log.action)}</div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span
                          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getActionBadgeColor(
                            log.action
                          )}`}
                        >
                          {log.actionFormatted}
                        </span>
                        <span className="text-sm text-gray-600">{log.entityTypeFormatted}</span>
                        {log.entityId && (
                          <span className="text-xs text-gray-400 font-mono">{log.entityId.substring(0, 8)}...</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-1 text-sm text-gray-500">
                        {log.userName ? (
                          <span className="flex items-center gap-1">
                            <User className="w-3 h-3" />
                            {log.userName}
                          </span>
                        ) : (
                          <span className="text-gray-400">System</span>
                        )}
                        {log.note && (
                          <span className="text-gray-400">· {log.note}</span>
                        )}
                      </div>
                      {selectedLog?.id === log.id && (
                        <div className="mt-3 p-3 bg-gray-50 rounded-lg">
                          {log.ipAddress && (
                            <div className="text-xs text-gray-500 mb-2">
                              IP: {log.ipAddress}
                            </div>
                          )}
                          {renderChanges(log.oldValues, log.newValues)}
                          {!log.oldValues && !log.newValues && (
                            <div className="text-sm text-gray-500">Keine Details verfügbar</div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-gray-500">
                    <Clock className="w-4 h-4" />
                    {formatDateTime(log.timestamp)}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Pagination */}
        {logsData?.pagination && logsData.pagination.totalPages > 1 && (
          <div className="p-4 border-t border-gray-200 flex items-center justify-between">
            <div className="text-sm text-gray-600">
              Seite {logsData.pagination.page} von {logsData.pagination.totalPages} ({logsData.pagination.total}{' '}
              Einträge)
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="p-2 rounded-lg border border-gray-300 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <button
                onClick={() => setPage((p) => Math.min(logsData.pagination.totalPages, p + 1))}
                disabled={page === logsData.pagination.totalPages}
                className="p-2 rounded-lg border border-gray-300 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
