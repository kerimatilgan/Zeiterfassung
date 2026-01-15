import { useQuery } from '@tanstack/react-query';
import { timeEntriesApi } from '../../lib/api';
import { useAuthStore } from '../../store/authStore';
import { Clock, TrendingUp, Calendar, Timer } from 'lucide-react';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';

export default function EmployeeDashboard() {
  const { employee } = useAuthStore();

  const { data: status } = useQuery({
    queryKey: ['my-status'],
    queryFn: () => timeEntriesApi.getMyStatus().then((r) => r.data),
    refetchInterval: 30000,
  });

  const { data: stats } = useQuery({
    queryKey: ['my-stats'],
    queryFn: () => timeEntriesApi.getMyStats().then((r) => r.data),
  });

  const { data: recentEntries } = useQuery({
    queryKey: ['my-entries'],
    queryFn: () => timeEntriesApi.getMy().then((r) => r.data.slice(0, 5)),
  });

  const calculateCurrentDuration = () => {
    if (!status?.activeEntry) return null;
    const start = new Date(status.activeEntry.clockIn);
    const now = new Date();
    const diffMs = now.getTime() - start.getTime();
    const hours = Math.floor(diffMs / (1000 * 60 * 60));
    const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
    return `${hours}h ${minutes}m`;
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">
          Hallo, {employee?.firstName}!
        </h1>
        <p className="text-gray-500">Deine Zeiterfassung auf einen Blick</p>
      </div>

      {/* Current Status */}
      <div
        className={`card p-6 ${
          status?.isClockedIn
            ? 'bg-gradient-to-r from-green-500 to-green-600 text-white'
            : 'bg-gradient-to-r from-gray-100 to-gray-200'
        }`}
      >
        <div className="flex items-center justify-between">
          <div>
            <p className={`text-sm ${status?.isClockedIn ? 'text-green-100' : 'text-gray-500'}`}>
              Aktueller Status
            </p>
            <p className="text-2xl font-bold mt-1">
              {status?.isClockedIn ? 'Eingestempelt' : 'Ausgestempelt'}
            </p>
            {status?.isClockedIn && status.activeEntry && (
              <p className="text-green-100 mt-2">
                Seit {format(new Date(status.activeEntry.clockIn), 'HH:mm', { locale: de })} Uhr
                {' '}({calculateCurrentDuration()})
              </p>
            )}
          </div>
          <div
            className={`p-4 rounded-full ${
              status?.isClockedIn ? 'bg-green-400/30' : 'bg-gray-300'
            }`}
          >
            <Clock size={32} className={status?.isClockedIn ? 'text-white' : 'text-gray-500'} />
          </div>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="card p-6">
          <div className="flex items-center gap-4">
            <div className="p-3 rounded-lg bg-blue-100">
              <TrendingUp className="w-6 h-6 text-blue-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900">
                {stats?.weekHours?.toFixed(1) ?? '-'} h
              </p>
              <p className="text-sm text-gray-500">Diese Woche</p>
            </div>
          </div>
        </div>

        <div className="card p-6">
          <div className="flex items-center gap-4">
            <div className="p-3 rounded-lg bg-purple-100">
              <Calendar className="w-6 h-6 text-purple-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900">
                {stats?.monthHours?.toFixed(1) ?? '-'} h
              </p>
              <p className="text-sm text-gray-500">Dieser Monat</p>
            </div>
          </div>
        </div>

        <div className="card p-6">
          <div className="flex items-center gap-4">
            <div className="p-3 rounded-lg bg-orange-100">
              <Timer className="w-6 h-6 text-orange-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900">
                {stats?.weekOvertime?.toFixed(1) ?? '-'} h
              </p>
              <p className="text-sm text-gray-500">Überstunden (Woche)</p>
            </div>
          </div>
        </div>

        <div className="card p-6">
          <div className="flex items-center gap-4">
            <div className="p-3 rounded-lg bg-gray-100">
              <Clock className="w-6 h-6 text-gray-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900">
                {stats?.weeklyTarget ?? '-'} h
              </p>
              <p className="text-sm text-gray-500">Soll (Woche)</p>
            </div>
          </div>
        </div>
      </div>

      {/* Recent Entries */}
      <div className="card">
        <div className="p-6 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900">Letzte Einträge</h2>
        </div>
        <div className="divide-y divide-gray-100">
          {recentEntries?.length ? (
            recentEntries.map((entry: any) => {
              const hours = entry.clockOut
                ? ((new Date(entry.clockOut).getTime() - new Date(entry.clockIn).getTime()) /
                    (1000 * 60 * 60) -
                    entry.breakMinutes / 60
                  ).toFixed(2)
                : null;

              return (
                <div key={entry.id} className="p-4 flex items-center justify-between">
                  <div>
                    <p className="font-medium text-gray-900">
                      {format(new Date(entry.clockIn), 'EEEE, dd. MMMM', { locale: de })}
                    </p>
                    <p className="text-sm text-gray-500">
                      {format(new Date(entry.clockIn), 'HH:mm')}
                      {entry.clockOut && ` - ${format(new Date(entry.clockOut), 'HH:mm')}`}
                      {entry.breakMinutes > 0 && ` (${entry.breakMinutes} min Pause)`}
                    </p>
                  </div>
                  <div className="text-right">
                    {hours ? (
                      <span className="font-medium text-gray-900">{hours} h</span>
                    ) : (
                      <span className="px-3 py-1 rounded-full text-sm font-medium bg-green-100 text-green-700">
                        Aktiv
                      </span>
                    )}
                  </div>
                </div>
              );
            })
          ) : (
            <div className="p-8 text-center text-gray-500">Noch keine Einträge vorhanden</div>
          )}
        </div>
      </div>

      {/* Info Box */}
      <div className="card p-6 bg-blue-50 border-blue-200">
        <h3 className="font-medium text-blue-900 mb-2">Zeiterfassung per QR-Code</h3>
        <p className="text-sm text-blue-700">
          Scanne deinen persönlichen QR-Code am Terminal, um ein- und auszustempeln.
          Bei Fragen wende dich an deinen Administrator.
        </p>
      </div>
    </div>
  );
}
