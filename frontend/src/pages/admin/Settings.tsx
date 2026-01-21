import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { settingsApi } from '../../lib/api';
import toast from 'react-hot-toast';
import { Save, Building2, Clock, Calendar, Trash2, Plus, X, Briefcase, Edit2 } from 'lucide-react';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';

// Formatiert Dezimalstunden zu H:MM Format (nur volle Minuten, keine Sekunden)
const formatHoursToTime = (hours: number): string => {
  const h = Math.floor(hours);
  const m = Math.floor((hours - h) * 60);
  return `${h}:${m.toString().padStart(2, '0')}`;
};

interface AbsenceType {
  id: string;
  name: string;
  shortName: string;
  requiredHours: number;
  color: string;
  isActive: boolean;
  sortOrder: number;
}

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

  const { data: absenceTypes } = useQuery({
    queryKey: ['absence-types'],
    queryFn: () => settingsApi.getAllAbsenceTypes().then((r) => r.data as AbsenceType[]),
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

  const [showAbsenceTypeModal, setShowAbsenceTypeModal] = useState(false);
  const [editingAbsenceType, setEditingAbsenceType] = useState<AbsenceType | null>(null);
  const [absenceTypeForm, setAbsenceTypeForm] = useState({
    name: '',
    shortName: '',
    requiredHours: 0,
    color: '#3B82F6',
    isActive: true,
    sortOrder: 0,
  });

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

  // Abwesenheitstyp Mutations
  const createAbsenceTypeMutation = useMutation({
    mutationFn: (data: typeof absenceTypeForm) => settingsApi.createAbsenceType(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['absence-types'] });
      toast.success('Abwesenheitstyp erstellt');
      closeAbsenceTypeModal();
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Fehler beim Erstellen');
    },
  });

  const updateAbsenceTypeMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: typeof absenceTypeForm }) =>
      settingsApi.updateAbsenceType(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['absence-types'] });
      toast.success('Abwesenheitstyp aktualisiert');
      closeAbsenceTypeModal();
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Fehler beim Aktualisieren');
    },
  });

  const deleteAbsenceTypeMutation = useMutation({
    mutationFn: (id: string) => settingsApi.deleteAbsenceType(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['absence-types'] });
      toast.success('Abwesenheitstyp gelöscht');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Fehler beim Löschen');
    },
  });

  const openCreateAbsenceTypeModal = () => {
    setEditingAbsenceType(null);
    setAbsenceTypeForm({
      name: '',
      shortName: '',
      requiredHours: 0,
      color: '#3B82F6',
      isActive: true,
      sortOrder: absenceTypes?.length ?? 0,
    });
    setShowAbsenceTypeModal(true);
  };

  const openEditAbsenceTypeModal = (type: AbsenceType) => {
    setEditingAbsenceType(type);
    setAbsenceTypeForm({
      name: type.name,
      shortName: type.shortName,
      requiredHours: type.requiredHours,
      color: type.color,
      isActive: type.isActive,
      sortOrder: type.sortOrder,
    });
    setShowAbsenceTypeModal(true);
  };

  const closeAbsenceTypeModal = () => {
    setShowAbsenceTypeModal(false);
    setEditingAbsenceType(null);
  };

  const handleAbsenceTypeSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingAbsenceType) {
      updateAbsenceTypeMutation.mutate({ id: editingAbsenceType.id, data: absenceTypeForm });
    } else {
      createAbsenceTypeMutation.mutate(absenceTypeForm);
    }
  };

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

        {/* Absence Types */}
        <div className="card lg:col-span-2">
          <div className="p-6 border-b border-gray-100 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                <Briefcase size={20} />
                Abwesenheitstypen
              </h2>
              <p className="text-sm text-gray-500 mt-1">
                Urlaub, Schule und andere Abwesenheiten konfigurieren
              </p>
            </div>
            <button
              onClick={openCreateAbsenceTypeModal}
              className="btn btn-secondary flex items-center gap-2 text-sm"
            >
              <Plus size={16} />
              Neuer Typ
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Bezeichnung
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Kürzel
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Pflichtstunden
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Farbe
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Status
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                    Aktionen
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {absenceTypes?.length ? (
                  absenceTypes.map((type) => (
                    <tr key={type.id}>
                      <td className="px-6 py-4 font-medium text-gray-900">{type.name}</td>
                      <td className="px-6 py-4">
                        <span
                          className="px-2 py-1 rounded text-sm font-medium"
                          style={{ backgroundColor: type.color + '20', color: type.color }}
                        >
                          {type.shortName}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-gray-600">
                        {type.requiredHours === 0 ? (
                          <span className="text-green-600">Keine (0h)</span>
                        ) : (
                          `${formatHoursToTime(type.requiredHours)} h`
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <div
                          className="w-6 h-6 rounded-full border border-gray-200"
                          style={{ backgroundColor: type.color }}
                        />
                      </td>
                      <td className="px-6 py-4">
                        {type.isActive ? (
                          <span className="px-2 py-1 bg-green-100 text-green-700 rounded-full text-xs font-medium">
                            Aktiv
                          </span>
                        ) : (
                          <span className="px-2 py-1 bg-gray-100 text-gray-600 rounded-full text-xs font-medium">
                            Inaktiv
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => openEditAbsenceTypeModal(type)}
                            className="p-2 text-gray-500 hover:text-primary-600 hover:bg-primary-50 rounded-lg"
                          >
                            <Edit2 size={18} />
                          </button>
                          <button
                            onClick={() => {
                              if (confirm('Abwesenheitstyp wirklich löschen?')) {
                                deleteAbsenceTypeMutation.mutate(type.id);
                              }
                            }}
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
                    <td colSpan={6} className="px-6 py-8 text-center text-gray-500">
                      Keine Abwesenheitstypen konfiguriert
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
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

      {/* Absence Type Modal */}
      {showAbsenceTypeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg">
            <div className="p-6 border-b border-gray-100 flex items-center justify-between">
              <h2 className="text-xl font-semibold">
                {editingAbsenceType ? 'Abwesenheitstyp bearbeiten' : 'Neuer Abwesenheitstyp'}
              </h2>
              <button onClick={closeAbsenceTypeModal} className="p-2 hover:bg-gray-100 rounded-lg">
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleAbsenceTypeSubmit} className="p-6 space-y-4">
              <div>
                <label className="label">Bezeichnung</label>
                <input
                  type="text"
                  value={absenceTypeForm.name}
                  onChange={(e) => setAbsenceTypeForm({ ...absenceTypeForm, name: e.target.value })}
                  className="input"
                  placeholder="z.B. Urlaub, Berufsschule (ganztags)"
                  required
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Kürzel</label>
                  <input
                    type="text"
                    value={absenceTypeForm.shortName}
                    onChange={(e) =>
                      setAbsenceTypeForm({ ...absenceTypeForm, shortName: e.target.value })
                    }
                    className="input"
                    placeholder="z.B. U, BS"
                    maxLength={10}
                    required
                  />
                  <p className="text-xs text-gray-500 mt-1">Max. 10 Zeichen</p>
                </div>
                <div>
                  <label className="label">Pflichtstunden</label>
                  <input
                    type="number"
                    min="0"
                    max="24"
                    step="0.5"
                    value={absenceTypeForm.requiredHours}
                    onChange={(e) =>
                      setAbsenceTypeForm({
                        ...absenceTypeForm,
                        requiredHours: parseFloat(e.target.value) || 0,
                      })
                    }
                    className="input"
                  />
                  <p className="text-xs text-gray-500 mt-1">0 = keine Pflichtstunden</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Farbe</label>
                  <div className="flex items-center gap-3">
                    <input
                      type="color"
                      value={absenceTypeForm.color}
                      onChange={(e) =>
                        setAbsenceTypeForm({ ...absenceTypeForm, color: e.target.value })
                      }
                      className="w-12 h-10 rounded border border-gray-300 cursor-pointer"
                    />
                    <input
                      type="text"
                      value={absenceTypeForm.color}
                      onChange={(e) =>
                        setAbsenceTypeForm({ ...absenceTypeForm, color: e.target.value })
                      }
                      className="input flex-1"
                      pattern="^#[0-9A-Fa-f]{6}$"
                      placeholder="#3B82F6"
                    />
                  </div>
                </div>
                <div>
                  <label className="label">Status</label>
                  <select
                    value={absenceTypeForm.isActive ? 'active' : 'inactive'}
                    onChange={(e) =>
                      setAbsenceTypeForm({
                        ...absenceTypeForm,
                        isActive: e.target.value === 'active',
                      })
                    }
                    className="input"
                  >
                    <option value="active">Aktiv</option>
                    <option value="inactive">Inaktiv</option>
                  </select>
                  <p className="text-xs text-gray-500 mt-1">
                    Inaktive Typen können nicht mehr zugewiesen werden
                  </p>
                </div>
              </div>
              <div className="flex justify-end gap-3 pt-4">
                <button type="button" onClick={closeAbsenceTypeModal} className="btn btn-secondary">
                  Abbrechen
                </button>
                <button type="submit" className="btn btn-primary">
                  {editingAbsenceType ? 'Speichern' : 'Erstellen'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
