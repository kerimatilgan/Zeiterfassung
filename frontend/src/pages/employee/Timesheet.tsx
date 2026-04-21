import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { timeEntriesApi, settingsApi } from '../../lib/api';
import { useAuthStore } from '../../store/authStore';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay } from 'date-fns';
import { de } from 'date-fns/locale';
import { ChevronLeft, ChevronRight, Clock, AlertTriangle, CheckCircle, MessageSquare, X, Coffee, MapPin } from 'lucide-react';
import toast from 'react-hot-toast';

// Formatiert Dezimalstunden zu H:MM Format (nur volle Minuten, keine Sekunden)
const formatHoursToTime = (hours: number): string => {
  const h = Math.floor(hours);
  const m = Math.floor((hours - h) * 60);
  return `${h}:${m.toString().padStart(2, '0')}`;
};

interface TimeEntry {
  id: string;
  clockIn: string;
  clockOut: string | null;
  breakMinutes: number;
  note: string | null;
  clockInViaPwa?: boolean;
  clockOutViaPwa?: boolean;
  clockInLatitude?: number | null;
  clockInLongitude?: number | null;
  clockOutLatitude?: number | null;
  clockOutLongitude?: number | null;
  pwaClockInReasonId?: string | null;
  pwaClockInReasonText?: string | null;
  pwaClockOutReasonId?: string | null;
  pwaClockOutReasonText?: string | null;
  // Reklamation
  complaintMessage?: string | null;
  complaintAt?: string | null;
  complaintResolvedAt?: string | null;
  complaintResolvedBy?: string | null;
  complaintResponse?: string | null;
}

