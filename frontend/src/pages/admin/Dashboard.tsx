import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { settingsApi, timeEntriesApi } from '../../lib/api';
import { photoSrc } from '../../lib/photoUrl';
import {
  Users, Clock, FileText, UserCheck, AlertTriangle, ChevronRight, X,
  CalendarDays, MessageSquare,
} from 'lucide-react';
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
      value: stats?.activeEmployees ?? '—',
      icon: Users,
      onClick: () => navigate('/admin/employees'),
    },
    {
      label: 'Aktuell eingestempelt',
      value: stats?.currentlyClockedIn ?? '—',
      icon: UserCheck,
      onClick: () => setActiveModal('clockedIn'),
      highlight: typeof stats?.currentlyClockedIn === 'number' && stats.currentlyClockedIn > 0,
    },
    {
      label: 'Einträge heute',
      value: stats?.entriesToday ?? '—',
      icon: Clock,
      onClick: () => setActiveModal('entriesToday'),
    },
    {
      label: 'Offene Abrechnungen',
      value: stats?.pendingReports ?? '—',
      icon: FileText,
      onClick: () => navigate('/admin/reports?status=draft'),
    },
  ];

  const today = format(new Date(), 'dd. MMMM yyyy', { locale: de });

  return (
    <div className="space-y-stack_lg">
      {/* Header */}
      <header className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-stack_sm">
        <div>
          <h1 className="font-display text-display text-on-surface">Übersicht</h1>
          <p className="font-body-md text-body-md text-on-surface-variant mt-1">
            Live-Stand der Zeiterfassung
          </p>
        </div>
        <div className="inline-flex items-center gap-2 bg-surface-container-low dark:bg-surface-container border border-outline-variant rounded-full px-4 py-2 shadow-sm">
          <CalendarDays size={18} className="text-on-surface-variant" />
          <span className="font-body-md text-body-md font-medium text-on-surface-variant">{today}</span>
        </div>
      </header>

      {/* KPI-Kacheln */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-gutter">
        {statCards.map((stat) => (
          <button
            key={stat.label}
            onClick={stat.onClick}
            className="text-left bg-surface dark:bg-surface-container-high border border-outline-variant rounded-xl p-stack_md flex flex-col gap-stack_sm shadow-sm hover:shadow-md transition-shadow duration-150 ease-in-out"
          >
            <div className="flex items-center justify-between">
              <span className="font-label-md text-label-md uppercase text-on-surface-variant">{stat.label}</span>
              <stat.icon size={18} className="text-outline" />
            </div>
            <div className="flex items-center gap-2">
              <span className="font-stat-number text-stat-number text-on-surface">{stat.value}</span>
              {stat.highlight && (
                <span className="relative flex h-2.5 w-2.5">
                  <span className="absolute inline-flex h-full w-full rounded-full bg-green-500 opacity-75 animate-ping" />
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500" />
                </span>
              )}
            </div>
          </button>
        ))}
      </div>

      {/* Offene Reklamationen — Tabellen-Karte */}
      {pendingComplaints && pendingComplaints.count > 0 && (pendingComplaints.entries?.length ?? 0) > 0 && (
        <div className="bg-surface dark:bg-surface-container-high border border-outline-variant rounded-xl shadow-sm overflow-hidden">
          <div className="px-stack_lg py-stack_md border-b border-outline-variant bg-surface-bright dark:bg-surface-container flex items-center justify-between">
            <div className="flex items-center gap-stack_sm">
              <AlertTriangle size={20} className="text-error" />
              <h2 className="font-headline-md text-headline-md text-on-surface">Offene Reklamationen</h2>
              <span className="bg-error text-on-error font-label-md text-label-md px-2 py-0.5 rounded-full">
                {pendingComplaints.count}
              </span>
            </div>
            <button
              onClick={() => navigate('/admin/complaints')}
              className="font-body-md text-body-md text-primary-container hover:underline"
            >
              Alle anzeigen
            </button>
          </div>
          <div className="divide-y divide-outline-variant">
            {(pendingComplaints.entries ?? []).map((entry: any) => (
              <button
                key={entry.id}
                onClick={() => navigate(`/admin/complaints?entry=${encodeURIComponent(entry.id)}`)}
                className="w-full text-left flex items-center gap-stack_md px-stack_lg py-stack_md hover:bg-surface-container-low dark:hover:bg-surface-container transition-colors"
              >
                <div className="shrink-0">
                  {entry.employee.photoUrl ? (
                    <img src={photoSrc(entry.employee.photoUrl)} alt="" className="w-10 h-10 rounded-full object-cover" />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-error-container text-on-error-container flex items-center justify-center font-body-md text-body-md font-semibold">
                      {entry.employee.firstName[0]}{entry.employee.lastName[0]}
                    </div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-body-md text-body-md font-semibold text-on-surface">
                    {entry.employee.firstName} {entry.employee.lastName}
                  </p>
                  <p className="font-body-md text-body-md text-on-surface-variant truncate">
                    „{entry.complaintMessage}"
                  </p>
                  <p className="font-label-md text-label-md text-on-surface-variant mt-0.5">
                    Eintrag vom {format(new Date(entry.clockIn), 'dd.MM.yyyy', { locale: de })}
                    {' · '}reklamiert {format(new Date(entry.complaintAt), "dd.MM.yyyy 'um' HH:mm", { locale: de })}
                  </p>
                </div>
                <ChevronRight size={20} className="text-outline shrink-0" />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Letzte Aktivitäten — Timeline-Stil */}
      <div className="bg-surface dark:bg-surface-container-high border border-outline-variant rounded-xl shadow-sm overflow-hidden">
        <div className="px-stack_lg py-stack_md border-b border-outline-variant bg-surface-bright dark:bg-surface-container flex items-center justify-between">
          <h2 className="font-headline-md text-headline-md text-on-surface flex items-center gap-stack_sm">
            <MessageSquare size={20} className="text-on-surface-variant" />
            Letzte Stempelungen
          </h2>
        </div>
        <div className="p-stack_lg">
          {recentEntries?.length ? (
            <div className="relative border-l-2 border-outline-variant ml-3 flex flex-col gap-stack_lg">
              {recentEntries.map((entry: any) => {
                const isActive = !entry.clockOut;
                const dotColor = isActive ? 'border-green-500' : 'border-on-surface-variant';
                return (
                  <div key={entry.id} className="relative pl-stack_lg">
                    <div className={`absolute -left-[9px] top-1 w-4 h-4 rounded-full bg-surface dark:bg-surface-container-high border-2 ${dotColor}`} />
                    <p className="font-body-md text-body-md text-on-surface">
                      <span className="font-semibold">{entry.employee.firstName} {entry.employee.lastName}</span>
                      {' '}{isActive ? 'eingestempelt' : 'ausgestempelt'}
                    </p>
                    <p className="font-label-md text-label-md text-on-surface-variant mt-0.5">
                      {format(new Date(entry.clockIn), "dd.MM.yyyy 'um' HH:mm", { locale: de })}
                      {entry.clockOut && ` – ${format(new Date(entry.clockOut), 'HH:mm', { locale: de })}`}
                    </p>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-stack_lg font-body-md text-body-md text-on-surface-variant">
              Keine Einträge vorhanden
            </div>
          )}
        </div>
      </div>

      {/* Modal: Aktuell eingestempelt */}
      {activeModal === 'clockedIn' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setActiveModal(null)}>
          <div className="bg-surface dark:bg-surface-container-high rounded-xl shadow-xl w-full max-w-lg max-h-[80vh] flex flex-col border border-outline-variant" onClick={(e) => e.stopPropagation()}>
            <div className="p-stack_lg border-b border-outline-variant flex items-center justify-between">
              <h2 className="font-headline-md text-headline-md text-on-surface flex items-center gap-stack_sm">
                <UserCheck size={20} className="text-green-500" />
                Aktuell eingestempelt
              </h2>
              <button onClick={() => setActiveModal(null)} className="p-2 text-on-surface-variant hover:bg-surface-container-high dark:hover:bg-surface-container-highest rounded-lg transition-colors">
                <X size={20} />
              </button>
            </div>
            <div className="overflow-y-auto flex-1 divide-y divide-outline-variant">
              {clockedInEntries?.length ? (
                clockedInEntries.map((entry: any) => (
                  <button
                    key={entry.id}
                    className="w-full text-left p-stack_md flex items-center gap-stack_md hover:bg-surface-container-low dark:hover:bg-surface-container transition-colors"
                    onClick={() => {
                      setActiveModal(null);
                      navigate(`/admin/employees?openEmployee=${entry.employeeId}`);
                    }}
                  >
                    <div className="shrink-0">
                      {entry.employee.photoUrl ? (
                        <img src={photoSrc(entry.employee.photoUrl)} alt="" className="w-10 h-10 rounded-full object-cover" />
                      ) : (
                        <div className="w-10 h-10 rounded-full bg-secondary-container text-on-secondary-container flex items-center justify-center font-body-md font-semibold">
                          {entry.employee.firstName[0]}{entry.employee.lastName[0]}
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-body-md text-body-md font-semibold text-on-surface truncate">
                        {entry.employee.firstName} {entry.employee.lastName}
                      </p>
                      <p className="font-label-md text-label-md text-on-surface-variant">#{entry.employee.employeeNumber}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="font-body-md text-body-md font-medium text-green-600 dark:text-green-400">
                        seit {format(new Date(entry.clockIn), 'HH:mm', { locale: de })}
                      </p>
                      <p className="font-label-md text-label-md text-on-surface-variant">
                        {format(new Date(entry.clockIn), 'dd.MM.yyyy', { locale: de })}
                      </p>
                    </div>
                  </button>
                ))
              ) : (
                <div className="p-stack_lg text-center font-body-md text-body-md text-on-surface-variant">
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
          <div className="bg-surface dark:bg-surface-container-high rounded-xl shadow-xl w-full max-w-lg max-h-[80vh] flex flex-col border border-outline-variant" onClick={(e) => e.stopPropagation()}>
            <div className="p-stack_lg border-b border-outline-variant flex items-center justify-between">
              <h2 className="font-headline-md text-headline-md text-on-surface flex items-center gap-stack_sm">
                <Clock size={20} className="text-on-surface-variant" />
                Einträge heute
              </h2>
              <button onClick={() => setActiveModal(null)} className="p-2 text-on-surface-variant hover:bg-surface-container-high dark:hover:bg-surface-container-highest rounded-lg transition-colors">
                <X size={20} />
              </button>
            </div>
            <div className="overflow-y-auto flex-1 divide-y divide-outline-variant">
              {todayEntries?.length ? (
                todayEntries.map((entry: any) => (
                  <button
                    key={entry.id}
                    className="w-full text-left p-stack_md flex items-center gap-stack_md hover:bg-surface-container-low dark:hover:bg-surface-container transition-colors"
                    onClick={() => {
                      setActiveModal(null);
                      navigate(`/admin/employees?openEmployee=${entry.employeeId}`);
                    }}
                  >
                    <div className="shrink-0">
                      {entry.employee.photoUrl ? (
                        <img src={photoSrc(entry.employee.photoUrl)} alt="" className="w-10 h-10 rounded-full object-cover" />
                      ) : (
                        <div className="w-10 h-10 rounded-full bg-secondary-container text-on-secondary-container flex items-center justify-center font-body-md font-semibold">
                          {entry.employee.firstName[0]}{entry.employee.lastName[0]}
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-body-md text-body-md font-semibold text-on-surface truncate">
                        {entry.employee.firstName} {entry.employee.lastName}
                      </p>
                      <p className="font-label-md text-label-md text-on-surface-variant">#{entry.employee.employeeNumber}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="font-body-md text-body-md font-medium text-on-surface">
                        {format(new Date(entry.clockIn), 'HH:mm', { locale: de })}
                        {entry.clockOut ? ` – ${format(new Date(entry.clockOut), 'HH:mm', { locale: de })}` : ''}
                      </p>
                      <span className={`inline-block mt-1 font-label-md text-label-md px-2 py-0.5 rounded-full ${
                        entry.clockOut
                          ? 'bg-surface-container-high text-on-surface-variant'
                          : 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300'
                      }`}>
                        {entry.clockOut ? 'Fertig' : 'Aktiv'}
                      </span>
                    </div>
                  </button>
                ))
              ) : (
                <div className="p-stack_lg text-center font-body-md text-body-md text-on-surface-variant">
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
