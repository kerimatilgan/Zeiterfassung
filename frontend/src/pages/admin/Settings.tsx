import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { settingsApi } from '../../lib/api';
import toast from 'react-hot-toast';
import { Save, Building2, Clock, Calendar, Trash2, Plus, X, Briefcase, Edit2, Wand2, MapPin, AlertCircle, Database, Download, Upload, HardDrive, Mail, Send, CheckCircle, Monitor, Copy, Key } from 'lucide-react';
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

interface WorkCategory {
  id: string;
  name: string;
  earliestClockIn: string;
  isActive: boolean;
  sortOrder: number;
}

interface Terminal {
  id: string;
  name: string;
  isActive: boolean;
  isOnline: boolean;
  lastSeen: string | null;
  ipAddress: string | null;
  version: string | null;
  createdAt: string;
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

  const { data: workCategories } = useQuery({
    queryKey: ['work-categories'],
    queryFn: () => settingsApi.getAllWorkCategories().then((r) => r.data as WorkCategory[]),
  });

  const { data: terminals } = useQuery({
    queryKey: ['terminals'],
    queryFn: () => settingsApi.getTerminals().then((r) => r.data as Terminal[]),
    refetchInterval: 30000,
  });

  const { data: bundeslandInfo } = useQuery({
    queryKey: ['bundesland-info'],
    queryFn: () => settingsApi.getBundeslandInfo().then((r) => r.data),
  });

  const { data: bundeslaender } = useQuery({
    queryKey: ['bundeslaender'],
    queryFn: () => settingsApi.getBundeslaender().then((r) => r.data as { code: string; name: string }[]),
  });

  const { data: databaseInfo, refetch: refetchDatabaseInfo } = useQuery({
    queryKey: ['database-info'],
    queryFn: () => settingsApi.getDatabaseInfo().then((r) => r.data),
  });

