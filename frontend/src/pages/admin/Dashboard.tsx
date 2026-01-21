import { useQuery } from '@tanstack/react-query';
import { settingsApi, timeEntriesApi } from '../../lib/api';
import { Users, Clock, FileText, TrendingUp, UserCheck } from 'lucide-react';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';

export default function AdminDashboard() {
  const { data: stats } = useQuery({
    queryKey: ['dashboardStats'],
    queryFn: () => settingsApi.getDashboardStats().then((r) => r.data),
  });

  const { data: recentEntries } = useQuery({
    queryKey: ['timeEntries', 'recent'],
    queryFn: () => timeEntriesApi.getAll({ limit: '10' } as any).then((r) => r.data),
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
