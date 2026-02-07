import { useQuery } from '@tanstack/react-query';
import { settingsApi, timeEntriesApi } from '../../lib/api';
import { Users, Clock, FileText, TrendingUp, UserCheck, AlertTriangle, ChevronRight } from 'lucide-react';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import { useNavigate } from 'react-router-dom';

export default function AdminDashboard() {
  const navigate = useNavigate();

  const { data: stats } = useQuery({
    queryKey: ['dashboardStats'],
    queryFn: () => settingsApi.getDashboardStats().then((r) => r.data),
  });

  const { data: recentEntries } = useQuery({
    queryKey: ['timeEntries', 'recent'],
    queryFn: () => timeEntriesApi.getAll({ limit: '10' } as any).then((r) => r.data),
  });

  const { data: pendingComplaints } = useQuery({
    queryKey: ['pendingComplaints'],
    queryFn: () => timeEntriesApi.getPendingComplaints(5).then((r) => r.data),
    refetchInterval: 30000,
  });

  const statCards = [
    {
      label: 'Aktive Mitarbeiter',
      value: stats?.activeEmployees ?? '-',
      icon: Users,
      color: 'bg-blue-500',
    },
    {
      label: 'Aktuell eingestempelt',
      value: stats?.currentlyClockedIn ?? '-',
      icon: UserCheck,
      color: 'bg-green-500',
    },
    {
      label: 'Einträge heute',
      value: stats?.entriesToday ?? '-',
      icon: Clock,
      color: 'bg-orange-500',
    },
    {
      label: 'Offene Abrechnungen',
      value: stats?.pendingReports ?? '-',
      icon: FileText,
      color: 'bg-purple-500',
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Admin Dashboard</h1>
        <p className="text-gray-500">Übersicht der Zeiterfassung</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((stat) => (
          <div key={stat.label} className="card p-6">
            <div className="flex items-center gap-4">
              <div className={`p-3 rounded-lg ${stat.color}`}>
                <stat.icon className="w-6 h-6 text-white" />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900">{stat.value}</p>
                <p className="text-sm text-gray-500">{stat.label}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Offene Reklamationen Widget */}
      {pendingComplaints && pendingComplaints.count > 0 && (
        <div className="card border-2 border-orange-200 bg-orange-50">
          <div className="p-4 border-b border-orange-200 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-orange-800 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5" />
              Offene Reklamationen
              <span className="ml-2 px-2 py-0.5 text-sm bg-orange-500 text-white rounded-full">
                {pendingComplaints.count}
              </span>
            </h2>
          </div>
          <div className="divide-y divide-orange-200">
            {pendingComplaints.entries.map((entry: any) => (
              <div
                key={entry.id}
                className="p-4 hover:bg-orange-100 cursor-pointer transition-colors"
                onClick={() => navigate(`/admin/employees?openEmployee=${entry.employeeId}&entryId=${entry.id}&date=${entry.clockIn}`)}
              >
                <div className="flex items-start gap-3">
                  {/* Avatar */}
                  <div className="flex-shrink-0">
                    {entry.employee.photoUrl ? (
                      <img
                        src={entry.employee.photoUrl}
                        alt=""
                        className="w-10 h-10 rounded-full object-cover"
                      />
                    ) : (
                      <div className="w-10 h-10 rounded-full bg-orange-200 flex items-center justify-center text-orange-700 font-medium">
                        {entry.employee.firstName[0]}{entry.employee.lastName[0]}
                      </div>
                    )}
                  </div>
                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <p className="font-medium text-gray-900">
                        {entry.employee.firstName} {entry.employee.lastName}
                      </p>
                      <ChevronRight className="w-4 h-4 text-gray-400" />
                    </div>
                    <p className="text-sm text-gray-600">
                      {format(new Date(entry.clockIn), 'dd.MM.yyyy', { locale: de })} • {format(new Date(entry.clockIn), 'HH:mm', { locale: de })}
                      {entry.clockOut && ` - ${format(new Date(entry.clockOut), 'HH:mm', { locale: de })}`}
                    </p>
                    <p className="text-sm text-orange-700 mt-1 truncate">
                      "{entry.complaintMessage}"
                    </p>
                    <p className="text-xs text-gray-500 mt-1">
                      Reklamiert {format(new Date(entry.complaintAt), "dd.MM.yyyy 'um' HH:mm", { locale: de })}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
          {pendingComplaints.count > 5 && (
            <div className="p-3 border-t border-orange-200 text-center">
              <button
                onClick={() => navigate('/admin/employees')}
                className="text-sm text-orange-700 hover:text-orange-900 font-medium"
              >
                Alle {pendingComplaints.count} Reklamationen anzeigen →
              </button>
            </div>
          )}
        </div>
      )}

      {/* Recent Activity */}
      <div className="card">
        <div className="p-6 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <TrendingUp size={20} />
            Letzte Aktivitäten
          </h2>
        </div>
        <div className="divide-y divide-gray-100">
          {recentEntries?.length ? (
            recentEntries.map((entry: any) => (
              <div key={entry.id} className="p-4 flex items-center justify-between">
                <div>
                  <p className="font-medium text-gray-900">
                    {entry.employee.firstName} {entry.employee.lastName}
                  </p>
                  <p className="text-sm text-gray-500">
                    {format(new Date(entry.clockIn), 'dd.MM.yyyy HH:mm', { locale: de })}
                    {entry.clockOut && (
                      <> - {format(new Date(entry.clockOut), 'HH:mm', { locale: de })}</>
                    )}
                  </p>
                </div>
                <span
                  className={`px-3 py-1 rounded-full text-sm font-medium ${
                    entry.clockOut
                      ? 'bg-gray-100 text-gray-600'
                      : 'bg-green-100 text-green-700'
                  }`}
                >
                  {entry.clockOut ? 'Abgeschlossen' : 'Aktiv'}
                </span>
              </div>
            ))
          ) : (
            <div className="p-8 text-center text-gray-500">
              Keine Einträge vorhanden
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