  const { data: mailSettings, refetch: refetchMailSettings } = useQuery({
    queryKey: ['mail-settings'],
    queryFn: () => settingsApi.getMailSettings().then((r) => r.data),
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

  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const [generateForm, setGenerateForm] = useState({
    year: new Date().getFullYear(),
    bundesland: '',
    deleteExisting: true,
  });

  const [showAbsenceTypeModal, setShowAbsenceTypeModal] = useState(false);
  const [editingAbsenceType, setEditingAbsenceType] = useState<AbsenceType | null>(null);
  const [showRestoreModal, setShowRestoreModal] = useState(false);
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);

  // Mail-Server Einstellungen
  const [mailFormData, setMailFormData] = useState({
    smtpHost: '',
    smtpPort: 587,
    smtpUser: '',
    smtpPassword: '',
    smtpFromAddress: '',
    smtpFromName: 'Zeiterfassung',
    smtpSecure: false,
  });
  const [testEmail, setTestEmail] = useState('');
  const [isSendingTest, setIsSendingTest] = useState(false);
  const [absenceTypeForm, setAbsenceTypeForm] = useState({
    name: '',
    shortName: '',
    requiredHours: 0,
    color: '#3B82F6',
    isActive: true,
    sortOrder: 0,
  });

  // Arbeitskategorien State
  const [showWorkCategoryModal, setShowWorkCategoryModal] = useState(false);
  const [editingWorkCategory, setEditingWorkCategory] = useState<WorkCategory | null>(null);
  const [workCategoryForm, setWorkCategoryForm] = useState({
    name: '',
    earliestClockIn: '08:00',
    isActive: true,
    sortOrder: 0,
  });

  // Terminal State
  const [showTerminalModal, setShowTerminalModal] = useState(false);
  const [editingTerminal, setEditingTerminal] = useState<Terminal | null>(null);
  const [terminalForm, setTerminalForm] = useState({ name: '', isActive: true });
  const [showApiKeyModal, setShowApiKeyModal] = useState(false);
  const [displayedApiKey, setDisplayedApiKey] = useState('');
  const [apiKeyCopied, setApiKeyCopied] = useState(false);

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

  useEffect(() => {
    if (mailSettings) {
      setMailFormData({
        smtpHost: mailSettings.smtpHost || '',
        smtpPort: mailSettings.smtpPort || 587,
        smtpUser: mailSettings.smtpUser || '',
        smtpPassword: mailSettings.smtpPassword || '',
        smtpFromAddress: mailSettings.smtpFromAddress || '',
        smtpFromName: mailSettings.smtpFromName || 'Zeiterfassung',
        smtpSecure: mailSettings.smtpSecure || false,
      });
    }
  }, [mailSettings]);

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

  const updateMailMutation = useMutation({
    mutationFn: (data: typeof mailFormData) => settingsApi.updateMailSettings(data),
    onSuccess: () => {
      refetchMailSettings();
      toast.success('Mail-Einstellungen gespeichert');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Fehler beim Speichern');
    },
  });

  const handleTestMail = async () => {
    if (!testEmail) {
      toast.error('Bitte Test-E-Mail-Adresse eingeben');
      return;
    }
    setIsSendingTest(true);
    try {
      await settingsApi.testMailSettings(testEmail);
      toast.success(`Test-E-Mail wurde an ${testEmail} gesendet`);
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Fehler beim Senden der Test-E-Mail');
    } finally {
      setIsSendingTest(false);
    }
  };

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

  const generateHolidaysMutation = useMutation({
    mutationFn: (data: { year: number; bundesland?: string; deleteExisting?: boolean }) =>
      settingsApi.generateHolidays(data),
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: ['holidays'] });
      const { created, skipped, bundeslandName, year } = response.data;
      toast.success(`${created} Feiertage für ${bundeslandName} ${year} erstellt${skipped > 0 ? ` (${skipped} übersprungen)` : ''}`);
      setShowGenerateModal(false);
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Fehler beim Generieren der Feiertage');
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

  // Arbeitskategorien Mutations
  const createWorkCategoryMutation = useMutation({
    mutationFn: (data: typeof workCategoryForm) => settingsApi.createWorkCategory(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['work-categories'] });
      toast.success('Arbeitskategorie erstellt');
      closeWorkCategoryModal();
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Fehler beim Erstellen');
    },
  });

  const updateWorkCategoryMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: typeof workCategoryForm }) =>
      settingsApi.updateWorkCategory(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['work-categories'] });
      toast.success('Arbeitskategorie aktualisiert');
      closeWorkCategoryModal();
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Fehler beim Aktualisieren');
    },
  });

  const deleteWorkCategoryMutation = useMutation({
    mutationFn: (id: string) => settingsApi.deleteWorkCategory(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['work-categories'] });
      toast.success('Arbeitskategorie gelöscht');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Fehler beim Löschen');
    },
  });

  // Terminal Mutations
  const createTerminalMutation = useMutation({
    mutationFn: (data: { name: string }) => settingsApi.createTerminal(data),
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: ['terminals'] });
      toast.success('Terminal erstellt');
      setShowTerminalModal(false);
      // API-Key einmalig anzeigen
      setDisplayedApiKey(response.data.apiKey);
      setApiKeyCopied(false);
      setShowApiKeyModal(true);
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Fehler beim Erstellen');
    },
  });

  const updateTerminalMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: { name?: string; isActive?: boolean } }) =>
      settingsApi.updateTerminal(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['terminals'] });
      toast.success('Terminal aktualisiert');
      setShowTerminalModal(false);
      setEditingTerminal(null);
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Fehler beim Aktualisieren');
    },
  });

  const deleteTerminalMutation = useMutation({
    mutationFn: (id: string) => settingsApi.deleteTerminal(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['terminals'] });
      toast.success('Terminal gelöscht');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Fehler beim Löschen');
    },
  });

  const regenerateKeyMutation = useMutation({
    mutationFn: (id: string) => settingsApi.regenerateTerminalKey(id),
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: ['terminals'] });
      toast.success('API-Key erneuert');
      setDisplayedApiKey(response.data.apiKey);
      setApiKeyCopied(false);
      setShowApiKeyModal(true);
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Fehler beim Erneuern des Keys');
    },
  });

  const restoreDatabaseMutation = useMutation({
    mutationFn: (file: File) => settingsApi.restoreDatabase(file),
    onSuccess: () => {
      queryClient.invalidateQueries();
      toast.success('Datenbank erfolgreich wiederhergestellt');
      setShowRestoreModal(false);
      setRestoreFile(null);
      refetchDatabaseInfo();
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Fehler bei der Wiederherstellung');
    },
  });

  const handleBackupDownload = async () => {
    setIsDownloading(true);
    try {
      const response = await settingsApi.downloadBackup();
      const blob = new Blob([response.data], { type: 'application/octet-stream' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      // Dateiname aus Content-Disposition Header oder Fallback
      const contentDisposition = response.headers['content-disposition'];
      let filename = 'zeiterfassung_backup.db';
      if (contentDisposition) {
        const match = contentDisposition.match(/filename="(.+)"/);
        if (match) filename = match[1];
      }
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      toast.success('Backup heruntergeladen');
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Fehler beim Download');
    } finally {
      setIsDownloading(false);
    }
  };

  const handleRestoreSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (restoreFile) {
      restoreDatabaseMutation.mutate(restoreFile);
    }
  };

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

  // Arbeitskategorien Helpers
  const openCreateWorkCategoryModal = () => {
    setEditingWorkCategory(null);
    setWorkCategoryForm({ name: '', earliestClockIn: '08:00', isActive: true, sortOrder: workCategories?.length ?? 0 });
    setShowWorkCategoryModal(true);
  };

  const openEditWorkCategoryModal = (cat: WorkCategory) => {
    setEditingWorkCategory(cat);
    setWorkCategoryForm({
      name: cat.name,
      earliestClockIn: cat.earliestClockIn,
      isActive: cat.isActive,
      sortOrder: cat.sortOrder,
    });
    setShowWorkCategoryModal(true);
  };

  const closeWorkCategoryModal = () => {
    setShowWorkCategoryModal(false);
    setEditingWorkCategory(null);
  };

  const handleWorkCategorySubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingWorkCategory) {
      updateWorkCategoryMutation.mutate({ id: editingWorkCategory.id, data: workCategoryForm });
    } else {
      createWorkCategoryMutation.mutate(workCategoryForm);
    }
  };

  // Terminal Helpers
  const openCreateTerminalModal = () => {
    setEditingTerminal(null);
    setTerminalForm({ name: '', isActive: true });
    setShowTerminalModal(true);
  };

  const openEditTerminalModal = (terminal: Terminal) => {
    setEditingTerminal(terminal);
    setTerminalForm({ name: terminal.name, isActive: terminal.isActive });
    setShowTerminalModal(true);
  };

  const handleTerminalSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingTerminal) {
      updateTerminalMutation.mutate({ id: editingTerminal.id, data: terminalForm });
    } else {
      createTerminalMutation.mutate({ name: terminalForm.name });
    }
  };

  const copyApiKey = async () => {
    try {
      await navigator.clipboard.writeText(displayedApiKey);
      setApiKeyCopied(true);
      toast.success('API-Key kopiert');
      setTimeout(() => setApiKeyCopied(false), 3000);
    } catch {
      toast.error('Kopieren fehlgeschlagen');
    }
  };

  const formatLastSeen = (lastSeen: string | null): string => {
    if (!lastSeen) return 'Nie';
    const diff = Date.now() - new Date(lastSeen).getTime();
    const seconds = Math.floor(diff / 1000);
    if (seconds < 60) return `vor ${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `vor ${minutes}min`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `vor ${hours}h`;
    return format(new Date(lastSeen), 'dd.MM.yyyy HH:mm', { locale: de });
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
          <div className="p-6 border-b border-gray-100">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                <Calendar size={20} />
                Feiertage
              </h2>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    setGenerateForm({
                      year: new Date().getFullYear(),
                      bundesland: bundeslandInfo?.bundesland || '',
                      deleteExisting: true,
                    });
                    setShowGenerateModal(true);
                  }}
                  className="btn btn-secondary flex items-center gap-2 text-sm"
                >
                  <Wand2 size={16} />
                  Auto
                </button>
                <button
                  onClick={() => setShowHolidayModal(true)}
                  className="btn btn-secondary flex items-center gap-2 text-sm"
                >
                  <Plus size={16} />
                  Manuell
                </button>
              </div>
            </div>
            {bundeslandInfo?.detected && (
              <div className="flex items-center gap-2 text-sm text-gray-600 bg-gray-50 rounded-lg px-3 py-2">
                <MapPin size={14} />
                <span>Erkanntes Bundesland: <strong>{bundeslandInfo.bundeslandName}</strong> (PLZ {bundeslandInfo.plz})</span>
              </div>
            )}
            {bundeslandInfo && !bundeslandInfo.detected && (
              <div className="flex items-center gap-2 text-sm text-amber-600 bg-amber-50 rounded-lg px-3 py-2">
                <AlertCircle size={14} />
                <span>{bundeslandInfo.message}</span>
              </div>
            )}
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

        {/* Database Management */}
        <div className="card">
          <div className="p-6 border-b border-gray-100">
            <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
              <Database size={20} />
              Datenbank
            </h2>
          </div>
          <div className="p-6 space-y-4">
            {/* DB Info */}
            {databaseInfo && (
              <div className="space-y-3">
                <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div className="flex items-center gap-3">
                    <HardDrive size={20} className="text-gray-500" />
                    <div>
                      <p className="text-sm font-medium text-gray-900">Datenbank-Größe</p>
                      <p className="text-xs text-gray-500">SQLite Datenbank</p>
                    </div>
                  </div>
                  <span className="text-lg font-semibold text-gray-900">
                    {databaseInfo.sizeFormatted}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="p-2 bg-gray-50 rounded">
                    <span className="text-gray-500">Mitarbeiter:</span>
                    <span className="ml-2 font-medium">{databaseInfo.stats?.employees ?? 0}</span>
                  </div>
                  <div className="p-2 bg-gray-50 rounded">
                    <span className="text-gray-500">Zeiteinträge:</span>
                    <span className="ml-2 font-medium">{databaseInfo.stats?.timeEntries ?? 0}</span>
                  </div>
                  <div className="p-2 bg-gray-50 rounded">
                    <span className="text-gray-500">Abrechnungen:</span>
                    <span className="ml-2 font-medium">{databaseInfo.stats?.monthlyReports ?? 0}</span>
                  </div>
                  <div className="p-2 bg-gray-50 rounded">
                    <span className="text-gray-500">Feiertage:</span>
                    <span className="ml-2 font-medium">{databaseInfo.stats?.holidays ?? 0}</span>
                  </div>
                </div>

                {databaseInfo.lastModified && (
                  <p className="text-xs text-gray-500">
                    Letzte Änderung: {format(new Date(databaseInfo.lastModified), 'dd.MM.yyyy HH:mm', { locale: de })}
                  </p>
                )}
              </div>
            )}

            {/* Actions */}
            <div className="pt-4 border-t border-gray-100 space-y-3">
              <button
                onClick={handleBackupDownload}
                disabled={isDownloading}
                className="w-full btn btn-secondary flex items-center justify-center gap-2"
              >
                {isDownloading ? (
                  <>
                    <div className="w-4 h-4 border-2 border-gray-600 border-t-transparent rounded-full animate-spin" />
                    Lade herunter...
                  </>
                ) : (
                  <>
                    <Download size={18} />
                    Backup herunterladen
                  </>
                )}
              </button>

              <button
                onClick={() => setShowRestoreModal(true)}
                className="w-full btn btn-secondary flex items-center justify-center gap-2 text-amber-700 border-amber-300 hover:bg-amber-50"
              >
                <Upload size={18} />
                Backup wiederherstellen
              </button>
            </div>
          </div>
        </div>

        {/* Mail Server Settings */}
        <div className="card">
          <div className="p-6 border-b border-gray-100">
            <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
              <Mail size={20} />
              Mail-Server
            </h2>
            <p className="text-sm text-gray-500 mt-1">
              SMTP-Konfiguration für E-Mail-Benachrichtigungen
            </p>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              updateMailMutation.mutate(mailFormData);
            }}
            className="p-6 space-y-4"
          >
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">SMTP-Server</label>
                <input
                  type="text"
                  value={mailFormData.smtpHost}
                  onChange={(e) => setMailFormData({ ...mailFormData, smtpHost: e.target.value })}
                  className="input"
                  placeholder="smtp.example.com"
                />
              </div>
              <div>
                <label className="label">Port</label>
                <input
                  type="number"
                  value={mailFormData.smtpPort}
                  onChange={(e) => setMailFormData({ ...mailFormData, smtpPort: parseInt(e.target.value) || 587 })}
                  className="input"
                  placeholder="587"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">Benutzername</label>
                <input
                  type="text"
                  value={mailFormData.smtpUser}
                  onChange={(e) => setMailFormData({ ...mailFormData, smtpUser: e.target.value })}
                  className="input"
                  placeholder="user@example.com"
                />
              </div>
              <div>
                <label className="label">Passwort</label>
                <input
                  type="password"
                  value={mailFormData.smtpPassword}
                  onChange={(e) => setMailFormData({ ...mailFormData, smtpPassword: e.target.value })}
                  className="input"
                  placeholder="••••••••"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">Absender-Adresse</label>
                <input
                  type="email"
                  value={mailFormData.smtpFromAddress}
                  onChange={(e) => setMailFormData({ ...mailFormData, smtpFromAddress: e.target.value })}
                  className="input"
                  placeholder="zeiterfassung@example.com"
                />
              </div>
              <div>
                <label className="label">Absender-Name</label>
                <input
                  type="text"
                  value={mailFormData.smtpFromName}
                  onChange={(e) => setMailFormData({ ...mailFormData, smtpFromName: e.target.value })}
                  className="input"
                  placeholder="Zeiterfassung"
                />
              </div>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="smtpSecure"
                checked={mailFormData.smtpSecure}
                onChange={(e) => setMailFormData({ ...mailFormData, smtpSecure: e.target.checked })}
                className="w-4 h-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
              />
              <label htmlFor="smtpSecure" className="text-sm text-gray-700">
                TLS/SSL verwenden (Port 465)
              </label>
            </div>

            <div className="pt-4 border-t border-gray-100">
              <button
                type="submit"
                disabled={updateMailMutation.isPending}
                className="btn btn-primary flex items-center gap-2"
              >
                {updateMailMutation.isPending ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Speichern...
                  </>
                ) : (
                  <>
                    <Save size={16} />
                    Speichern
                  </>
                )}
              </button>
            </div>

            {/* Test E-Mail */}
            <div className="pt-4 border-t border-gray-100">
              <label className="label">Test-E-Mail senden</label>
              <div className="flex gap-2">
                <input
                  type="email"
                  value={testEmail}
                  onChange={(e) => setTestEmail(e.target.value)}
                  className="input flex-1"
                  placeholder="test@example.com"
                />
                <button
                  type="button"
                  onClick={handleTestMail}
                  disabled={isSendingTest || !mailFormData.smtpHost}
                  className="btn btn-secondary flex items-center gap-2"
                >
                  {isSendingTest ? (
                    <>
                      <div className="w-4 h-4 border-2 border-gray-600 border-t-transparent rounded-full animate-spin" />
                      Sende...
                    </>
                  ) : (
                    <>
                      <Send size={16} />
                      Testen
                    </>
                  )}
                </button>
              </div>
              {!mailFormData.smtpHost && (
                <p className="text-xs text-amber-600 mt-1">
                  Bitte zuerst SMTP-Server konfigurieren und speichern
                </p>
              )}
            </div>
          </form>
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

      {/* Arbeitskategorien */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card lg:col-span-2">
          <div className="p-6 border-b border-gray-100 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                <Clock size={20} />
                Arbeitskategorien
              </h2>
              <p className="text-sm text-gray-500 mt-1">
                Früheste Einstempelzeit pro Kategorie festlegen
              </p>
            </div>
            <button
              onClick={openCreateWorkCategoryModal}
              className="btn btn-secondary flex items-center gap-2 text-sm"
            >
              <Plus size={16} />
              Neue Kategorie
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
                    Früheste Einstempelzeit
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
                {workCategories?.length ? (
                  workCategories.map((cat) => (
                    <tr key={cat.id}>
                      <td className="px-6 py-4 font-medium text-gray-900">{cat.name}</td>
                      <td className="px-6 py-4">
                        <span className="px-2 py-1 bg-blue-50 text-blue-700 rounded text-sm font-medium">
                          ab {cat.earliestClockIn} Uhr
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        {cat.isActive ? (
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
                            onClick={() => openEditWorkCategoryModal(cat)}
                            className="p-2 text-gray-500 hover:text-primary-600 hover:bg-primary-50 rounded-lg"
                          >
                            <Edit2 size={18} />
                          </button>
                          <button
                            onClick={() => {
                              if (confirm('Arbeitskategorie wirklich löschen?')) {
                                deleteWorkCategoryMutation.mutate(cat.id);
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
                    <td colSpan={4} className="px-6 py-8 text-center text-gray-500">
                      Keine Arbeitskategorien konfiguriert
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* WorkCategory Modal */}
      {showWorkCategoryModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
            <div className="p-6 border-b border-gray-100 flex items-center justify-between">
              <h2 className="text-xl font-semibold">
                {editingWorkCategory ? 'Arbeitskategorie bearbeiten' : 'Neue Arbeitskategorie'}
              </h2>
              <button onClick={closeWorkCategoryModal} className="p-2 hover:bg-gray-100 rounded-lg">
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleWorkCategorySubmit} className="p-6 space-y-4">
              <div>
                <label className="label">Bezeichnung</label>
                <input
                  type="text"
                  value={workCategoryForm.name}
                  onChange={(e) => setWorkCategoryForm({ ...workCategoryForm, name: e.target.value })}
                  className="input"
                  placeholder="z.B. Backoffice, Büro, Verkauf"
                  required
                />
              </div>
              <div>
                <label className="label">Früheste Einstempelzeit</label>
                <input
                  type="time"
                  value={workCategoryForm.earliestClockIn}
                  onChange={(e) => setWorkCategoryForm({ ...workCategoryForm, earliestClockIn: e.target.value })}
                  className="input"
                  required
                />
                <p className="text-xs text-gray-500 mt-1">
                  Stempelt ein Mitarbeiter vor dieser Zeit, wird die Einstempelzeit automatisch auf diesen Wert gesetzt
                </p>
              </div>
              <div>
                <label className="label">Status</label>
                <select
                  value={workCategoryForm.isActive ? 'true' : 'false'}
                  onChange={(e) =>
                    setWorkCategoryForm({ ...workCategoryForm, isActive: e.target.value === 'true' })
                  }
                  className="input"
                >
                  <option value="true">Aktiv</option>
                  <option value="false">Inaktiv</option>
                </select>
              </div>
              <div className="flex gap-3 pt-2">
                <button type="submit" className="btn btn-primary flex-1">
                  {editingWorkCategory ? 'Speichern' : 'Erstellen'}
                </button>
                <button type="button" onClick={closeWorkCategoryModal} className="btn btn-secondary">
                  Abbrechen
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Terminals */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card lg:col-span-2">
          <div className="p-6 border-b border-gray-100 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                <Monitor size={20} />
                Terminals
              </h2>
              <p className="text-sm text-gray-500 mt-1">
                Stempelterminals verwalten und Online-Status überwachen
              </p>
            </div>
            <button
              onClick={openCreateTerminalModal}
              className="btn btn-secondary flex items-center gap-2 text-sm"
            >
              <Plus size={16} />
              Neues Terminal
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Name
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Letzte Aktivität
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    IP-Adresse
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                    Aktionen
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {terminals?.length ? (
                  terminals.map((terminal) => (
                    <tr key={terminal.id}>
                      <td className="px-6 py-4 font-medium text-gray-900">
                        {terminal.name}
                        {!terminal.isActive && (
                          <span className="ml-2 px-2 py-0.5 bg-gray-100 text-gray-500 rounded-full text-xs">
                            Deaktiviert
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        {terminal.isOnline ? (
                          <span className="flex items-center gap-2 text-green-700">
                            <span className="w-2.5 h-2.5 bg-green-500 rounded-full animate-pulse" />
                            Online
                          </span>
                        ) : (
                          <span className="flex items-center gap-2 text-gray-500">
                            <span className="w-2.5 h-2.5 bg-gray-300 rounded-full" />
                            Offline
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600">
                        {formatLastSeen(terminal.lastSeen)}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600 font-mono">
                        {terminal.ipAddress || '-'}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => openEditTerminalModal(terminal)}
                            className="p-2 text-gray-500 hover:text-primary-600 hover:bg-primary-50 rounded-lg"
                            title="Bearbeiten"
                          >
                            <Edit2 size={18} />
                          </button>
                          <button
                            onClick={() => {
                              if (confirm(`API-Key für "${terminal.name}" wirklich erneuern?\n\nDer alte Key wird sofort ungültig und das Terminal muss neu konfiguriert werden.`)) {
                                regenerateKeyMutation.mutate(terminal.id);
                              }
                            }}
                            className="p-2 text-gray-500 hover:text-amber-600 hover:bg-amber-50 rounded-lg"
                            title="API-Key erneuern"
                          >
                            <Key size={18} />
                          </button>
                          <button
                            onClick={() => {
                              if (confirm(`Terminal "${terminal.name}" wirklich löschen?`)) {
                                deleteTerminalMutation.mutate(terminal.id);
                              }
                            }}
                            className="p-2 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg"
                            title="Löschen"
                          >
                            <Trash2 size={18} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5} className="px-6 py-8 text-center text-gray-500">
                      Keine Terminals konfiguriert
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Terminal Create/Edit Modal */}
      {showTerminalModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
            <div className="p-6 border-b border-gray-100 flex items-center justify-between">
              <h2 className="text-xl font-semibold">
                {editingTerminal ? 'Terminal bearbeiten' : 'Neues Terminal'}
              </h2>
              <button onClick={() => { setShowTerminalModal(false); setEditingTerminal(null); }} className="p-2 hover:bg-gray-100 rounded-lg">
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleTerminalSubmit} className="p-6 space-y-4">
              <div>
                <label className="label">Bezeichnung</label>
                <input
                  type="text"
                  value={terminalForm.name}
                  onChange={(e) => setTerminalForm({ ...terminalForm, name: e.target.value })}
                  className="input"
                  placeholder="z.B. Terminal Eingang, Terminal Lager"
                  required
                />
              </div>
              {editingTerminal && (
                <div>
                  <label className="label">Status</label>
                  <select
                    value={terminalForm.isActive ? 'true' : 'false'}
                    onChange={(e) => setTerminalForm({ ...terminalForm, isActive: e.target.value === 'true' })}
                    className="input"
                  >
                    <option value="true">Aktiv</option>
                    <option value="false">Deaktiviert</option>
                  </select>
                </div>
              )}
              <div className="flex gap-3 pt-2">
                <button type="submit" className="btn btn-primary flex-1">
                  {editingTerminal ? 'Speichern' : 'Terminal erstellen'}
                </button>
                <button type="button" onClick={() => { setShowTerminalModal(false); setEditingTerminal(null); }} className="btn btn-secondary">
                  Abbrechen
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* API-Key Anzeige Modal */}
      {showApiKeyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg">
            <div className="p-6 border-b border-gray-100">
              <h2 className="text-xl font-semibold flex items-center gap-2">
                <Key size={20} className="text-amber-500" />
                Terminal API-Key
              </h2>
            </div>
            <div className="p-6 space-y-4">
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                <div className="flex items-start gap-2">
                  <AlertCircle size={18} className="text-amber-600 mt-0.5 flex-shrink-0" />
                  <p className="text-sm text-amber-800">
                    Dieser API-Key wird <strong>nur einmal</strong> angezeigt. Bitte kopieren und sicher aufbewahren.
                    Er wird für die Terminal-Konfiguration benötigt.
                  </p>
                </div>
              </div>
              <div className="relative">
                <div className="bg-gray-900 text-green-400 rounded-lg p-4 font-mono text-sm break-all pr-12">
                  {displayedApiKey}
                </div>
                <button
                  onClick={copyApiKey}
                  className="absolute top-3 right-3 p-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
                  title="Kopieren"
                >
                  {apiKeyCopied ? <CheckCircle size={16} /> : <Copy size={16} />}
                </button>
              </div>
              <div className="flex justify-end pt-2">
                <button
                  onClick={() => { setShowApiKeyModal(false); setDisplayedApiKey(''); }}
                  className="btn btn-primary"
                >
                  Verstanden
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

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

      {/* Generate Holidays Modal */}
      {showGenerateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
            <div className="p-6 border-b border-gray-100 flex items-center justify-between">
              <h2 className="text-xl font-semibold flex items-center gap-2">
                <Wand2 size={20} />
                Feiertage automatisch generieren
              </h2>
              <button
                onClick={() => setShowGenerateModal(false)}
                className="p-2 hover:bg-gray-100 rounded-lg"
              >
                <X size={20} />
              </button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                generateHolidaysMutation.mutate({
                  year: generateForm.year,
                  bundesland: generateForm.bundesland || undefined,
                  deleteExisting: generateForm.deleteExisting,
                });
              }}
              className="p-6 space-y-4"
            >
              <div>
                <label className="label">Jahr</label>
                <select
                  value={generateForm.year}
                  onChange={(e) => setGenerateForm({ ...generateForm, year: parseInt(e.target.value) })}
                  className="input"
                >
                  {[...Array(5)].map((_, i) => {
                    const year = new Date().getFullYear() + i;
                    return <option key={year} value={year}>{year}</option>;
                  })}
                </select>
              </div>
              <div>
                <label className="label">Bundesland</label>
                <select
                  value={generateForm.bundesland}
                  onChange={(e) => setGenerateForm({ ...generateForm, bundesland: e.target.value })}
                  className="input"
                >
                  <option value="">
                    {bundeslandInfo?.detected
                      ? `Automatisch (${bundeslandInfo.bundeslandName})`
                      : 'Bitte auswählen...'}
                  </option>
                  {bundeslaender?.map((bl) => (
                    <option key={bl.code} value={bl.code}>
                      {bl.name}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-gray-500 mt-1">
                  Das Bundesland bestimmt die regionalen Feiertage (z.B. Fronleichnam, Allerheiligen)
                </p>
              </div>
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  id="deleteExisting"
                  checked={generateForm.deleteExisting}
                  onChange={(e) => setGenerateForm({ ...generateForm, deleteExisting: e.target.checked })}
                  className="w-4 h-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                />
                <label htmlFor="deleteExisting" className="text-sm text-gray-700">
                  Bestehende Feiertage des Jahres vorher löschen
                </label>
              </div>
              <div className="bg-blue-50 rounded-lg p-4 text-sm text-blue-700">
                <p className="font-medium mb-1">Generierte Feiertage:</p>
                <p>Neujahr, Karfreitag, Ostermontag, Tag der Arbeit, Christi Himmelfahrt, Pfingstmontag, Tag der Deutschen Einheit, 1. + 2. Weihnachtstag + regionale Feiertage je nach Bundesland</p>
              </div>
              <div className="flex justify-end gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowGenerateModal(false)}
                  className="btn btn-secondary"
                >
                  Abbrechen
                </button>
                <button
                  type="submit"
                  disabled={generateHolidaysMutation.isPending}
                  className="btn btn-primary flex items-center gap-2"
                >
                  {generateHolidaysMutation.isPending ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Generiere...
                    </>
                  ) : (
                    <>
                      <Wand2 size={16} />
                      Feiertage generieren
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Restore Database Modal */}
      {showRestoreModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
            <div className="p-6 border-b border-gray-100 flex items-center justify-between">
              <h2 className="text-xl font-semibold flex items-center gap-2">
                <Upload size={20} />
                Backup wiederherstellen
              </h2>
              <button
                onClick={() => {
                  setShowRestoreModal(false);
                  setRestoreFile(null);
                }}
                className="p-2 hover:bg-gray-100 rounded-lg"
              >
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleRestoreSubmit} className="p-6 space-y-4">
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <AlertCircle size={20} className="text-amber-600 mt-0.5 flex-shrink-0" />
                  <div className="text-sm text-amber-800">
                    <p className="font-semibold mb-1">Achtung!</p>
                    <p>
                      Diese Aktion ersetzt die aktuelle Datenbank komplett.
                      Alle aktuellen Daten werden überschrieben.
                      Ein automatisches Backup wird vor der Wiederherstellung erstellt.
                    </p>
                  </div>
                </div>
              </div>

              <div>
                <label className="label">Backup-Datei auswählen</label>
                <input
                  type="file"
                  accept=".db"
                  onChange={(e) => setRestoreFile(e.target.files?.[0] || null)}
                  className="w-full text-sm text-gray-500
                    file:mr-4 file:py-2 file:px-4
                    file:rounded-lg file:border-0
                    file:text-sm file:font-medium
                    file:bg-primary-50 file:text-primary-700
                    hover:file:bg-primary-100
                    cursor-pointer"
                />
                {restoreFile && (
                  <p className="mt-2 text-sm text-gray-600">
                    Ausgewählt: <span className="font-medium">{restoreFile.name}</span> ({(restoreFile.size / (1024 * 1024)).toFixed(2)} MB)
                  </p>
                )}
              </div>

              <div className="flex justify-end gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setShowRestoreModal(false);
                    setRestoreFile(null);
                  }}
                  className="btn btn-secondary"
                >
                  Abbrechen
                </button>
                <button
                  type="submit"
                  disabled={!restoreFile || restoreDatabaseMutation.isPending}
                  className="btn bg-amber-600 text-white hover:bg-amber-700 flex items-center gap-2"
                >
                  {restoreDatabaseMutation.isPending ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Stelle wieder her...
                    </>
                  ) : (
                    <>
                      <Upload size={16} />
                      Wiederherstellen
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
