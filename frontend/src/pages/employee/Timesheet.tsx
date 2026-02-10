import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { timeEntriesApi } from '../../lib/api';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay } from 'date-fns';
import { de } from 'date-fns/locale';
import { ChevronLeft, ChevronRight, Clock, AlertTriangle, CheckCircle, MessageSquare, X } from 'lucide-react';
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
  // Reklamation
  complaintMessage?: string | null;
  complaintAt?: string | null;
  complaintResolvedAt?: string | null;
  complaintResolvedBy?: string | null;
  complaintResponse?: string | null;
}

export default function EmployeeTimesheet() {
  const [currentDate, setCurrentDate] = useState(new Date());
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

  const daysInMonth = eachDayOfInterval({ start: monthStart, end: monthEnd });

  const getEntriesForDay = (day: Date) => {
    const dayEntries = entries?.filter((entry) => isSameDay(new Date(entry.clockIn), day)) || [];
    // Sortiere nach clockIn aufsteigend (alt nach neu)
    return dayEntries.sort((a, b) => new Date(a.clockIn).getTime() - new Date(b.clockIn).getTime());
  };

  const calculateDayHours = (dayEntries: TimeEntry[]) => {
    return dayEntries.reduce((total, entry) => {
      if (!entry.clockOut) return total;
      const ms = new Date(entry.clockOut).getTime() - new Date(entry.clockIn).getTime();
      const hours = ms / (1000 * 60 * 60) - entry.breakMinutes / 60;
      return total + hours;
    }, 0);
  };

  const totalMonthHours = entries?.reduce((total, entry) => {
    if (!entry.clockOut) return total;
    const ms = new Date(entry.clockOut).getTime() - new Date(entry.clockIn).getTime();
    const hours = ms / (1000 * 60 * 60) - entry.breakMinutes / 60;
    return total + hours;
  }, 0) || 0;

  const prevMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
  };

  const nextMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
  };

  const isWeekend = (day: Date) => day.getDay() === 0 || day.getDay() === 6;

  // Reklamation öffnen
  const openComplaintModal = (entry: TimeEntry) => {
    setSelectedEntry(entry);
    setComplaintMessage(entry.complaintMessage || '');
    setShowComplaintModal(true);
  };

  // Reklamation senden
  const handleSubmitComplaint = async () => {
    if (!selectedEntry || !complaintMessage.trim()) {
      toast.error('Bitte geben Sie eine Nachricht ein');
      return;
    }

    setIsSubmitting(true);
    try {
      await timeEntriesApi.createComplaint(selectedEntry.id, complaintMessage);
      toast.success('Reklamation wurde gesendet');
      setShowComplaintModal(false);
      setComplaintMessage('');
      setSelectedEntry(null);
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
                const weekend = isWeekend(day);
                const isToday = isSameDay(day, new Date());

                return (
                  <tr
                    key={day.toISOString()}
                    className={`
                      ${weekend ? 'bg-gray-50 text-gray-400' : ''}
                      ${isToday ? 'bg-primary-50' : ''}
                    `}
                  >
                    <td className="px-4 py-3">
                      <span className={`font-medium ${isToday ? 'text-primary-600' : ''}`}>
                        {format(day, 'dd.MM.yyyy')}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {format(day, 'EEEE', { locale: de })}
                    </td>
                    <td className="px-4 py-3">
                      {dayEntries.length > 0 ? (
                        <div className="space-y-2">
                          {dayEntries.map((entry) => (
                            <div key={entry.id} className="text-sm">
                              <div className="flex items-center gap-2">
                                {/* Reklamations-Icon */}
                                {entry.complaintMessage && (
                                  entry.complaintResolvedAt ? (
                                    <CheckCircle size={14} className="text-green-500 flex-shrink-0" />
                                  ) : (
                                    <AlertTriangle size={14} className="text-amber-500 flex-shrink-0" />
                                  )
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
                                    ({entry.breakMinutes} min Pause)
                                  </span>
                                )}
                                {/* Reklamieren Button */}
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
                          ))}
                        </div>
                      ) : weekend ? (
                        <span className="text-gray-400">-</span>
                      ) : (
                        <span className="text-gray-400">Kein Eintrag</span>
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
            const weekend = isWeekend(day);
            const isToday = isSameDay(day, new Date());

            // Überspringe Wochenenden ohne Einträge in der Mobile-Ansicht
            if (weekend && dayEntries.length === 0) return null;

            return (
              <div
                key={day.toISOString()}
                className={`p-4 ${isToday ? 'bg-primary-50' : weekend ? 'bg-gray-50' : ''}`}
              >
                {/* Datum-Header */}
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <span className={`font-medium ${isToday ? 'text-primary-600' : weekend ? 'text-gray-400' : 'text-gray-900'}`}>
                      {format(day, 'EEE, dd.MM.', { locale: de })}
                    </span>
                  </div>
                  <span className={`font-medium ${dayHours > 0 ? 'text-gray-900' : 'text-gray-400'}`}>
                    {dayHours > 0 ? `${formatHoursToTime(dayHours)} h` : '-'}
                  </span>
                </div>

                {/* Einträge */}
                {dayEntries.length > 0 ? (
                  <div className="space-y-2">
                    {dayEntries.map((entry) => (
                      <div
                        key={entry.id}
                        className="flex items-center justify-between bg-white rounded-lg border border-gray-100 p-2"
                      >
                        <div className="flex items-center gap-2 text-sm">
                          {/* Reklamations-Icon */}
                          {entry.complaintMessage && (
                            entry.complaintResolvedAt ? (
                              <CheckCircle size={14} className="text-green-500 flex-shrink-0" />
                            ) : (
                              <AlertTriangle size={14} className="text-amber-500 flex-shrink-0" />
                            )
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
                              ({entry.breakMinutes}m)
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
                    ))}
                  </div>
                ) : !weekend && (
                  <p className="text-sm text-gray-400">Kein Eintrag</p>
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

      {/* Reklamation Modal */}
      {showComplaintModal && selectedEntry && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
            <div className="p-6 border-b border-gray-100">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-lg ${selectedEntry.complaintResolvedAt ? 'bg-green-100' : 'bg-amber-100'}`}>
                    <MessageSquare size={20} className={selectedEntry.complaintResolvedAt ? 'text-green-600' : 'text-amber-600'} />
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900">
                      {selectedEntry.complaintMessage ? 'Reklamation' : 'Eintrag reklamieren'}
                    </h3>
                    <p className="text-sm text-gray-500">
                      {format(new Date(selectedEntry.clockIn), 'dd.MM.yyyy')} - {format(new Date(selectedEntry.clockIn), 'HH:mm')}
                      {selectedEntry.clockOut && ` bis ${format(new Date(selectedEntry.clockOut), 'HH:mm')}`}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => {
                    setShowComplaintModal(false);
                    setSelectedEntry(null);
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
              {selectedEntry.complaintResolvedAt ? (
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
                      Was stimmt nicht mit diesem Eintrag?
                    </label>
                    <textarea
                      value={complaintMessage}
                      onChange={(e) => setComplaintMessage(e.target.value)}
                      className="input w-full"
                      rows={4}
                      placeholder="z.B. Mittagspause fehlt, falsche Ausstempelzeit, vergessen auszustempeln..."
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
            {!selectedEntry.complaintResolvedAt && (
              <div className="p-6 border-t border-gray-100 flex justify-between">
                {selectedEntry.complaintMessage ? (
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
                      setComplaintMessage('');
                    }}
                    className="btn btn-secondary"
                    disabled={isSubmitting}
                  >
                    {selectedEntry.complaintMessage ? 'Schließen' : 'Abbrechen'}
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
                      selectedEntry.complaintMessage ? 'Aktualisieren' : 'Absenden'
                    )}
                  </button>
                </div>
              </div>
            )}

            {/* Schließen Button wenn bearbeitet */}
            {selectedEntry.complaintResolvedAt && (
              <div className="p-6 border-t border-gray-100 flex justify-end">
                <button
                  onClick={() => {
                    setShowComplaintModal(false);
                    setSelectedEntry(null);
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
