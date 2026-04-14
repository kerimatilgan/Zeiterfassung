import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { complaintsApi, employeesApi } from '../../lib/api';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import { AlertTriangle, CheckCircle, Clock, MessageSquare, X, Check, User, Calendar, Search } from 'lucide-react';
import { useState, useMemo } from 'react';
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
  resolvedByName: string | null;
  response: string | null;
  newClockIn: string | null;
  newClockOut: string | null;
  newBreakMinutes: number | null;
  createdAt: string;
  employee: {
    id: string;
    employeeNumber: string;
    firstName: string;
    lastName: string;
  };
  timeEntry?: {
    id: string;
    clockIn: string;
    clockOut: string | null;
    breakMinutes: number;
  } | null;
}

interface Employee {
  id: string;
  firstName: string;
  lastName: string;
  employeeNumber: string;
}

export default function AdminComplaints() {
  const queryClient = useQueryClient();
  const [filterStatus, setFilterStatus] = useState<'all' | 'open' | 'resolved'>('open');
  const [filterEmployee, setFilterEmployee] = useState<string>('');
  const [filterMonth, setFilterMonth] = useState<string>('');
  const [search, setSearch] = useState<string>('');

  const [editing, setEditing] = useState<Complaint | null>(null);
  const [editForm, setEditForm] = useState({ clockIn: '', clockOut: '', breakMinutes: 0 });
  const [adminResponse, setAdminResponse] = useState('');

  const { data: complaints, refetch } = useQuery({
    queryKey: ['adminComplaintsV2'],
    queryFn: () => complaintsApi.getAll().then((r: any) => r.data as Complaint[]),
    refetchInterval: 30000,
  });

  const { data: employees } = useQuery({
    queryKey: ['employees'],
    queryFn: () => employeesApi.getAll().then((r: any) => r.data as Employee[]),
  });

  const resolveMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: any }) => complaintsApi.resolve(id, payload),
    onSuccess: () => {
      toast.success('Reklamation bearbeitet');
      queryClient.invalidateQueries({ queryKey: ['adminComplaintsV2'] });
      queryClient.invalidateQueries({ queryKey: ['pendingComplaints'] });
      setEditing(null);
    },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Fehler'),
  });

  const filtered = useMemo(() => {
    return (complaints || []).filter(c => {
      if (filterStatus === 'open' && c.resolvedAt) return false;
      if (filterStatus === 'resolved' && !c.resolvedAt) return false;
      if (filterEmployee && c.employeeId !== filterEmployee) return false;
      if (filterMonth) {
        const month = format(new Date(c.createdAt), 'yyyy-MM');
        if (month !== filterMonth) return false;
      }
      if (search) {
        const s = search.toLowerCase();
        const name = `${c.employee.firstName} ${c.employee.lastName}`.toLowerCase();
        if (!name.includes(s) && !c.message.toLowerCase().includes(s) && !c.employee.employeeNumber.includes(s)) return false;
      }
      return true;
    });
  }, [complaints, filterStatus, filterEmployee, filterMonth, search]);

  const months = useMemo(() =>
    [...new Set((complaints || []).map(c => format(new Date(c.createdAt), 'yyyy-MM')))].sort().reverse(),
  [complaints]);

  const counts = useMemo(() => {
    const all = complaints?.length ?? 0;
    const open = (complaints || []).filter(c => !c.resolvedAt).length;
    return { all, open, resolved: all - open };
  }, [complaints]);

  const openEdit = (c: Complaint) => {
    setEditing(c);
    if (c.timeEntry) {
      setEditForm({
        clockIn: format(new Date(c.timeEntry.clockIn), "yyyy-MM-dd'T'HH:mm"),
        clockOut: c.timeEntry.clockOut ? format(new Date(c.timeEntry.clockOut), "yyyy-MM-dd'T'HH:mm") : '',
        breakMinutes: c.timeEntry.breakMinutes,
      });
    } else {
      setEditForm({ clockIn: '', clockOut: '', breakMinutes: 0 });
    }
    setAdminResponse('');
  };

  const handleResolve = (apply: boolean) => {
    if (!editing) return;
    const payload: any = { response: adminResponse || undefined };
    if (apply && editing.timeEntry) {
      payload.applyChanges = {
        clockIn: new Date(editForm.clockIn).toISOString(),
        clockOut: editForm.clockOut ? new Date(editForm.clockOut).toISOString() : null,
        breakMinutes: Number(editForm.breakMinutes),
      };
    }
    resolveMutation.mutate({ id: editing.id, payload });
  };

  return (
    <div className="space-y-4 max-w-7xl mx-auto pb-8">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <MessageSquare size={24} /> Reklamationen
          </h1>
          <p className="text-sm text-gray-500 mt-1">Alle Reklamationen mit Historie</p>
        </div>
        <button onClick={() => refetch()} className="text-sm text-gray-600 hover:text-gray-900 px-3 py-1.5 border rounded-lg">
          Aktualisieren
        </button>
      </div>

      {/* Status Tabs */}
      <div className="bg-white border rounded-lg p-1 flex gap-1 w-fit">
        {[
          { value: 'open', label: 'Offen', count: counts.open },
          { value: 'resolved', label: 'Gelöst', count: counts.resolved },
          { value: 'all', label: 'Alle', count: counts.all },
        ].map(tab => (
          <button
            key={tab.value}
            onClick={() => setFilterStatus(tab.value as any)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium flex items-center gap-2 transition ${
              filterStatus === tab.value ? 'bg-primary-100 text-primary-700' : 'text-gray-600 hover:bg-gray-50'
            }`}
          >
            {tab.label}
            <span className={`text-xs px-1.5 py-0.5 rounded-full ${filterStatus === tab.value ? 'bg-primary-200' : 'bg-gray-100'}`}>{tab.count}</span>
          </button>
        ))}
      </div>

      {/* Filter */}
      <div className="bg-white border rounded-lg p-3 flex flex-wrap gap-3 items-center">
        <div className="flex items-center gap-2 flex-1 min-w-[200px]">
          <Search size={16} className="text-gray-400" />
          <input
            type="text"
            placeholder="Suchen (Name, Nachricht, MA-Nr)..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 text-sm border-0 focus:ring-0 outline-none"
          />
        </div>
        <select value={filterEmployee} onChange={(e) => setFilterEmployee(e.target.value)} className="text-sm border rounded px-2 py-1.5">
          <option value="">Alle Mitarbeiter</option>
          {employees?.map(e => (
            <option key={e.id} value={e.id}>{e.firstName} {e.lastName} (#{e.employeeNumber})</option>
          ))}
        </select>
        <select value={filterMonth} onChange={(e) => setFilterMonth(e.target.value)} className="text-sm border rounded px-2 py-1.5">
          <option value="">Alle Monate</option>
          {months.map(m => (
            <option key={m} value={m}>{format(new Date(m + '-01'), 'MMMM yyyy', { locale: de })}</option>
          ))}
        </select>
      </div>

      {/* Liste */}
      {filtered.length === 0 ? (
        <div className="bg-white border rounded-lg p-12 text-center text-gray-400">
          <MessageSquare size={48} className="mx-auto mb-3 opacity-30" />
          <p>Keine Reklamationen{filterStatus === 'open' ? ' offen' : ''}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(c => {
            const isResolved = !!c.resolvedAt;
            const dayDate = new Date(c.date);
            return (
              <div key={c.id} className={`bg-white border-l-4 border rounded-lg p-4 ${isResolved ? 'border-l-green-500' : 'border-l-amber-500'}`}>
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="flex items-start gap-3 flex-1 min-w-[250px]">
                    {isResolved ? <CheckCircle className="text-green-500 mt-1 shrink-0" size={20} /> : <AlertTriangle className="text-amber-500 mt-1 shrink-0" size={20} />}
                    <div className="flex-1">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className="font-semibold text-gray-900 flex items-center gap-1">
                          <User size={14} className="text-gray-500" />
                          {c.employee.firstName} {c.employee.lastName}
                        </span>
                        <span className="text-xs text-gray-500">#{c.employee.employeeNumber}</span>
                        <span className="text-sm text-gray-700 flex items-center gap-1 ml-2">
                          <Calendar size={14} className="text-gray-500" />
                          {format(dayDate, 'EEEE, dd.MM.yyyy', { locale: de })}
                        </span>
                        {c.timeEntry ? (
                          <span className="text-sm text-gray-700 flex items-center gap-1">
                            <Clock size={14} className="text-gray-500" />
                            {format(new Date(c.timeEntry.clockIn), 'HH:mm')} - {c.timeEntry.clockOut ? format(new Date(c.timeEntry.clockOut), 'HH:mm') : '—'}
                          </span>
                        ) : (
                          <span className="text-xs text-gray-500 italic">Tag-Reklamation</span>
                        )}
                      </div>
                      <div className="text-xs text-gray-500 mb-2">
                        Eingereicht: {format(new Date(c.createdAt), 'dd.MM.yyyy HH:mm', { locale: de })}
                      </div>
                      <div className="text-sm text-gray-800 whitespace-pre-wrap bg-gray-50 rounded px-3 py-2">
                        {c.message}
                      </div>
                      {isResolved && c.response && (
                        <div className="mt-2 text-sm text-gray-700 bg-green-50 rounded px-3 py-2 border border-green-200">
                          <div className="text-xs font-semibold text-green-700 mb-0.5">
                            Antwort{c.resolvedByName && ` (${c.resolvedByName})`}:
                          </div>
                          {c.response}
                        </div>
                      )}
                      {isResolved && (c.originalClockIn || c.newClockIn) && (() => {
                        const fmt = (d: string | null) => d ? format(new Date(d), 'HH:mm') : '—';
                        const oldStr = `${fmt(c.originalClockIn)} - ${fmt(c.originalClockOut)}`;
                        const newStr = `${fmt(c.newClockIn)} - ${fmt(c.newClockOut)}`;
                        const changed = oldStr !== newStr || c.originalBreakMinutes !== c.newBreakMinutes;
                        return (
                          <div className="mt-2 text-xs text-gray-600 border-t pt-2">
                            {changed ? (
                              <>
                                <span className="font-semibold">Änderungen:</span>{' '}
                                <span className="line-through text-gray-400">{oldStr}</span>
                                <span className="mx-2">→</span>
                                <span className="font-semibold text-green-700">{newStr}</span>
                              </>
                            ) : (
                              <span className="text-gray-500 italic">Ohne Zeitänderung</span>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                  {!isResolved && (
                    <button
                      onClick={() => openEdit(c)}
                      className="text-sm bg-primary-600 text-white px-4 py-1.5 rounded-lg hover:bg-primary-700 shrink-0"
                    >
                      Bearbeiten
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Edit-Popup */}
      {editing && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setEditing(null)}>
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="p-5 border-b flex items-center justify-between">
              <h2 className="text-lg font-semibold">Reklamation bearbeiten</h2>
              <button onClick={() => setEditing(null)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
            </div>
            <div className="p-5 space-y-4">
              <div className="bg-amber-50 border border-amber-200 rounded p-3 text-sm">
                <div className="font-semibold text-amber-800 mb-1">
                  {editing.employee.firstName} {editing.employee.lastName} · {format(new Date(editing.date), 'dd.MM.yyyy', { locale: de })}
                </div>
                <div className="text-gray-700 whitespace-pre-wrap">{editing.message}</div>
              </div>

              {editing.timeEntry ? (
                <>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">Einstempelzeit</label>
                    <input type="datetime-local" value={editForm.clockIn} onChange={e => setEditForm({ ...editForm, clockIn: e.target.value })} className="w-full border rounded px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">Ausstempelzeit</label>
                    <input type="datetime-local" value={editForm.clockOut} onChange={e => setEditForm({ ...editForm, clockOut: e.target.value })} className="w-full border rounded px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">Pause (Minuten)</label>
                    <input type="number" min="0" value={editForm.breakMinutes} onChange={e => setEditForm({ ...editForm, breakMinutes: Number(e.target.value) })} className="w-full border rounded px-3 py-2 text-sm" />
                  </div>
                </>
              ) : (
                <div className="text-sm text-gray-500 italic bg-gray-50 rounded p-3">
                  Tag-Reklamation ohne Stempelung. Du kannst hier nur antworten oder ggf. einen manuellen Eintrag im Zeiteinträge-Tab erstellen.
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Antwort an Mitarbeiter (optional)</label>
                <textarea value={adminResponse} onChange={e => setAdminResponse(e.target.value)} rows={3} placeholder="z.B. Eintrag wurde wie gewünscht angepasst..." className="w-full border rounded px-3 py-2 text-sm" />
              </div>
            </div>
            <div className="p-5 border-t flex items-center justify-end gap-2">
              <button onClick={() => setEditing(null)} className="text-sm text-gray-600 hover:bg-gray-100 px-4 py-2 rounded-lg">Abbrechen</button>
              <button
                onClick={() => handleResolve(false)}
                disabled={resolveMutation.isPending}
                className="text-sm text-gray-700 border border-gray-300 hover:bg-gray-50 px-4 py-2 rounded-lg flex items-center gap-1.5"
              >
                <Check size={14} /> Ohne Änderung schließen
              </button>
              {editing.timeEntry && (
                <button
                  onClick={() => handleResolve(true)}
                  disabled={resolveMutation.isPending}
                  className="text-sm bg-primary-600 text-white hover:bg-primary-700 px-4 py-2 rounded-lg flex items-center gap-1.5"
                >
                  <Check size={14} /> Änderungen speichern & schließen
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
