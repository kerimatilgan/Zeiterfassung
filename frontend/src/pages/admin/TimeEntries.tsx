import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { timeEntriesApi, employeesApi } from '../../lib/api';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import toast from 'react-hot-toast';
import { Plus, Edit2, Trash2, Filter, X } from 'lucide-react';

interface TimeEntry {
  id: string;
  employeeId: string;
  clockIn: string;
  clockOut: string | null;
  breakMinutes: number;
  note: string | null;
  isManual: boolean;
  editedBy: string | null;
  employee: {
    id: string;
    employeeNumber: string;
    firstName: string;
    lastName: string;
  };
}

export default function AdminTimeEntries() {
  const [showModal, setShowModal] = useState(false);
  const [editingEntry, setEditingEntry] = useState<TimeEntry | null>(null);
  const [filterEmployeeId, setFilterEmployeeId] = useState('');
  const [filterDate, setFilterDate] = useState('');

  const queryClient = useQueryClient();

  const { data: employees } = useQuery({
    queryKey: ['employees'],
    queryFn: () => employeesApi.getAll().then((r) => r.data),
  });

  const { data: entries, isLoading } = useQuery({
    queryKey: ['time-entries', filterEmployeeId, filterDate],
    queryFn: () => {
      const params: any = {};
      if (filterEmployeeId) params.employeeId = filterEmployeeId;
      if (filterDate) {
        params.from = filterDate;
        params.to = filterDate + 'T23:59:59';
      }
      return timeEntriesApi.getAll(params).then((r) => r.data as TimeEntry[]);
    },
  });

  const [formData, setFormData] = useState({
    employeeId: '',
    clockIn: '',
    clockOut: '',
    breakMinutes: 0,
    note: '',
  });

  const createMutation = useMutation({
    mutationFn: (data: any) => timeEntriesApi.createManual(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['time-entries'] });
      toast.success('Zeiteintrag erstellt');
      closeModal();
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Fehler beim Erstellen');
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => timeEntriesApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['time-entries'] });
      toast.success('Zeiteintrag aktualisiert');
      closeModal();
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Fehler beim Aktualisieren');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => timeEntriesApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['time-entries'] });
      toast.success('Zeiteintrag gelöscht');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Fehler beim Löschen');
    },
  });

  const openCreateModal = () => {
    setEditingEntry(null);
    setFormData({
      employeeId: '',
      clockIn: '',
      clockOut: '',
      breakMinutes: 0,
      note: '',
    });
    setShowModal(true);
  };

  const openEditModal = (entry: TimeEntry) => {
    setEditingEntry(entry);
    setFormData({
      employeeId: entry.employeeId,
      clockIn: entry.clockIn.slice(0, 16),
      clockOut: entry.clockOut ? entry.clockOut.slice(0, 16) : '',
      breakMinutes: entry.breakMinutes,
      note: entry.note || '',
    });
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingEntry(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const data = {
      employeeId: formData.employeeId,
      clockIn: new Date(formData.clockIn).toISOString(),
      clockOut: formData.clockOut ? new Date(formData.clockOut).toISOString() : null,
      breakMinutes: formData.breakMinutes,
      note: formData.note || null,
    };

    if (editingEntry) {
      updateMutation.mutate({ id: editingEntry.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const handleDelete = (entry: TimeEntry) => {
    if (confirm('Zeiteintrag wirklich löschen?')) {
      deleteMutation.mutate(entry.id);
    }
  };

  const calculateHours = (entry: TimeEntry) => {
    if (!entry.clockOut) return '-';
    const ms = new Date(entry.clockOut).getTime() - new Date(entry.clockIn).getTime();
    const hours = ms / (1000 * 60 * 60) - entry.breakMinutes / 60;
    return hours.toFixed(2);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Zeiteinträge</h1>
          <p className="text-gray-500">Alle Zeiteinträge verwalten</p>
        </div>
        <button onClick={openCreateModal} className="btn btn-primary flex items-center gap-2">
          <Plus size={20} />
          Neuer Eintrag
        </button>
      </div>

      {/* Filters */}
      <div className="card p-4">
        <div className="flex flex-wrap items-center gap-4">
          <Filter size={20} className="text-gray-400" />
          <select
            value={filterEmployeeId}
            onChange={(e) => setFilterEmployeeId(e.target.value)}
            className="input w-auto"
          >
            <option value="">Alle Mitarbeiter</option>
            {employees?.map((emp: any) => (
              <option key={emp.id} value={emp.id}>
                {emp.firstName} {emp.lastName}
              </option>
            ))}
          </select>
          <input
            type="date"
            value={filterDate}
            onChange={(e) => setFilterDate(e.target.value)}
            className="input w-auto"
          />
          {(filterEmployeeId || filterDate) && (
            <button
              onClick={() => {
                setFilterEmployeeId('');
                setFilterDate('');
              }}
              className="text-sm text-gray-500 hover:text-gray-700"
            >
              Filter zurücksetzen
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Mitarbeiter
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Datum
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Ein
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Aus
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Pause
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Stunden
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                  Aktionen
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {isLoading ? (
                <tr>
                  <td colSpan={7} className="px-6 py-8 text-center text-gray-500">
                    Laden...
                  </td>
                </tr>
              ) : entries?.length ? (
                entries.map((entry) => (
                  <tr key={entry.id}>
                    <td className="px-6 py-4">
                      <p className="font-medium text-gray-900">
                        {entry.employee.firstName} {entry.employee.lastName}
                      </p>
                      <p className="text-sm text-gray-500">#{entry.employee.employeeNumber}</p>
                    </td>
                    <td className="px-6 py-4 text-gray-900">
                      {format(new Date(entry.clockIn), 'dd.MM.yyyy', { locale: de })}
                    </td>
                    <td className="px-6 py-4 text-gray-900">
                      {format(new Date(entry.clockIn), 'HH:mm')}
                    </td>
                    <td className="px-6 py-4">
                      {entry.clockOut ? (
                        format(new Date(entry.clockOut), 'HH:mm')
                      ) : (
                        <span className="text-green-600 font-medium">Aktiv</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-gray-600">{entry.breakMinutes} min</td>
                    <td className="px-6 py-4 font-medium text-gray-900">
                      {calculateHours(entry)} h
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => openEditModal(entry)}
                          className="p-2 text-gray-500 hover:text-primary-600 hover:bg-primary-50 rounded-lg"
                        >
                          <Edit2 size={18} />
                        </button>
                        <button
                          onClick={() => handleDelete(entry)}
                          className="p-2 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg"
                        >
                          <Trash2 size={18} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} className="px-6 py-8 text-center text-gray-500">
                    Keine Einträge gefunden
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg">
            <div className="p-6 border-b border-gray-100 flex items-center justify-between">
              <h2 className="text-xl font-semibold">
                {editingEntry ? 'Zeiteintrag bearbeiten' : 'Neuer Zeiteintrag'}
              </h2>
              <button onClick={closeModal} className="p-2 hover:bg-gray-100 rounded-lg">
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              {!editingEntry && (
                <div>
                  <label className="label">Mitarbeiter</label>
                  <select
                    value={formData.employeeId}
                    onChange={(e) => setFormData({ ...formData, employeeId: e.target.value })}
                    className="input"
                    required
                  >
                    <option value="">Bitte wählen...</option>
                    {employees?.map((emp: any) => (
                      <option key={emp.id} value={emp.id}>
                        {emp.firstName} {emp.lastName} (#{emp.employeeNumber})
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Einstempeln</label>
                  <input
                    type="datetime-local"
                    value={formData.clockIn}
                    onChange={(e) => setFormData({ ...formData, clockIn: e.target.value })}
                    className="input"
                    required
                  />
                </div>
                <div>
                  <label className="label">Ausstempeln</label>
                  <input
                    type="datetime-local"
                    value={formData.clockOut}
                    onChange={(e) => setFormData({ ...formData, clockOut: e.target.value })}
                    className="input"
                  />
                </div>
              </div>
              <div>
                <label className="label">Pause (Minuten)</label>
                <input
                  type="number"
                  min="0"
                  value={formData.breakMinutes}
                  onChange={(e) => setFormData({ ...formData, breakMinutes: parseInt(e.target.value) || 0 })}
                  className="input"
                />
              </div>
              <div>
                <label className="label">Notiz</label>
                <textarea
                  value={formData.note}
                  onChange={(e) => setFormData({ ...formData, note: e.target.value })}
                  className="input"
                  rows={2}
                />
              </div>
              <div className="flex justify-end gap-3 pt-4">
                <button type="button" onClick={closeModal} className="btn btn-secondary">
                  Abbrechen
                </button>
                <button type="submit" className="btn btn-primary">
                  {editingEntry ? 'Speichern' : 'Erstellen'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
