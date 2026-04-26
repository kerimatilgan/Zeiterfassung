import { useQuery, useQueryClient } from '@tanstack/react-query';
import { timeEntriesApi, complaintsApi } from '../../lib/api';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import { AlertTriangle, CheckCircle, Clock, MessageSquare, Plus, X, Send, Calendar as CalendarIcon, MapPin, Coffee, Trash2 } from 'lucide-react';
import { useState } from 'react';
import toast from 'react-hot-toast';

interface Complaint {
  id: string;
  employeeId: string;
  timeEntryId: string | null;
  date: string;
  message: string;
  originalClockIn: string | null;
  originalClockOut: string | null;
  originalBreakMinutes: number | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
  resolvedByName: string | null;
  response: string | null;
  newClockIn: string | null;
  newClockOut: string | null;
  newBreakMinutes: number | null;
  createdAt: string;
  timeEntry?: {
    id: string;
    clockIn: string;
    clockOut: string | null;
    breakMinutes: number;
  } | null;
}

interface DayEntry {
  id: string;
  clockIn: string;
  clockOut: string | null;
  breakMinutes: number;
  clockInViaPwa?: boolean;
  clockOutViaPwa?: boolean;
}

export default function EmployeeComplaints() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<'all' | 'open' | 'resolved'>('all');
  const [filterMonth, setFilterMonth] = useState<string>('');

  // Neue Reklamation
  const [showNewForm, setShowNewForm] = useState(false);
  const [lookupDate, setLookupDate] = useState('');
  const [activeEntryId, setActiveEntryId] = useState<string | null>(null);
  const [newMessage, setNewMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { data: complaints } = useQuery({
    queryKey: ['myComplaintsV2'],
    queryFn: () => complaintsApi.getMy().then(r => r.data as Complaint[]),
  });

  const { data: dayEntries } = useQuery({
    queryKey: ['myDayEntries', lookupDate],
    queryFn: async () => {
      if (!lookupDate) return [];
      const start = new Date(lookupDate + 'T00:00:00');
      const end = new Date(lookupDate + 'T23:59:59');
      const res = await timeEntriesApi.getMy({ from: start.toISOString(), to: end.toISOString() });
      return (res.data as DayEntry[]).filter((e) => {
        const ci = new Date(e.clockIn);
        return ci >= start && ci <= end;
      });
    },
    enabled: !!lookupDate,
  });

  const filtered = (complaints || []).filter(c => {
    if (filter === 'open' && c.resolvedAt) return false;
    if (filter === 'resolved' && !c.resolvedAt) return false;
    if (filterMonth) {
      const month = format(new Date(c.createdAt), 'yyyy-MM');
      if (month !== filterMonth) return false;
    }
    return true;
  });

  const months = [...new Set((complaints || []).map(c => format(new Date(c.createdAt), 'yyyy-MM')))].sort().reverse();

  // Nach Tag gruppieren (für Historie)
  const byDay: Record<string, Complaint[]> = {};
  filtered.forEach(c => {
    const key = format(new Date(c.date), 'yyyy-MM-dd');
    if (!byDay[key]) byDay[key] = [];
    byDay[key].push(c);
  });

  const openCount = (complaints || []).filter(c => !c.resolvedAt).length;
  const resolvedCount = (complaints || []).filter(c => c.resolvedAt).length;

  const submit = async () => {
    if (!newMessage.trim()) { toast.error('Bitte Nachricht eingeben'); return; }
    setIsSubmitting(true);
    try {
      const payload: any = { message: newMessage };
      if (activeEntryId) payload.timeEntryId = activeEntryId;
      else payload.date = lookupDate;
      await complaintsApi.create(payload);
      toast.success('Reklamation gesendet');
      queryClient.invalidateQueries({ queryKey: ['myComplaintsV2'] });
      queryClient.invalidateQueries({ queryKey: ['myDayEntries', lookupDate] });
      setShowNewForm(false);
      setLookupDate('');
      setActiveEntryId(null);
      setNewMessage('');
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Fehler beim Senden');
    } finally {
      setIsSubmitting(false);
    }
  };

  const withdraw = async (id: string) => {
    if (!confirm('Reklamation wirklich zurückziehen?')) return;
    try {
      await complaintsApi.delete(id);
      toast.success('Reklamation zurückgezogen');
      queryClient.invalidateQueries({ queryKey: ['myComplaintsV2'] });
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Fehler beim Löschen');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Meine Reklamationen</h1>
          <p className="text-gray-500">Übersicht deiner Reklamationen mit Historie</p>
        </div>
        <button onClick={() => setShowNewForm(true)} className="btn btn-primary flex items-center gap-2">
          <Plus size={18} />
          <span className="hidden sm:inline">Neue Reklamation</span>
        </button>
      </div>

      {/* Neue Reklamation - integriertes Formular */}
      {showNewForm && (
        <div className="card p-5 border-2 border-amber-200 bg-amber-50/30">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-900 flex items-center gap-2">
              <MessageSquare size={18} className="text-amber-600" />
              Neue Reklamation
            </h3>
            <button
              onClick={() => { setShowNewForm(false); setLookupDate(''); setActiveEntryId(null); setNewMessage(''); }}
              className="p-1 hover:bg-gray-200 rounded"
            >
              <X size={18} />
            </button>
          </div>

          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                <CalendarIcon size={14} className="inline mr-1" />
                1. Tag wählen
              </label>
              <input
                type="date"
                value={lookupDate}
                max={format(new Date(), 'yyyy-MM-dd')}
                onChange={(e) => { setLookupDate(e.target.value); setActiveEntryId(null); setNewMessage(''); }}
                className="input w-full sm:w-auto"
              />
            </div>

            {lookupDate && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  2. {dayEntries && dayEntries.length > 0 ? 'Stempelung wählen oder Tag reklamieren' : 'Nachricht eingeben'}
                </label>

                {!dayEntries || dayEntries.length === 0 ? (
                  <div className="border border-amber-200 bg-amber-50 rounded p-3 space-y-2">
                    <p className="text-sm text-amber-800">Keine Stempelungen an diesem Tag - du kannst den ganzen Tag reklamieren.</p>
                    <textarea
                      value={newMessage}
                      onChange={(e) => setNewMessage(e.target.value)}
                      rows={3}
                      className="input w-full text-sm"
                      placeholder="z.B. Karte vergessen, war von 08:00 bis 17:00 anwesend..."
                      disabled={isSubmitting}
                    />
                    <div className="flex justify-end">
                      <button
                        onClick={() => { setActiveEntryId(null); submit(); }}
                        disabled={isSubmitting || !newMessage.trim()}
                        className="btn btn-primary flex items-center gap-2"
                      >
                        {isSubmitting ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Send size={14} />}
                        Tag reklamieren
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {dayEntries.map((entry, idx) => {
                      const isActive = activeEntryId === entry.id;
                      return (
                        <div key={entry.id}>
                          {idx > 0 && dayEntries[idx - 1].clockOut && (() => {
                            const prevEnd = new Date(dayEntries[idx - 1].clockOut!);
                            const currStart = new Date(entry.clockIn);
                            const gap = Math.round((currStart.getTime() - prevEnd.getTime()) / 60000);
                            if (gap <= 0) return null;
                            return (
                              <div className="text-xs text-orange-600 bg-orange-50 rounded px-3 py-1 mb-1 flex items-center gap-2">
                                <Coffee size={12} />
                                <span>Pause: {format(prevEnd, 'HH:mm')} - {format(currStart, 'HH:mm')} ({gap >= 60 ? `${Math.floor(gap / 60)}:${String(gap % 60).padStart(2, '0')}h` : `${gap} min`})</span>
                              </div>
                            );
                          })()}
                          <div className="border rounded p-3">
                            <div className="flex items-center gap-2 flex-wrap">
                              {(entry.clockInViaPwa || entry.clockOutViaPwa) && <MapPin size={14} className="text-blue-500" />}
                              <span className="font-mono font-medium">
                                {format(new Date(entry.clockIn), 'HH:mm')} -{' '}
                                {entry.clockOut ? format(new Date(entry.clockOut), 'HH:mm') : <span className="text-green-600">Aktiv</span>}
                              </span>
                              {entry.breakMinutes > 0 && (
                                <span className="text-xs text-gray-400">
                                  ({entry.breakMinutes >= 60 ? `${Math.floor(entry.breakMinutes / 60)}:${String(entry.breakMinutes % 60).padStart(2, '0')}h` : `${entry.breakMinutes} min`} Pause)
                                </span>
                              )}
                              <button
                                onClick={() => {
                                  if (isActive) { setActiveEntryId(null); }
                                  else { setActiveEntryId(entry.id); setNewMessage(''); }
                                }}
                                className={`ml-auto text-xs px-2 py-1 rounded ${
                                  isActive ? 'bg-primary-200 text-primary-800' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                }`}
                              >
                                {isActive ? 'Schließen' : 'Reklamieren'}
                              </button>
                            </div>
                            {isActive && (
                              <div className="mt-3 pt-3 border-t space-y-2">
                                <textarea
                                  value={newMessage}
                                  onChange={(e) => setNewMessage(e.target.value)}
                                  rows={3}
                                  className="input w-full text-sm"
                                  placeholder="Was möchtest du reklamieren?"
                                  disabled={isSubmitting}
                                />
                                <div className="flex justify-end">
                                  <button
                                    onClick={submit}
                                    disabled={isSubmitting || !newMessage.trim()}
                                    className="btn btn-primary flex items-center gap-2 text-sm"
                                  >
                                    {isSubmitting ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Send size={14} />}
                                    Senden
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="card p-4 text-center">
          <p className="text-2xl font-bold text-gray-900">{(complaints || []).length}</p>
          <p className="text-xs text-gray-500">Gesamt</p>
        </div>
        <div className="card p-4 text-center">
          <p className="text-2xl font-bold text-amber-600">{openCount}</p>
          <p className="text-xs text-gray-500">Offen</p>
        </div>
        <div className="card p-4 text-center">
          <p className="text-2xl font-bold text-green-600">{resolvedCount}</p>
          <p className="text-xs text-gray-500">Bearbeitet</p>
        </div>
      </div>

      {/* Filter */}
      <div className="flex flex-wrap gap-2">
        <button onClick={() => setFilter('all')}
          className={`px-3 py-1.5 text-sm rounded-lg border ${filter === 'all' ? 'bg-gray-900 text-white border-gray-900' : 'border-gray-300 hover:bg-gray-50'}`}>
          Alle
        </button>
        <button onClick={() => setFilter('open')}
          className={`px-3 py-1.5 text-sm rounded-lg border ${filter === 'open' ? 'bg-amber-500 text-white border-amber-500' : 'border-gray-300 hover:bg-gray-50'}`}>
          Offen ({openCount})
        </button>
        <button onClick={() => setFilter('resolved')}
          className={`px-3 py-1.5 text-sm rounded-lg border ${filter === 'resolved' ? 'bg-green-500 text-white border-green-500' : 'border-gray-300 hover:bg-gray-50'}`}>
          Bearbeitet ({resolvedCount})
        </button>
        {months.length > 1 && (
          <select value={filterMonth} onChange={e => setFilterMonth(e.target.value)}
            className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 ml-auto">
            <option value="">Alle Monate</option>
            {months.map(m => (
              <option key={m} value={m}>{format(new Date(m + '-01'), 'MMMM yyyy', { locale: de })}</option>
            ))}
          </select>
        )}
      </div>

      {/* Liste pro Tag (mit Historie) */}
      {Object.entries(byDay).sort(([a], [b]) => b.localeCompare(a)).map(([dayKey, items]) => {
        const dayDate = new Date(dayKey);
        const isMulti = items.length > 1;
        return (
          <div key={dayKey} className="card">
            <div className="px-5 py-3 bg-gray-50 border-b rounded-t-lg flex items-center justify-between">
              <h3 className="font-semibold text-gray-700 text-sm">
                {format(dayDate, 'EEEE, dd.MM.yyyy', { locale: de })}
                {isMulti && <span className="ml-2 text-amber-600 font-normal">({items.length} Reklamationen)</span>}
              </h3>
            </div>
            <div className="divide-y">
              {items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).map((c, idx) => (
                <div key={c.id} className="p-4">
                  <div className="flex items-start gap-3">
                    <div className={`p-2 rounded-lg mt-0.5 ${c.resolvedAt ? 'bg-green-100' : 'bg-amber-100'}`}>
                      {c.resolvedAt
                        ? <CheckCircle size={18} className="text-green-600" />
                        : <AlertTriangle size={18} className="text-amber-600" />
                      }
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${c.resolvedAt ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                          {c.resolvedAt ? 'Bearbeitet' : 'Offen'}
                        </span>
                        {isMulti && (
                          <span className="text-xs text-gray-500">
                            {idx === 0 ? 'Aktuelle' : `${items.length - idx}.`} Reklamation
                          </span>
                        )}
                        {c.timeEntry && (
                          <span className="text-sm text-gray-500 flex items-center gap-1">
                            <Clock size={12} />
                            {format(new Date(c.timeEntry.clockIn), 'HH:mm')}
                            {c.timeEntry.clockOut && ` - ${format(new Date(c.timeEntry.clockOut), 'HH:mm')}`}
                          </span>
                        )}
                        {!c.timeEntry && (
                          <span className="text-xs text-gray-500 italic">Tag-Reklamation (kein Eintrag)</span>
                        )}
                        <span className="text-xs text-gray-400 ml-auto">{format(new Date(c.createdAt), 'dd.MM.yyyy HH:mm')}</span>
                      </div>

                      <div className="mt-2 p-3 bg-gray-50 rounded-lg">
                        <p className="text-xs text-gray-500 mb-1 flex items-center gap-1">
                          <MessageSquare size={12} /> Deine Nachricht
                        </p>
                        <p className="text-sm text-gray-700 whitespace-pre-wrap">{c.message}</p>
                      </div>

                      {c.resolvedAt && (
                        <div className="mt-2 p-3 bg-green-50 rounded-lg">
                          <p className="text-xs text-green-600 mb-1 flex items-center gap-1">
                            <CheckCircle size={12} /> Antwort vom Admin
                            {c.resolvedByName && <span className="ml-1">({c.resolvedByName})</span>}
                            <span className="text-xs text-green-400 ml-auto">{format(new Date(c.resolvedAt), 'dd.MM.yyyy HH:mm')}</span>
                          </p>
                          {c.response ? (
                            <p className="text-sm text-green-800 whitespace-pre-wrap">{c.response}</p>
                          ) : (
                            <p className="text-sm text-green-600 italic">Ohne Kommentar bearbeitet</p>
                          )}
                          {(c.originalClockIn || c.newClockIn) && (() => {
                            const fmt = (d: string | null) => d ? format(new Date(d), 'HH:mm') : '—';
                            const oldStr = `${fmt(c.originalClockIn)} - ${fmt(c.originalClockOut)}`;
                            const newStr = `${fmt(c.newClockIn)} - ${fmt(c.newClockOut)}`;
                            const changed = oldStr !== newStr || c.originalBreakMinutes !== c.newBreakMinutes;
                            return (
                              <div className="mt-2 pt-2 border-t border-green-200 text-xs text-green-700">
                                {changed ? (
                                  <>
                                    <span className="font-medium">Änderungen: </span>
                                    <span className="line-through text-gray-400">{oldStr}</span>
                                    <span className="mx-2">→</span>
                                    <span className="font-semibold">{newStr}</span>
                                    {c.originalBreakMinutes !== c.newBreakMinutes && (
                                      <span className="ml-2">· Pause: {c.originalBreakMinutes ?? 0} → {c.newBreakMinutes ?? 0} min</span>
                                    )}
                                  </>
                                ) : (
                                  <span className="text-gray-500">Keine Zeitänderungen vorgenommen.</span>
                                )}
                              </div>
                            );
                          })()}
                        </div>
                      )}

                      {!c.resolvedAt && !c.id.startsWith('legacy-') && (
                        <div className="mt-2 flex justify-end">
                          <button
                            onClick={() => withdraw(c.id)}
                            className="text-xs text-red-600 hover:bg-red-50 px-2 py-1 rounded flex items-center gap-1"
                          >
                            <Trash2 size={12} /> Zurückziehen
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}

      {filtered.length === 0 && (
        <div className="card p-12 text-center text-gray-400">
          <MessageSquare size={48} className="mx-auto mb-3 opacity-30" />
          <p>{filter === 'open' ? 'Keine offenen Reklamationen' : filter === 'resolved' ? 'Keine bearbeiteten Reklamationen' : 'Noch keine Reklamationen eingereicht'}</p>
        </div>
      )}
    </div>
  );
}
