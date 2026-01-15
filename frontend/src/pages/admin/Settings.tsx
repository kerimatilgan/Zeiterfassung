import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { settingsApi } from '../../lib/api';
import toast from 'react-hot-toast';
import { Save, Building2, Clock, Calendar, Trash2, Plus, X } from 'lucide-react';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';

export default function AdminSettings() {
  const queryClient = useQueryClient();

  const { data: settings, isLoading } = useQuery({
    queryKey: ['settings'],
    queryFn: () => settingsApi.get().then((r) => r.data),
  });

  const { data: holidays } = useQuery({
    queryKey: ['holidays'],
    queryFn: () => settingsApi.getHolidays().then((r) => r.data),
  });

  const [formData, setFormData] = useState({
    companyName: '',
    companyAddress: '',
    companyPhone: '',
    companyEmail: '',
    defaultBreakMinutes: 30,
    overtimeThreshold: 40,
  });

  const [showHolidayModal, setShowHolidayModal] = useState(false);
  const [holidayForm, setHolidayForm] = useState({ date: '', name: '' });

  useEffect(() => {
    if (settings) {
      setFormData({
        companyName: settings.companyName || '',
        companyAddress: settings.companyAddress || '',
        companyPhone: settings.companyPhone || '',
        companyEmail: settings.companyEmail || '',
        defaultBreakMinutes: settings.defaultBreakMinutes || 30,
        overtimeThreshold: settings.overtimeThreshold || 40,
      });
    }
  }, [settings]);

  const updateMutation = useMutation({
    mutationFn: (data: typeof formData) => settingsApi.update(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      toast.success('Einstellungen gespeichert');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Fehler beim Speichern');
    },
  });

  const createHolidayMutation = useMutation({
    mutationFn: (data: { date: string; name: string }) =>
      settingsApi.createHoliday({ ...data, date: new Date(data.date).toISOString() }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['holidays'] });
      toast.success('Feiertag hinzugefügt');
      setShowHolidayModal(false);
      setHolidayForm({ date: '', name: '' });
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Fehler beim Hinzufügen');
    },
  });

  const deleteHolidayMutation = useMutation({
    mutationFn: (id: string) => settingsApi.deleteHoliday(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['holidays'] });
      toast.success('Feiertag gelöscht');
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateMutation.mutate(formData);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-primary-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Einstellungen</h1>
        <p className="text-gray-500">System-Einstellungen verwalten</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Company Settings */}
        <form onSubmit={handleSubmit} className="card">
          <div className="p-6 border-b border-gray-100">
            <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
              <Building2 size={20} />
              Firmendaten
            </h2>
          </div>
          <div className="p-6 space-y-4">
            <div>
              <label className="label">Firmenname</label>
              <input
                type="text"
                value={formData.companyName}
                onChange={(e) => setFormData({ ...formData, companyName: e.target.value })}
                className="input"
                required
              />
            </div>
            <div>
              <label className="label">Adresse</label>
              <input
                type="text"
                value={formData.companyAddress}
                onChange={(e) => setFormData({ ...formData, companyAddress: e.target.value })}
                className="input"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">Telefon</label>
                <input
                  type="tel"
                  value={formData.companyPhone}
                  onChange={(e) => setFormData({ ...formData, companyPhone: e.target.value })}
                  className="input"
                />
              </div>
              <div>
                <label className="label">E-Mail</label>
                <input
                  type="email"
                  value={formData.companyEmail}
                  onChange={(e) => setFormData({ ...formData, companyEmail: e.target.value })}
                  className="input"
                />
              </div>
            </div>
          </div>
          <div className="p-6 border-t border-gray-100">
            <h3 className="font-medium text-gray-900 flex items-center gap-2 mb-4">
              <Clock size={18} />
              Zeiterfassung
            </h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">Standard-Pause (Min.)</label>
                <input
                  type="number"
                  min="0"
                  max="120"
                  value={formData.defaultBreakMinutes}
                  onChange={(e) =>
                    setFormData({ ...formData, defaultBreakMinutes: parseInt(e.target.value) || 0 })
                  }
                  className="input"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Automatische Pause bei mehr als 6h Arbeitszeit
                </p>
              </div>
              <div>
                <label className="label">Überstunden ab (h/Woche)</label>
                <input
                  type="number"
                  min="0"
                  max="168"
                  value={formData.overtimeThreshold}
                  onChange={(e) =>
                    setFormData({ ...formData, overtimeThreshold: parseFloat(e.target.value) || 0 })
                  }
                  className="input"
                />
              </div>
            </div>
          </div>
          <div className="p-6 border-t border-gray-100 flex justify-end">
            <button
              type="submit"
              disabled={updateMutation.isPending}
              className="btn btn-primary flex items-center gap-2"
            >
              <Save size={18} />
              Speichern
            </button>
          </div>
        </form>

        {/* Holidays */}
        <div className="card">
          <div className="p-6 border-b border-gray-100 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
              <Calendar size={20} />
              Feiertage
            </h2>
            <button
              onClick={() => setShowHolidayModal(true)}
              className="btn btn-secondary flex items-center gap-2 text-sm"
            >
              <Plus size={16} />
              Hinzufügen
            </button>
          </div>
          <div className="divide-y divide-gray-100 max-h-96 overflow-y-auto">
            {holidays?.length ? (
              holidays.map((holiday: any) => (
                <div key={holiday.id} className="p-4 flex items-center justify-between">
                  <div>
                    <p className="font-medium text-gray-900">{holiday.name}</p>
                    <p className="text-sm text-gray-500">
                      {format(new Date(holiday.date), 'EEEE, dd. MMMM yyyy', { locale: de })}
                    </p>
                  </div>
                  <button
                    onClick={() => deleteHolidayMutation.mutate(holiday.id)}
                    className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg"
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              ))
            ) : (
              <div className="p-8 text-center text-gray-500">Keine Feiertage eingetragen</div>
            )}
          </div>
        </div>
      </div>

      {/* Holiday Modal */}
      {showHolidayModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
            <div className="p-6 border-b border-gray-100 flex items-center justify-between">
              <h2 className="text-xl font-semibold">Feiertag hinzufügen</h2>
              <button
                onClick={() => setShowHolidayModal(false)}
                className="p-2 hover:bg-gray-100 rounded-lg"
              >
                <X size={20} />
              </button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                createHolidayMutation.mutate(holidayForm);
              }}
              className="p-6 space-y-4"
            >
              <div>
                <label className="label">Datum</label>
                <input
                  type="date"
                  value={holidayForm.date}
                  onChange={(e) => setHolidayForm({ ...holidayForm, date: e.target.value })}
                  className="input"
                  required
                />
              </div>
              <div>
                <label className="label">Bezeichnung</label>
                <input
                  type="text"
                  value={holidayForm.name}
                  onChange={(e) => setHolidayForm({ ...holidayForm, name: e.target.value })}
                  className="input"
                  placeholder="z.B. Weihnachten"
                  required
                />
              </div>
              <div className="flex justify-end gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowHolidayModal(false)}
                  className="btn btn-secondary"
                >
                  Abbrechen
                </button>
                <button type="submit" className="btn btn-primary">
                  Hinzufügen
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
