import { useQuery, useQueryClient } from '@tanstack/react-query';
import { timeEntriesApi } from '../../lib/api';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import { AlertTriangle, CheckCircle, Clock, MessageSquare, Plus, X, Send } from 'lucide-react';
import { useState } from 'react';
import toast from 'react-hot-toast';

interface Complaint {
  id: string;
  clockIn: string;
  clockOut: string | null;
  complaintMessage: string;
  complaintAt: string;
  complaintResolvedAt: string | null;
  complaintResolvedBy: string | null;
  complaintResponse: string | null;
  complaintOriginalClockIn: string | null;
  complaintOriginalClockOut: string | null;
  complaintOriginalBreakMinutes: number | null;
}

export default function EmployeeComplaints() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<'all' | 'open' | 'resolved'>('all');
  const [filterMonth, setFilterMonth] = useState<string>('');
  const [showNewForm, setShowNewForm] = useState(false);
  const [newDate, setNewDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [newMessage, setNewMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { data: complaints } = useQuery({
    queryKey: ['myComplaints'],
    queryFn: () => timeEntriesApi.getMyComplaints().then(r => r.data as Complaint[]),
  });

  const filtered = (complaints || []).filter(c => {
    if (filter === 'open' && c.complaintResolvedAt) return false;
    if (filter === 'resolved' && !c.complaintResolvedAt) return false;
    if (filterMonth) {
      const month = format(new Date(c.complaintAt), 'yyyy-MM');
      if (month !== filterMonth) return false;
    }
    return true;
  });

  // Monate für Filter extrahieren
  const months = [...new Set((complaints || []).map(c => format(new Date(c.complaintAt), 'yyyy-MM')))].sort().reverse();

  // Nach Monat gruppieren
  const grouped: Record<string, Complaint[]> = {};
  filtered.forEach(c => {
    const key = format(new Date(c.complaintAt), 'yyyy-MM');
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(c);
  });

  const openCount = (complaints || []).filter(c => !c.complaintResolvedAt).length;
  const resolvedCount = (complaints || []).filter(c => c.complaintResolvedAt).length;

  const handleNewComplaint = async () => {
    if (!newMessage.trim()) {
      toast.error('Bitte geben Sie eine Nachricht ein');
      return;
    }
    setIsSubmitting(true);
    try {
      await timeEntriesApi.createStandaloneComplaint(newDate, newMessage);
      toast.success('Reklamation wurde gesendet');
      setShowNewForm(false);
      setNewMessage('');
      setNewDate(format(new Date(), 'yyyy-MM-dd'));
      queryClient.invalidateQueries({ queryKey: ['myComplaints'] });
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Fehler beim Senden');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Meine Reklamationen</h1>
          <p className="text-gray-500">Übersicht deiner eingereichten Reklamationen</p>
        </div>
        <button
          onClick={() => setShowNewForm(true)}
          className="btn btn-primary flex items-center gap-2"
        >
          <Plus size={18} />
          <span className="hidden sm:inline">Neue Reklamation</span>
        </button>
      </div>

      {/* Neue Reklamation Formular */}
      {showNewForm && (
        <div className="card p-5 border-2 border-amber-200 bg-amber-50/30">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-900 flex items-center gap-2">
              <MessageSquare size={18} className="text-amber-600" />
              Neue Reklamation einreichen
            </h3>
            <button onClick={() => setShowNewForm(false)} className="p-1 hover:bg-gray-200 rounded">
              <X size={18} />
            </button>
          </div>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Datum</label>
              <input
                type="date"
                value={newDate}
                max={format(new Date(), 'yyyy-MM-dd')}
                onChange={(e) => setNewDate(e.target.value)}
                className="input w-full sm:w-auto"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Nachricht</label>
              <textarea
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                className="input w-full"
                rows={3}
                placeholder="z.B. Karte vergessen, war aber von 08:00 bis 17:00 anwesend..."
                disabled={isSubmitting}
              />
            </div>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowNewForm(false)}
                className="btn btn-secondary"
                disabled={isSubmitting}
              >
                Abbrechen
              </button>
              <button
                onClick={handleNewComplaint}
                disabled={isSubmitting || !newMessage.trim()}
                className="btn btn-primary flex items-center gap-2"
              >
                {isSubmitting ? (
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <Send size={16} />
                )}
                Absenden
              </button>
            </div>
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

      {/* Gruppierte Liste */}
      {Object.entries(grouped).sort(([a], [b]) => b.localeCompare(a)).map(([monthKey, items]) => (
        <div key={monthKey} className="card">
          <div className="px-5 py-3 bg-gray-50 border-b rounded-t-lg">
            <h3 className="font-semibold text-gray-700 text-sm">
              {format(new Date(monthKey + '-01'), 'MMMM yyyy', { locale: de })}
              <span className="ml-2 text-gray-400 font-normal">({items.length})</span>
            </h3>
          </div>
          <div className="divide-y">
            {items.map(c => (
              <div key={c.id} className="p-4">
                <div className="flex items-start gap-3">
                  <div className={`p-2 rounded-lg mt-0.5 ${c.complaintResolvedAt ? 'bg-green-100' : 'bg-amber-100'}`}>
                    {c.complaintResolvedAt
                      ? <CheckCircle size={18} className="text-green-600" />
                      : <AlertTriangle size={18} className="text-amber-600" />
                    }
                  </div>
                  <div className="flex-1 min-w-0">
                    {/* Datum & Zeit */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-gray-900">
                        {format(new Date(c.clockIn), 'EEEE, dd.MM.yyyy', { locale: de })}
                      </span>
                      <span className="text-sm text-gray-500 flex items-center gap-1">
                        <Clock size={12} />
                        {format(new Date(c.clockIn), 'HH:mm')}
                        {c.clockOut && ` - ${format(new Date(c.clockOut), 'HH:mm')}`}
                      </span>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${c.complaintResolvedAt ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                        {c.complaintResolvedAt ? 'Bearbeitet' : 'Offen'}
                      </span>
                    </div>

                    {/* Nachricht */}
                    <div className="mt-2 p-3 bg-gray-50 rounded-lg">
                      <p className="text-sm text-gray-500 mb-1 flex items-center gap-1">
                        <MessageSquare size={12} />
                        Deine Nachricht
                        <span className="text-xs text-gray-400 ml-auto">{format(new Date(c.complaintAt), 'dd.MM.yyyy HH:mm', { locale: de })}</span>
                      </p>
                      <p className="text-sm text-gray-700">{c.complaintMessage}</p>
                    </div>

                    {/* Antwort */}
                    {c.complaintResolvedAt && (
                      <div className="mt-2 p-3 bg-green-50 rounded-lg">
                        <p className="text-sm text-green-600 mb-1 flex items-center gap-1">
                          <CheckCircle size={12} />
                          Antwort vom Admin
                          <span className="text-xs text-green-400 ml-auto">{format(new Date(c.complaintResolvedAt), 'dd.MM.yyyy HH:mm', { locale: de })}</span>
                        </p>
                        {c.complaintResponse ? (
                          <p className="text-sm text-green-800">{c.complaintResponse}</p>
                        ) : (
                          <p className="text-sm text-green-600 italic">Ohne Kommentar bearbeitet</p>
                        )}
                        {/* Änderungen anzeigen */}
                        {(c.complaintOriginalClockIn || c.complaintOriginalClockOut) && (
                          <div className="mt-2 pt-2 border-t border-green-200 text-xs text-green-700">
                            <span className="font-medium">Änderungen: </span>
                            {c.complaintOriginalClockIn && (
                              <span>Einstempeln: {format(new Date(c.complaintOriginalClockIn), 'HH:mm')} → {format(new Date(c.clockIn), 'HH:mm')} </span>
                            )}
                            {c.complaintOriginalClockOut && c.clockOut && (
                              <span>Ausstempeln: {format(new Date(c.complaintOriginalClockOut), 'HH:mm')} → {format(new Date(c.clockOut), 'HH:mm')}</span>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      {filtered.length === 0 && (
        <div className="card p-12 text-center text-gray-400">
          <MessageSquare size={48} className="mx-auto mb-3 opacity-30" />
          <p>{filter === 'open' ? 'Keine offenen Reklamationen' : filter === 'resolved' ? 'Keine bearbeiteten Reklamationen' : 'Noch keine Reklamationen eingereicht'}</p>
        </div>
      )}
    </div>
  );
}