export default function EmployeeTimesheet() {
  const { employee } = useAuthStore();
  const workDayNumbers = (employee?.workDays || '1,2,3,4,5').split(',').map(d => parseInt(d.trim())).filter(d => !isNaN(d));
  const [currentDate, setCurrentDate] = useState(new Date());
  // Auswärtsstempelung Detail-Popup
  const [pwaDetailEntry, setPwaDetailEntry] = useState<TimeEntry | null>(null);
  // Reklamation State
  const [showComplaintModal, setShowComplaintModal] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState<TimeEntry | null>(null);
  const [complaintMessage, setComplaintMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(currentDate);

  const { data: entries, refetch } = useQuery({
    queryKey: ['my-entries', currentDate.getMonth(), currentDate.getFullYear()],
    queryFn: () =>
      timeEntriesApi
        .getMy({
          from: monthStart.toISOString(),
          to: monthEnd.toISOString(),
        })
        .then((r) => r.data as TimeEntry[]),
  });

  // Feiertage laden
  const { data: holidays } = useQuery({
    queryKey: ['holidays', currentDate.getFullYear()],
    queryFn: () => settingsApi.getHolidays(currentDate.getFullYear()).then(r => r.data),
  });

  const getHolidayName = (day: Date) => {
    if (!holidays) return null;
    return holidays.find((h: any) => isSameDay(new Date(h.date), day))?.name || null;
  };

  // PWA-Gründe laden für Anzeige
  const { data: pwaReasons } = useQuery({
    queryKey: ['pwaReasons'],
    queryFn: () => timeEntriesApi.getPwaReasons().then(r => r.data),
  });

  const getReasonName = (reasonId?: string | null, reasonText?: string | null) => {
    if (reasonText) return reasonText;
    if (reasonId && pwaReasons) {
      const found = pwaReasons.find((r: any) => r.id === reasonId);
      return found?.name || 'Unbekannt';
    }
    return null;
  };

  const daysInMonth = eachDayOfInterval({ start: monthStart, end: monthEnd });

  const getEntriesForDay = (day: Date) => {
    const dayEntries = entries?.filter((entry) => isSameDay(new Date(entry.clockIn), day)) || [];
    // Sortiere nach clockIn aufsteigend (alt nach neu)
    return dayEntries.sort((a, b) => new Date(a.clockIn).getTime() - new Date(b.clockIn).getTime());
  };

  // Sekunden werden bei der Berechnung abgeschnitten (08:49:22 → 08:49:00)
  const truncMs = (d: Date) => Math.floor(d.getTime() / 60000) * 60000;

  const calculateDayHours = (dayEntries: TimeEntry[]) => {
    return dayEntries.reduce((total, entry) => {
      if (!entry.clockOut) return total;
      const ms = truncMs(new Date(entry.clockOut)) - truncMs(new Date(entry.clockIn));
      const hours = ms / (1000 * 60 * 60) - entry.breakMinutes / 60;
      return total + hours;
    }, 0);
  };

  const totalMonthHours = entries?.reduce((total, entry) => {
    if (!entry.clockOut) return total;
    const ms = truncMs(new Date(entry.clockOut)) - truncMs(new Date(entry.clockIn));
    const hours = ms / (1000 * 60 * 60) - entry.breakMinutes / 60;
    return total + hours;
  }, 0) || 0;

  const prevMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
  };

  const nextMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
  };

  // Prüft ob der Tag kein Arbeitstag ist (basierend auf workDays des Mitarbeiters)
  // workDays: "1,2,3,4,5" wobei 0=So, 1=Mo, ..., 6=Sa
  const isNonWorkDay = (day: Date) => !workDayNumbers.includes(day.getDay());

  // Standalone-Reklamation (für Tage ohne Eintrag)
  const [standaloneDate, setStandaloneDate] = useState<string | null>(null);

  // Reklamation öffnen
  const openComplaintModal = (entry: TimeEntry, pauseInfo?: string) => {
    setSelectedEntry(entry);
    setStandaloneDate(null);
    setComplaintMessage(entry.complaintMessage || (pauseInfo ? `Reklamation zur Pause (${pauseInfo}): ` : ''));
    setShowComplaintModal(true);
  };

  // Standalone-Reklamation öffnen (kein Eintrag vorhanden)
  const openStandaloneComplaint = (day: Date) => {
    setSelectedEntry(null);
    setStandaloneDate(format(day, 'yyyy-MM-dd'));
    setComplaintMessage('');
    setShowComplaintModal(true);
  };

  // Reklamation senden
  const handleSubmitComplaint = async () => {
    if (!complaintMessage.trim()) {
      toast.error('Bitte geben Sie eine Nachricht ein');
      return;
    }

    setIsSubmitting(true);
    try {
      if (standaloneDate) {
        // Standalone-Reklamation (kein bestehender Eintrag)
        await timeEntriesApi.createStandaloneComplaint(standaloneDate, complaintMessage);
      } else if (selectedEntry) {
        await timeEntriesApi.createComplaint(selectedEntry.id, complaintMessage);
      }
      toast.success('Reklamation wurde gesendet');
      setShowComplaintModal(false);
      setComplaintMessage('');
      setSelectedEntry(null);
      setStandaloneDate(null);
      refetch();
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Fehler beim Senden der Reklamation');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Reklamation zurückziehen
  const handleDeleteComplaint = async () => {
    if (!selectedEntry) return;

    if (!confirm('Reklamation wirklich zurückziehen?')) return;

    setIsSubmitting(true);
    try {
      await timeEntriesApi.deleteComplaint(selectedEntry.id);
      toast.success('Reklamation wurde zurückgezogen');
      setShowComplaintModal(false);
      setComplaintMessage('');
      setSelectedEntry(null);
      refetch();
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Fehler beim Zurückziehen der Reklamation');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Meine Zeiten</h1>
          <p className="text-gray-500">Übersicht deiner Arbeitsstunden</p>
        </div>

        {/* Month Navigation */}
        <div className="flex items-center gap-4">
          <button
            onClick={prevMonth}
            className="p-2 hover:bg-gray-100 rounded-lg"
          >
            <ChevronLeft size={20} />
          </button>
          <span className="text-lg font-medium min-w-[180px] text-center">
            {format(currentDate, 'MMMM yyyy', { locale: de })}
          </span>
          <button
            onClick={nextMonth}
            className="p-2 hover:bg-gray-100 rounded-lg"
          >
            <ChevronRight size={20} />
          </button>
        </div>
      </div>

      {/* Summary */}
      <div className="card p-6 bg-gradient-to-r from-primary-500 to-primary-600 text-white">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-white/20 rounded-lg">
            <Clock size={24} />
          </div>
          <div>
            <p className="text-primary-100">Gesamtstunden {format(currentDate, 'MMMM', { locale: de })}</p>
            <p className="text-3xl font-bold">{formatHoursToTime(totalMonthHours)} Stunden</p>
          </div>
        </div>
      </div>

      {/* Calendar View - Mobile: Karten, Desktop: Tabelle */}
      <div className="card overflow-hidden">
        {/* Desktop Tabellen-Ansicht */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase w-32">
                  Datum
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Tag
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Zeiten
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase w-24">
                  Stunden
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {daysInMonth.map((day) => {
                const dayEntries = getEntriesForDay(day);
                const dayHours = calculateDayHours(dayEntries);
                const weekend = isNonWorkDay(day);
                const isToday = isSameDay(day, new Date());
                const holidayName = getHolidayName(day);

                return (
                  <tr
                    key={day.toISOString()}
                    className={`
                      ${holidayName ? 'bg-red-50 text-red-700' : weekend ? 'bg-gray-50 text-gray-400' : ''}
                      ${isToday ? 'bg-primary-50' : ''}
                    `}
                  >
                    <td className="px-4 py-3">
                      <span className={`font-medium ${isToday ? 'text-primary-600' : ''}`}>
                        {format(day, 'dd.MM.yyyy')}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span>{format(day, 'EEEE', { locale: de })}</span>
                      {holidayName && <span className="ml-2 text-xs text-red-500">({holidayName})</span>}
                    </td>
                    <td className="px-4 py-3">
                      {dayEntries.length > 0 ? (
                        <div className="space-y-1">
                          {dayEntries.map((entry, idx) => (
                            <div key={entry.id}>
                              {/* Pause zwischen Einträgen anzeigen */}
                              {idx > 0 && dayEntries[idx - 1].clockOut && (() => {
                                const prevEntry = dayEntries[idx - 1];
                                const prevEnd = new Date(prevEntry.clockOut!);
                                const currStart = new Date(entry.clockIn);
                                const gapMinutes = Math.round((currStart.getTime() - prevEnd.getTime()) / 60000);
                                const pauseLabel = `${format(prevEnd, 'HH:mm')} - ${format(currStart, 'HH:mm')}`;
                                if (gapMinutes > 0) {
                                  return (
                                    <div className="flex items-center gap-2 text-xs text-orange-500 py-0.5 pl-1">
                                      <Coffee size={12} />
                                      <span>Pause: {pauseLabel} ({gapMinutes >= 60 ? `${Math.floor(gapMinutes / 60)}:${String(gapMinutes % 60).padStart(2, '0')}h` : `${gapMinutes} min`})</span>
                                      <button
                                        onClick={() => openComplaintModal(prevEntry, pauseLabel)}
                                        className={`ml-auto text-xs px-2 py-0.5 rounded ${
                                          prevEntry.complaintMessage
                                            ? prevEntry.complaintResolvedAt
                                              ? 'text-green-700 bg-green-100 hover:bg-green-200'
                                              : 'text-amber-700 bg-amber-100 hover:bg-amber-200'
                                            : 'text-orange-500 hover:text-orange-700 hover:bg-orange-50'
                                        }`}
                                        title="Pause reklamieren"
                                      >
                                        Reklamieren
                                      </button>
                                    </div>
                                  );
                                }
                                return null;
                              })()}
                              <div className="text-sm">
                                <div className="flex items-center gap-2 flex-wrap">
                                  {entry.complaintMessage && (
                                    entry.complaintResolvedAt ? (
                                      <CheckCircle size={14} className="text-green-500 flex-shrink-0" />
                                    ) : (
                                      <AlertTriangle size={14} className="text-amber-500 flex-shrink-0" />
                                    )
                                  )}
                                  {(entry.clockInViaPwa || entry.clockOutViaPwa) && (
                                    <button
                                      onClick={(e) => { e.stopPropagation(); setPwaDetailEntry(entry); }}
                                      className="flex-shrink-0 p-0.5 rounded hover:bg-blue-100"
                                      title="Auswärtsstempelung – Details anzeigen"
                                    >
                                      <MapPin size={14} className="text-blue-500" />
                                    </button>
                                  )}
                                  <span className="font-medium">
                                    {format(new Date(entry.clockIn), 'HH:mm')}
                                  </span>
                                  {entry.clockOut ? (
                                    <span> - {format(new Date(entry.clockOut), 'HH:mm')}</span>
                                  ) : (
                                    <span className="text-green-600 ml-2">(aktiv)</span>
                                  )}
                                  {entry.breakMinutes > 0 && (
                                    <span className="text-gray-400 ml-2">
                                      ({entry.breakMinutes >= 60 ? `${Math.floor(entry.breakMinutes / 60)}:${String(entry.breakMinutes % 60).padStart(2, '0')}h` : `${entry.breakMinutes} min`} Pause)
                                    </span>
                                  )}
                                  <button
                                    onClick={() => openComplaintModal(entry)}
                                    className={`ml-auto text-xs px-2 py-0.5 rounded ${
                                      entry.complaintMessage
                                        ? entry.complaintResolvedAt
                                          ? 'text-green-700 bg-green-100 hover:bg-green-200'
                                          : 'text-amber-700 bg-amber-100 hover:bg-amber-200'
                                        : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
                                    }`}
                                    title={entry.complaintMessage ? 'Reklamation anzeigen' : 'Eintrag reklamieren'}
                                  >
                                    {entry.complaintMessage ? (
                                      entry.complaintResolvedAt ? 'Bearbeitet' : 'Offen'
                                    ) : (
                                      'Reklamieren'
                                    )}
                                  </button>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : weekend || holidayName ? (
                        <span className="text-gray-400">{holidayName ? '' : '-'}</span>
                      ) : (
                        <div className="flex items-center justify-between">
                          <span className="text-gray-400">Kein Eintrag</span>
                          {day <= new Date() && (
                            <button
                              onClick={() => openStandaloneComplaint(day)}
                              className="text-xs px-2 py-0.5 rounded text-gray-400 hover:text-amber-600 hover:bg-amber-50 flex items-center gap-1 ml-auto"
                              title="Tag reklamieren (z.B. Karte vergessen)"
                            >
                              <MessageSquare size={12} />
                              Reklamieren
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {dayHours > 0 ? (
                        <span className="font-medium text-gray-900">
                          {formatHoursToTime(dayHours)} h
                        </span>
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="bg-gray-50">
              <tr>
                <td colSpan={3} className="px-4 py-3 font-medium text-gray-900">
                  Gesamt
                </td>
                <td className="px-4 py-3 text-right font-bold text-gray-900">
                  {formatHoursToTime(totalMonthHours)} h
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Mobile Karten-Ansicht */}
        <div className="md:hidden divide-y divide-gray-100">
          {daysInMonth.map((day) => {
            const dayEntries = getEntriesForDay(day);
            const dayHours = calculateDayHours(dayEntries);
            const weekend = isNonWorkDay(day);
            const isToday = isSameDay(day, new Date());
            const holidayNameMobile = getHolidayName(day);

            // Überspringe Wochenenden ohne Einträge in der Mobile-Ansicht
            if (weekend && dayEntries.length === 0) return null;

            return (
              <div
                key={day.toISOString()}
                className={`p-4 ${isToday ? 'bg-primary-50' : holidayNameMobile ? 'bg-red-50' : weekend ? 'bg-gray-50' : ''}`}
              >
                {/* Datum-Header */}
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <span className={`font-medium ${isToday ? 'text-primary-600' : holidayNameMobile ? 'text-red-700' : weekend ? 'text-gray-400' : 'text-gray-900'}`}>
                      {format(day, 'EEE, dd.MM.', { locale: de })}
                    </span>
                    {holidayNameMobile && <span className="ml-1.5 text-xs text-red-500">({holidayNameMobile})</span>}
                  </div>
                  <span className={`font-medium ${dayHours > 0 ? 'text-gray-900' : 'text-gray-400'}`}>
                    {dayHours > 0 ? `${formatHoursToTime(dayHours)} h` : '-'}
                  </span>
                </div>

                {/* Einträge */}
                {dayEntries.length > 0 ? (
                  <div className="space-y-1">
                    {dayEntries.map((entry, idx) => (
                      <div key={entry.id}>
                        {/* Pause zwischen Einträgen */}
                        {idx > 0 && dayEntries[idx - 1].clockOut && (() => {
                          const prevEntry = dayEntries[idx - 1];
                          const prevEnd = new Date(prevEntry.clockOut!);
                          const currStart = new Date(entry.clockIn);
                          const gapMinutes = Math.round((currStart.getTime() - prevEnd.getTime()) / 60000);
                          const pauseLabel = `${format(prevEnd, 'HH:mm')} - ${format(currStart, 'HH:mm')}`;
                          if (gapMinutes > 0) {
                            return (
                              <div
                                className="flex items-center justify-between text-xs text-orange-500 py-1 px-2 cursor-pointer hover:bg-orange-50 rounded"
                                onClick={() => openComplaintModal(prevEntry, pauseLabel)}
                              >
                                <div className="flex items-center gap-1.5">
                                  <Coffee size={11} />
                                  <span>Pause {gapMinutes >= 60 ? `${Math.floor(gapMinutes / 60)}:${String(gapMinutes % 60).padStart(2, '0')}h` : `${gapMinutes} min`}</span>
                                </div>
                                <MessageSquare size={12} />
                              </div>
                            );
                          }
                          return null;
                        })()}
                      <div
                        className="flex items-center justify-between bg-white rounded-lg border border-gray-100 p-2"
                      >
                        <div className="flex items-center gap-2 text-sm">
                          {entry.complaintMessage && (
                            entry.complaintResolvedAt ? (
                              <CheckCircle size={14} className="text-green-500 flex-shrink-0" />
                            ) : (
                              <AlertTriangle size={14} className="text-amber-500 flex-shrink-0" />
                            )
                          )}
                          {(entry.clockInViaPwa || entry.clockOutViaPwa) && (
                            <button
                              onClick={(e) => { e.stopPropagation(); setPwaDetailEntry(entry); }}
                              className="flex-shrink-0 p-0.5 rounded hover:bg-blue-100"
                            >
                              <MapPin size={14} className="text-blue-500" />
                            </button>
                          )}
                          <span className="font-medium">
                            {format(new Date(entry.clockIn), 'HH:mm')}
                          </span>
                          {entry.clockOut ? (
                            <span className="text-gray-600">- {format(new Date(entry.clockOut), 'HH:mm')}</span>
                          ) : (
                            <span className="text-green-600">(aktiv)</span>
                          )}
                          {entry.breakMinutes > 0 && (
                            <span className="text-gray-400 text-xs">
                              ({entry.breakMinutes >= 60 ? `${Math.floor(entry.breakMinutes / 60)}:${String(entry.breakMinutes % 60).padStart(2, '0')}h` : `${entry.breakMinutes}m`})
                            </span>
                          )}
                        </div>
                        {/* Reklamieren Button */}
                        <button
                          onClick={() => openComplaintModal(entry)}
                          className={`text-xs px-2 py-1 rounded whitespace-nowrap ${
                            entry.complaintMessage
                              ? entry.complaintResolvedAt
                                ? 'text-green-700 bg-green-100'
                                : 'text-amber-700 bg-amber-100'
                              : 'text-gray-500 bg-gray-100'
                          }`}
                        >
                          {entry.complaintMessage ? (
                            entry.complaintResolvedAt ? '✓' : '!'
                          ) : (
                            <MessageSquare size={14} />
                          )}
                        </button>
                      </div>
                      </div>
                    ))}
                  </div>
                ) : !weekend && (
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-gray-400">Kein Eintrag</p>
                    {day <= new Date() && (
                      <button
                        onClick={() => openStandaloneComplaint(day)}
                        className="text-xs px-2 py-1 rounded text-gray-400 bg-gray-100 hover:text-amber-600 hover:bg-amber-50"
                        title="Tag reklamieren"
                      >
                        <MessageSquare size={14} />
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {/* Mobile Footer mit Gesamt */}
          <div className="p-4 bg-gray-50 flex justify-between items-center">
            <span className="font-medium text-gray-900">Gesamt</span>
            <span className="font-bold text-gray-900">{formatHoursToTime(totalMonthHours)} h</span>
          </div>
        </div>
      </div>

      {/* Auswärtsstempelung Detail-Popup */}
      {pwaDetailEntry && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setPwaDetailEntry(null)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="bg-blue-600 text-white p-5 rounded-t-xl">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold flex items-center gap-2">
                  <MapPin size={20} /> Auswärtsstempelung
                </h3>
                <button onClick={() => setPwaDetailEntry(null)} className="p-1 hover:bg-white/20 rounded">
                  <X size={18} />
                </button>
              </div>
              <p className="text-blue-100 text-sm mt-1">
                {format(new Date(pwaDetailEntry.clockIn), 'EEEE, dd. MMMM yyyy', { locale: de })}
              </p>
            </div>
            <div className="p-5 space-y-4">
              {/* Einstempeln */}
              {pwaDetailEntry.clockInViaPwa && (
                <div className="p-3 bg-green-50 rounded-lg">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-green-600 font-semibold text-sm">Eingestempelt um {format(new Date(pwaDetailEntry.clockIn), 'HH:mm')} Uhr</span>
                  </div>
                  <div className="space-y-1 text-sm">
                    <p className="text-gray-600">
                      <span className="text-gray-500">Grund:</span>{' '}
                      <span className="font-medium">{getReasonName(pwaDetailEntry.pwaClockInReasonId, pwaDetailEntry.pwaClockInReasonText) || '-'}</span>
                    </p>
                    {pwaDetailEntry.clockInLatitude && pwaDetailEntry.clockInLongitude && (
                      <a
                        href={`https://www.openstreetmap.org/?mlat=${pwaDetailEntry.clockInLatitude}&mlon=${pwaDetailEntry.clockInLongitude}#map=17/${pwaDetailEntry.clockInLatitude}/${pwaDetailEntry.clockInLongitude}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-blue-600 hover:underline"
                      >
                        <MapPin size={12} /> Standort auf Karte anzeigen
                      </a>
                    )}
                  </div>
                </div>
              )}

              {/* Ausstempeln */}
              {pwaDetailEntry.clockOutViaPwa && pwaDetailEntry.clockOut && (
                <div className="p-3 bg-red-50 rounded-lg">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-red-600 font-semibold text-sm">Ausgestempelt um {format(new Date(pwaDetailEntry.clockOut), 'HH:mm')} Uhr</span>
                  </div>
                  <div className="space-y-1 text-sm">
                    <p className="text-gray-600">
                      <span className="text-gray-500">Grund:</span>{' '}
                      <span className="font-medium">{getReasonName(pwaDetailEntry.pwaClockOutReasonId, pwaDetailEntry.pwaClockOutReasonText) || '-'}</span>
                    </p>
                    {pwaDetailEntry.clockOutLatitude && pwaDetailEntry.clockOutLongitude && (
                      <a
                        href={`https://www.openstreetmap.org/?mlat=${pwaDetailEntry.clockOutLatitude}&mlon=${pwaDetailEntry.clockOutLongitude}#map=17/${pwaDetailEntry.clockOutLatitude}/${pwaDetailEntry.clockOutLongitude}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-blue-600 hover:underline"
                      >
                        <MapPin size={12} /> Standort auf Karte anzeigen
                      </a>
                    )}
                  </div>
                </div>
              )}

              {/* Notiz */}
              {pwaDetailEntry.note && (
                <div className="p-3 bg-gray-50 rounded-lg text-sm text-gray-600">
                  <span className="text-gray-500">Notiz:</span> {pwaDetailEntry.note}
                </div>
              )}
            </div>
            <div className="p-4 border-t flex justify-end">
              <button onClick={() => setPwaDetailEntry(null)} className="px-4 py-2 border rounded-lg hover:bg-gray-50 text-sm">
                Schließen
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reklamation Modal */}
      {showComplaintModal && (selectedEntry || standaloneDate) && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
            <div className="p-6 border-b border-gray-100">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-lg ${selectedEntry?.complaintResolvedAt ? 'bg-green-100' : 'bg-amber-100'}`}>
                    <MessageSquare size={20} className={selectedEntry?.complaintResolvedAt ? 'text-green-600' : 'text-amber-600'} />
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900">
                      {standaloneDate ? 'Tag reklamieren' : selectedEntry?.complaintMessage ? 'Reklamation' : 'Eintrag reklamieren'}
                    </h3>
                    <p className="text-sm text-gray-500">
                      {standaloneDate
                        ? format(new Date(standaloneDate + 'T12:00:00'), 'EEEE, dd.MM.yyyy', { locale: de })
                        : selectedEntry && (
                          <>
                            {format(new Date(selectedEntry.clockIn), 'dd.MM.yyyy')} - {format(new Date(selectedEntry.clockIn), 'HH:mm')}
                            {selectedEntry.clockOut && ` bis ${format(new Date(selectedEntry.clockOut), 'HH:mm')}`}
                          </>
                        )
                      }
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => {
                    setShowComplaintModal(false);
                    setSelectedEntry(null);
                    setStandaloneDate(null);
                    setComplaintMessage('');
                  }}
                  className="p-1 hover:bg-gray-100 rounded"
                >
                  <X size={20} />
                </button>
              </div>
            </div>

            <div className="p-6 space-y-4">
              {/* Wenn bereits bearbeitet, nur Anzeige */}
              {selectedEntry?.complaintResolvedAt ? (
                <>
                  <div className="bg-gray-50 rounded-lg p-4">
                    <p className="text-sm font-medium text-gray-500 mb-1">Ihre Nachricht:</p>
                    <p className="text-gray-700">{selectedEntry.complaintMessage}</p>
                  </div>
                  {selectedEntry.complaintResponse && (
                    <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                      <p className="text-sm font-medium text-green-700 mb-1">Antwort vom Admin:</p>
                      <p className="text-gray-700">{selectedEntry.complaintResponse}</p>
                    </div>
                  )}
                  <div className="flex items-center gap-2 text-sm text-green-600">
                    <CheckCircle size={16} />
                    <span>Diese Reklamation wurde bearbeitet</span>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      {standaloneDate ? 'Was ist an diesem Tag passiert?' : 'Was stimmt nicht mit diesem Eintrag?'}
                    </label>
                    <textarea
                      value={complaintMessage}
                      onChange={(e) => setComplaintMessage(e.target.value)}
                      className="input w-full"
                      rows={4}
                      placeholder={standaloneDate ? 'z.B. Karte vergessen, war aber von 08:00 bis 17:00 anwesend...' : 'z.B. Mittagspause fehlt, falsche Ausstempelzeit, vergessen auszustempeln...'}
                      disabled={isSubmitting}
                    />
                  </div>

                  <p className="text-xs text-gray-500">
                    Ihre Nachricht wird an die Administratoren gesendet, die den Eintrag korrigieren können.
                  </p>
                </>
              )}
            </div>

            {/* Buttons - nur anzeigen wenn nicht bearbeitet */}
            {!selectedEntry?.complaintResolvedAt && (
              <div className="p-6 border-t border-gray-100 flex justify-between">
                {selectedEntry?.complaintMessage ? (
                  <button
                    onClick={handleDeleteComplaint}
                    disabled={isSubmitting}
                    className="text-red-600 hover:text-red-700 text-sm font-medium"
                  >
                    Reklamation zurückziehen
                  </button>
                ) : (
                  <div />
                )}
                <div className="flex gap-3">
                  <button
                    onClick={() => {
                      setShowComplaintModal(false);
                      setSelectedEntry(null);
                      setStandaloneDate(null);
                      setComplaintMessage('');
                    }}
                    className="btn btn-secondary"
                    disabled={isSubmitting}
                  >
                    {selectedEntry?.complaintMessage ? 'Schließen' : 'Abbrechen'}
                  </button>
                  <button
                    onClick={handleSubmitComplaint}
                    disabled={isSubmitting || !complaintMessage.trim()}
                    className="btn btn-primary flex items-center gap-2"
                  >
                    {isSubmitting ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        Senden...
                      </>
                    ) : (
                      selectedEntry?.complaintMessage ? 'Aktualisieren' : 'Absenden'
                    )}
                  </button>
                </div>
              </div>
            )}

            {/* Schließen Button wenn bearbeitet */}
            {selectedEntry?.complaintResolvedAt && (
              <div className="p-6 border-t border-gray-100 flex justify-end">
                <button
                  onClick={() => {
                    setShowComplaintModal(false);
                    setSelectedEntry(null);
                    setStandaloneDate(null);
                    setComplaintMessage('');
                  }}
                  className="btn btn-primary"
                >
                  Schließen
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
