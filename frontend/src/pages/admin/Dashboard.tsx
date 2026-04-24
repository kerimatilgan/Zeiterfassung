import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { settingsApi, timeEntriesApi } from '../../lib/api';
import { photoSrc } from '../../lib/photoUrl';
import { Users, Clock, FileText, TrendingUp, UserCheck, AlertTriangle, ChevronRight, X } from 'lucide-react';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import { useNavigate } from 'react-router-dom';

export default function AdminDashboard() {
  const navigate = useNavigate();
  const [activeModal, setActiveModal] = useState<'clockedIn' | 'entriesToday' | null>(null);

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

  const { data: clockedInEntries } = useQuery({
    queryKey: ['currentlyClockedIn'],
    queryFn: () => settingsApi.getCurrentlyClockedIn().then((r) => r.data),
    enabled: activeModal === 'clockedIn',
  });

  const { data: todayEntries } = useQuery({
    queryKey: ['entriesToday'],
    queryFn: () => settingsApi.getEntriesToday().then((r) => r.data),
    enabled: activeModal === 'entriesToday',
  });

  const statCards = [
    {
      label: 'Aktive Mitarbeiter',
      value: stats?.activeEmployees ?? '-',
      icon: Users,
      color: 'bg-blue-500',
      onClick: () => navigate('/admin/employees'),
    },
    {
      label: 'Aktuell eingestempelt',
      value: stats?.currentlyClockedIn ?? '-',
      icon: UserCheck,
      color: 'bg-green-500',
      onClick: () => setActiveModal('clockedIn'),
    },
    {
      label: 'Einträge heute',
      value: stats?.entriesToday ?? '-',
      icon: Clock,
      color: 'bg-orange-500',
      onClick: () => setActiveModal('entriesToday'),
    },
    {
      label: 'Offene Abrechnungen',
      value: stats?.pendingReports ?? '-',
      icon: FileText,
      color: 'bg-purple-500',
      onClick: () => navigate('/admin/reports?status=draft'),
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
          <div
            key={stat.label}
            className="card p-6 cursor-pointer hover:shadow-md transition-shadow"
            onClick={stat.onClick}
          >
            <div className="flex items-center gap-4">
              <div className={`p-3 rounded-lg ${stat.color}`}>
                <stat.icon className="w-6 h-6 text-white" />
              </div>
              <div className="flex-1">
                <p className="text-2xl font-bold text-gray-900">{stat.value}</p>
                <p className="text-sm text-gray-500">{stat.label}</p>
              </div>
              <ChevronRight className="w-5 h-5 text-gray-300" />
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
                        src={photoSrc(entry.employee.photoUrl)}
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

      {/* Modal: Aktuell eingestempelt */}
      {activeModal === 'clockedIn' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setActiveModal(null)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="p-6 border-b border-gray-100 flex items-center justify-between">
              <h2 className="text-xl font-semibold flex items-center gap-2">
                <UserCheck className="w-5 h-5 text-green-500" />
                Aktuell eingestempelt
              </h2>
              <button onClick={() => setActiveModal(null)} className="p-2 hover:bg-gray-100 rounded-lg">
                <X size={20} />
              </button>
            </div>
            <div className="overflow-y-auto flex-1 divide-y divide-gray-100">
              {clockedInEntries?.length ? (
                clockedInEntries.map((entry: any) => (
                  <div
                    key={entry.id}
                    className="p-4 flex items-center gap-3 hover:bg-gray-50 cursor-pointer"
                    onClick={() => {
                      setActiveModal(null);
                      navigate(`/admin/employees?openEmployee=${entry.employeeId}`);
                    }}
                  >
                    <div className="flex-shrink-0">
                      {entry.employee.photoUrl ? (
                        <img src={photoSrc(entry.employee.photoUrl)} alt="" className="w-10 h-10 rounded-full object-cover" />
                      ) : (
                        <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center text-green-700 font-medium">
                          {entry.employee.firstName[0]}{entry.employee.lastName[0]}
                        </div>
                      )}
                    </div>
                    <div className="flex-1">
                      <p className="font-medium text-gray-900">
                        {entry.employee.firstName} {entry.employee.lastName}
                      </p>
                      <p className="text-sm text-gray-500">#{entry.employee.employeeNumber}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-medium text-green-600">
                        seit {format(new Date(entry.clockIn), 'HH:mm', { locale: de })}
                      </p>
                      <p className="text-xs text-gray-400">
                        {format(new Date(entry.clockIn), 'dd.MM.yyyy', { locale: de })}
                      </p>
                    </div>
                  </div>
                ))
              ) : (
                <div className="p-8 text-center text-gray-500">
                  Niemand eingestempelt
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal: Einträge heute */}
      {activeModal === 'entriesToday' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setActiveModal(null)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="p-6 border-b border-gray-100 flex items-center justify-between">
              <h2 className="text-xl font-semibold flex items-center gap-2">
                <Clock className="w-5 h-5 text-orange-500" />
                Einträge heute
              </h2>
              <button onClick={() => setActiveModal(null)} className="p-2 hover:bg-gray-100 rounded-lg">
                <X size={20} />
              </button>
            </div>
            <div className="overflow-y-auto flex-1 divide-y divide-gray-100">
              {todayEntries?.length ? (
                todayEntries.map((entry: any) => (
                  <div
                    key={entry.id}
                    className="p-4 flex items-center gap-3 hover:bg-gray-50 cursor-pointer"
                    onClick={() => {
                      setActiveModal(null);
                      navigate(`/admin/employees?openEmployee=${entry.employeeId}`);
                    }}
                  >
                    <div className="flex-shrink-0">
                      {entry.employee.photoUrl ? (
                        <img src={photoSrc(entry.employee.photoUrl)} alt="" className="w-10 h-10 rounded-full object-cover" />
                      ) : (
                        <div className="w-10 h-10 rounded-full bg-orange-100 flex items-center justify-center text-orange-700 font-medium">
                          {entry.employee.firstName[0]}{entry.employee.lastName[0]}
                        </div>
                      )}
                    </div>
                    <div className="flex-1">
                      <p className="font-medium text-gray-900">
                        {entry.employee.firstName} {entry.employee.lastName}
                      </p>
                      <p className="text-sm text-gray-500">#{entry.employee.employeeNumber}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-medium text-gray-700">
                        {format(new Date(entry.clockIn), 'HH:mm', { locale: de })}
                        {entry.clockOut ? ` - ${format(new Date(entry.clockOut), 'HH:mm', { locale: de })}` : ''}
                      </p>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${entry.clockOut ? 'bg-gray-100 text-gray-600' : 'bg-green-100 text-green-700'}`}>
                        {entry.clockOut ? 'Fertig' : 'Aktiv'}
                      </span>
                    </div>
                  </div>
                ))
              ) : (
                <div className="p-8 text-center text-gray-500">
                  Keine Einträge heute
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
