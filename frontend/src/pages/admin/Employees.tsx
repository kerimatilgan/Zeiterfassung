import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { employeesApi, timeEntriesApi, settingsApi, terminalApi, authApi, twoFactorApi, documentsApi, reportsApi } from '../../lib/api';
import toast from 'react-hot-toast';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, addMonths, subMonths } from 'date-fns';
import { de } from 'date-fns/locale';
import { io, Socket } from 'socket.io-client';
import { useAuthStore } from '../../store/authStore';
import {
  Plus,
  Edit2,
  Trash2,
  Search,
  X,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Briefcase,
  Star,
  CreditCard,
  Wifi,
  Loader2,
  Camera,
  User,
  AlertTriangle,
  CheckCircle,
  MessageSquare,
  KeyRound,
  FolderOpen,
  Download,
  Upload,
  Clock,
  MapPin,
} from 'lucide-react';

interface Employee {
  id: string;
  employeeNumber: string;
  username: string | null;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  photoUrl: string | null;
  weeklyHours: number;
  vacationDaysPerYear: number;
  workDays: string;
  isActive: boolean;
  isAdmin: boolean;
  rfidCard: string | null;
  workCategoryId: string | null;
  workCategory?: { id: string; name: string; earliestClockIn: string } | null;
}

interface EmployeeFormData {
  employeeNumber: string;
  username: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  weeklyHours: number;
  vacationDaysPerYear: number;
  workDays: string;
  isAdmin: boolean;
  password: string;
  workCategoryId: string;
  canClockInPwa: boolean;
  canClockOutPwa: boolean;
  defaultClockOut: string;
  startDate: string;
  endDate: string;
}

const initialFormData: EmployeeFormData = {
  employeeNumber: '',
  username: '',
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  weeklyHours: 40,
  vacationDaysPerYear: 30,
  workDays: '1,2,3,4,5',
  isAdmin: false,
  password: '',
  workCategoryId: '',
  canClockInPwa: false,
  canClockOutPwa: false,
  defaultClockOut: '17:00',
  startDate: '',
  endDate: '',
};

// Wochentage für Checkbox-Auswahl
const WEEKDAY_OPTIONS = [
  { value: 1, label: 'Mo' },
  { value: 2, label: 'Di' },
  { value: 3, label: 'Mi' },
  { value: 4, label: 'Do' },
  { value: 5, label: 'Fr' },
  { value: 6, label: 'Sa' },
  { value: 0, label: 'So' },
];

interface TimeEntry {
  id: string;
  employeeId: string;
  clockIn: string;
  clockOut: string | null;
  breakMinutes: number;
  note: string | null;
  isManual: boolean;
  editedBy: string | null;
  // Reklamation
  complaintMessage?: string | null;
  complaintAt?: string | null;
  complaintResolvedAt?: string | null;
  complaintResolvedBy?: string | null;
  complaintResponse?: string | null;
}

interface TimeEntryFormData {
  clockIn: string;
  clockOut: string;
  breakMinutes: number;
  note: string;
}

interface DaySummary {
  date: Date;
  entries: TimeEntry[];
  totalWorkMinutes: number;
  totalBreakMinutes: number;
  isActive: boolean;
  absence?: EmployeeAbsence;
  holiday?: Holiday;
}

interface AbsenceType {
  id: string;
  name: string;
  shortName: string;
  requiredHours: number;
  color: string;
  isActive: boolean;
}

interface EmployeeAbsence {
  id: string;
  employeeId: string;
  absenceTypeId: string;
  absenceType: AbsenceType;
  date: string;
  note: string | null;
}

interface Holiday {
  id: string;
  date: string;
  name: string;
  isRecurring: boolean;
}

// 2FA Admin Management Sub-Component
function TwoFactorAdminSection({ employeeId, employeeName }: { employeeId: string; employeeName: string }) {
  const [status, setStatus] = useState<{ totpEnabled: boolean; passkeys: any[] } | null>(null);
  const [loading, setLoading] = useState(true);

  const loadStatus = async () => {
    try {
      const res = await twoFactorApi.getAdminStatus(employeeId);
      setStatus(res.data);
    } catch {
      setStatus(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadStatus(); }, [employeeId]);

  if (loading) return <p className="text-sm text-gray-400">Laden...</p>;
  if (!status) return <p className="text-sm text-gray-400">Status nicht verfügbar</p>;

  const has2FA = status.totpEnabled || status.passkeys.length > 0;

  if (!has2FA) {
    return <p className="text-sm text-gray-500">Keine 2FA konfiguriert.</p>;
  }

  return (
    <div className="space-y-3">
      {status.totpEnabled && (
        <div className="flex items-center justify-between p-2 bg-amber-50 rounded-lg">
          <span className="text-sm text-amber-800">TOTP (Authenticator-App) aktiv</span>
          <button
            type="button"
            onClick={async () => {
              if (!confirm(`2FA für ${employeeName} wirklich deaktivieren?`)) return;
              try {
                await twoFactorApi.adminDisableTotp(employeeId);
                toast.success('2FA deaktiviert');
                loadStatus();
              } catch (err: any) {
                toast.error(err.response?.data?.error || 'Fehler');
              }
            }}
            className="text-xs text-red-600 hover:text-red-700 hover:underline"
          >
            Deaktivieren
          </button>
        </div>
      )}
      {status.passkeys.length > 0 && (
        <div className="space-y-1">
          {status.passkeys.map((pk: any) => (
            <div key={pk.id} className="flex items-center justify-between p-2 bg-indigo-50 rounded-lg">
              <span className="text-sm text-indigo-800">
                Passkey: {pk.deviceName} ({new Date(pk.createdAt).toLocaleDateString('de-DE')})
              </span>
              <button
                type="button"
                onClick={async () => {
                  if (!confirm(`Passkey "${pk.deviceName}" löschen?`)) return;
                  try {
                    await twoFactorApi.adminDeletePasskey(pk.id);
                    toast.success('Passkey gelöscht');
                    loadStatus();
                  } catch (err: any) {
                    toast.error(err.response?.data?.error || 'Fehler');
                  }
                }}
                className="text-xs text-red-600 hover:text-red-700 hover:underline"
              >
                Löschen
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Helper components for document modal
function DocumentTypeQuery({ children }: { children: (types: any[]) => React.ReactNode }) {
  const { data } = useQuery({ queryKey: ['document-types-active'], queryFn: () => settingsApi.getDocumentTypes().then(r => r.data) });
  return <>{children(data || [])}</>;
}

const REPORT_DOC_TYPE = { id: '__report__', name: 'Stundenabrechnung', shortName: 'SA', color: '#0EA5E9' };

function EmployeeDocumentList({ employeeId, formatFileSize, MONTHS, filterYear, filterMonth }: { employeeId: string; formatFileSize: (b: number) => string; MONTHS: string[]; filterYear?: number; filterMonth?: number }) {
  const queryClient = useQueryClient();
  const { data: docs, isLoading } = useQuery({
    queryKey: ['employee-documents', employeeId],
    queryFn: () => documentsApi.getForEmployee(employeeId).then(r => r.data),
  });

  // Abrechnungen als virtuelle Dokumente laden
  const { data: reports } = useQuery({
    queryKey: ['employee-reports-for-docs', employeeId],
    queryFn: () => reportsApi.getAll({ employeeId }).then(r => r.data),
  });

  const handleDownload = async (id: string, filename: string) => {
    try {
      const response = await documentsApi.download(id);
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch {
      toast.error('Fehler beim Herunterladen');
    }
  };

  const handleReportDownload = async (reportId: string, year: number, month: number) => {
    try {
      const response = await reportsApi.downloadPdf(reportId);
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `Stundenabrechnung_${year}_${String(month).padStart(2, '0')}.pdf`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch {
      toast.error('Fehler beim Herunterladen');
    }
  };

  const handleDelete = async (doc: any) => {
    if (!confirm(`"${doc.originalFilename}" wirklich löschen?`)) return;
    try {
      await documentsApi.delete(doc.id);
      toast.success('Dokument gelöscht');
      queryClient.invalidateQueries({ queryKey: ['employee-documents', employeeId] });
    } catch {
      toast.error('Fehler beim Löschen');
    }
  };

  // Reports zu virtuellen Dokumenten konvertieren
  const reportDocs = (reports || [])
    .filter((r: any) => r.status === 'finalized' && r.pdfPath)
    .map((r: any) => ({
      id: `report-${r.id}`,
      _isReport: true,
      _reportId: r.id,
      documentType: REPORT_DOC_TYPE,
      originalFilename: `Stundenabrechnung_${r.year}_${String(r.month).padStart(2, '0')}.pdf`,
      fileSize: 0,
      year: r.year,
      month: r.month,
      createdAt: r.finalizedAt || r.createdAt,
    }));

  const allDocs = [...(docs || []), ...reportDocs];

  const filteredDocs = allDocs.filter((doc: any) => {
    if (filterYear && doc.year !== filterYear) return false;
    if (filterMonth && doc.month !== filterMonth) return false;
    return true;
  });

  if (isLoading) return <p className="text-sm text-gray-500 text-center py-4">Laden...</p>;
  if (!allDocs.length) return <p className="text-sm text-gray-500 text-center py-4">Keine Dokumente vorhanden</p>;
  if (!filteredDocs.length) return <p className="text-sm text-gray-500 text-center py-4">Keine Dokumente für {MONTHS[(filterMonth || 1) - 1]} {filterYear}</p>;

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-gray-700">Dokumente für {MONTHS[(filterMonth || 1) - 1]} {filterYear} ({filteredDocs.length})</h3>
      {filteredDocs.map((doc: any) => (
        <div key={doc.id} className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
          <span className="inline-flex px-2 py-0.5 text-xs font-medium rounded-full text-white flex-shrink-0" style={{ backgroundColor: doc.documentType.color }}>
            {doc.documentType.shortName}
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-900 truncate">{doc.originalFilename}</p>
            <p className="text-xs text-gray-500">
              {doc.year && doc.month ? `${MONTHS[doc.month-1]} ${doc.year}` : doc.year ? `${doc.year}` : ''}
              {doc.year ? ' • ' : ''}{!doc._isReport && doc.fileSize > 0 ? formatFileSize(doc.fileSize) + ' • ' : ''}
              {new Date(doc.createdAt).toLocaleDateString('de-DE')} {new Date(doc.createdAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}
            </p>
          </div>
          <button
            onClick={() => doc._isReport ? handleReportDownload(doc._reportId, doc.year, doc.month) : handleDownload(doc.id, doc.originalFilename)}
            className="p-1.5 text-gray-500 hover:text-primary-600 hover:bg-primary-50 rounded-lg"
            title="Herunterladen"
          >
            <Download size={16} />
          </button>
          {!doc._isReport && (
            <button onClick={() => handleDelete(doc)} className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg" title="Löschen">
              <Trash2 size={16} />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

export default function AdminEmployees() {
  const [showModal, setShowModal] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [formData, setFormData] = useState<EmployeeFormData>(initialFormData);
  const [searchQuery, setSearchQuery] = useState('');
  // RFID Lookup State
  const [showLookupModal, setShowLookupModal] = useState(false);
  const [lookupScanning, setLookupScanning] = useState(false);
  const [lookupCountdown, setLookupCountdown] = useState(0);
  const [lookupResult, setLookupResult] = useState<any>(null);
  const [lookupSocketConnected, setLookupSocketConnected] = useState(false);
  const lookupSocketRef = useRef<Socket | null>(null);

  // Documents Modal State
  const [showDocumentsModal, setShowDocumentsModal] = useState(false);
  const [selectedEmployeeForDocs, setSelectedEmployeeForDocs] = useState<Employee | null>(null);
  const [docUploadFile, setDocUploadFile] = useState<File | null>(null);
  const [docUploadForm, setDocUploadForm] = useState({ documentTypeId: '', year: new Date().getFullYear(), month: new Date().getMonth() + 1, note: '' });
  const [docUploading, setDocUploading] = useState(false);
  const [docDragging, setDocDragging] = useState(false);

  // RFID Modal State
  const [showRfidModal, setShowRfidModal] = useState(false);
  const [rfidEmployee, setRfidEmployee] = useState<Employee | null>(null);
  const [rfidInput, setRfidInput] = useState('');
  const [isScanning, setIsScanning] = useState(false);
  const [scanCountdown, setScanCountdown] = useState(0);
  const [isSocketConnected, setIsSocketConnected] = useState(false);
  const socketRef = useRef<Socket | null>(null);

  // Time Entries Modal State
  const [showTimeEntriesModal, setShowTimeEntriesModal] = useState(false);
  const [selectedEmployeeForTime, setSelectedEmployeeForTime] = useState<Employee | null>(null);
  const [selectedMonth, setSelectedMonth] = useState(new Date());
  const [timeEntries, setTimeEntries] = useState<TimeEntry[]>([]);
  const [loadingTimeEntries, setLoadingTimeEntries] = useState(false);

  // Quick Edit Popup State
  const [editingTimeEntry, setEditingTimeEntry] = useState<TimeEntry | null>(null);
  const [editingDate, setEditingDate] = useState<Date | null>(null);
  const [timeEntryFormData, setTimeEntryFormData] = useState<TimeEntryFormData>({
    clockIn: '',
    clockOut: '',
    breakMinutes: 0,
    note: '',
  });
  const [showCreateEntry, setShowCreateEntry] = useState(false);
  const popupRef = useRef<HTMLDivElement>(null);
  const clockInInputRef = useRef<HTMLInputElement>(null);
  const clockOutInputRef = useRef<HTMLInputElement>(null);

  // Reklamation State
  const [showComplaintModal, setShowComplaintModal] = useState(false);
  const [complaintResponse, setComplaintResponse] = useState('');
  const [isResolvingComplaint, setIsResolvingComplaint] = useState(false);

  // Absences State
  const [absences, setAbsences] = useState<EmployeeAbsence[]>([]);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [showAbsencePopup, setShowAbsencePopup] = useState(false);
  const [editingAbsence, setEditingAbsence] = useState<EmployeeAbsence | null>(null);
  const [absenceFormData, setAbsenceFormData] = useState({
    absenceTypeId: '',
    note: '',
  });
  const absencePopupRef = useRef<HTMLDivElement>(null);
  const complaintModalRef = useRef<HTMLDivElement>(null);

  // Pause State
  const [showPausePopup, setShowPausePopup] = useState(false);
  const [pauseDate, setPauseDate] = useState<Date | null>(null);
  const [pauseEntryId, setPauseEntryId] = useState<string | null>(null);
  const [pauseStart, setPauseStart] = useState('12:00');
  const [pauseEnd, setPauseEnd] = useState('12:30');
  const pausePopupRef = useRef<HTMLDivElement>(null);

  // Auswärtsstempelung Detail
  const [pwaDetailEntry, setPwaDetailEntry] = useState<any>(null);

  // Multi-Select State für Abwesenheiten (Drag-Auswahl)
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectionStart, setSelectionStart] = useState<Date | null>(null);
  const [selectionEnd, setSelectionEnd] = useState<Date | null>(null);
  const [selectedDates, setSelectedDates] = useState<Date[]>([]);

  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const { data: employees, isLoading } = useQuery({
    queryKey: ['employees'],
    queryFn: () => employeesApi.getAll().then((r) => r.data as Employee[]),
  });

  const { data: absenceTypes } = useQuery({
    queryKey: ['absence-types'],
    queryFn: () => settingsApi.getAbsenceTypes().then((r) => r.data as AbsenceType[]),
  });

  const { data: workCategories } = useQuery({
    queryKey: ['work-categories'],
    queryFn: () => settingsApi.getWorkCategories().then((r) => r.data),
  });

  // Offene Reklamationen für Badge
  const { data: pendingComplaints } = useQuery({
    queryKey: ['pendingComplaints'],
    queryFn: () => timeEntriesApi.getPendingComplaints(100).then((r) => r.data),
    refetchInterval: 30000,
  });

  // Zähle offene Reklamationen pro Mitarbeiter
  const complaintsByEmployee = useMemo(() => {
    const counts: Record<string, number> = {};
    if (pendingComplaints?.entries) {
      for (const entry of pendingComplaints.entries) {
        counts[entry.employeeId] = (counts[entry.employeeId] || 0) + 1;
      }
    }
    return counts;
  }, [pendingComplaints]);

  // URL-Parameter "openEmployee" auswerten - Modal automatisch öffnen
  useEffect(() => {
    const openEmployeeId = searchParams.get('openEmployee');
    const entryId = searchParams.get('entryId');
    const dateParam = searchParams.get('date');

    if (openEmployeeId && employees && !showTimeEntriesModal) {
      const employee = employees.find((e) => e.id === openEmployeeId);
      if (employee) {
        // Parameter entfernen und Modal öffnen
        setSearchParams({});
        setSelectedEmployeeForTime(employee);

        // Monat basierend auf dem Datum setzen (falls vorhanden)
        const targetDate = dateParam ? new Date(dateParam) : new Date();
        setSelectedMonth(targetDate);
        setShowTimeEntriesModal(true);

        // Inline load time entries
        const loadEntries = async () => {
          setLoadingTimeEntries(true);
          try {
            const from = startOfMonth(targetDate).toISOString();
            const to = endOfMonth(targetDate).toISOString();
            const year = targetDate.getFullYear();
            const [entriesResponse, absencesResponse, holidaysResponse] = await Promise.all([
              timeEntriesApi.getAll({ employeeId: employee.id, from, to }),
              settingsApi.getAbsences({ employeeId: employee.id, from, to }),
              settingsApi.getHolidays(year),
            ]);
            const loadedEntries = entriesResponse.data as TimeEntry[];
            setTimeEntries(loadedEntries);
            setAbsences(absencesResponse.data as EmployeeAbsence[]);
            setHolidays(holidaysResponse.data as Holiday[]);

            // Falls entryId vorhanden, direkt das Popup für diesen Eintrag öffnen
            if (entryId) {
              const targetEntry = loadedEntries.find((e) => e.id === entryId);
              if (targetEntry) {
                const entryDate = new Date(targetEntry.clockIn);
                setEditingDate(entryDate);
                setEditingTimeEntry(targetEntry);
                setShowCreateEntry(false);
                setTimeEntryFormData({
                  clockIn: format(new Date(targetEntry.clockIn), 'HH:mm'),
                  clockOut: targetEntry.clockOut ? format(new Date(targetEntry.clockOut), 'HH:mm') : '',
                  breakMinutes: 0,
                  note: targetEntry.note || '',
                });
              }
            }
          } catch (error) {
            console.error('Error loading time entries:', error);
          } finally {
            setLoadingTimeEntries(false);
          }
        };
        loadEntries();
      }
    }
  }, [searchParams, employees, showTimeEntriesModal]);

  const createMutation = useMutation({
    mutationFn: (data: EmployeeFormData) => employeesApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['employees'] });
      toast.success('Mitarbeiter erstellt');
      closeModal();
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Fehler beim Erstellen');
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<EmployeeFormData> }) =>
      employeesApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['employees'] });
      toast.success('Mitarbeiter aktualisiert');
      closeModal();
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Fehler beim Aktualisieren');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => employeesApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['employees'] });
      toast.success('Mitarbeiter deaktiviert');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Fehler beim Löschen');
    },
  });

  const registerRfidMutation = useMutation({
    mutationFn: ({ id, rfidCard }: { id: string; rfidCard: string }) =>
      employeesApi.registerRfid(id, rfidCard),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['employees'] });
      toast.success('RFID-Karte registriert');
      closeRfidModal();
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Fehler beim Registrieren');
    },
  });

  const removeRfidMutation = useMutation({
    mutationFn: (id: string) => employeesApi.removeRfid(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['employees'] });
      toast.success('RFID-Karte entfernt');
      closeRfidModal();
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Fehler beim Entfernen');
    },
  });

  const uploadPhotoMutation = useMutation({
    mutationFn: ({ id, file }: { id: string; file: File }) => employeesApi.uploadPhoto(id, file),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['employees'] });
      toast.success('Foto hochgeladen');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Fehler beim Hochladen');
    },
  });

  const deletePhotoMutation = useMutation({
    mutationFn: (id: string) => employeesApi.deletePhoto(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['employees'] });
      toast.success('Foto gelöscht');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Fehler beim Löschen');
    },
  });

  const handlePhotoUpload = (employee: Employee, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validiere Dateityp
    if (!['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(file.type)) {
      toast.error('Nur Bilder erlaubt (JPEG, PNG, GIF, WebP)');
      return;
    }

    // Validiere Dateigröße (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      toast.error('Maximale Dateigröße: 5MB');
      return;
    }

    uploadPhotoMutation.mutate({ id: employee.id, file });
  };

  const handlePhotoDelete = (employee: Employee) => {
    if (confirm('Foto wirklich löschen?')) {
      deletePhotoMutation.mutate(employee.id);
    }
  };

  const openCreateModal = () => {
    setEditingEmployee(null);
    setFormData(initialFormData);
    setShowModal(true);
  };

  const openEditModal = (employee: Employee) => {
    setEditingEmployee(employee);
    setFormData({
      employeeNumber: employee.employeeNumber,
      username: employee.username || '',
      firstName: employee.firstName,
      lastName: employee.lastName,
      email: employee.email || '',
      phone: employee.phone || '',
      weeklyHours: employee.weeklyHours,
      vacationDaysPerYear: employee.vacationDaysPerYear,
      workDays: employee.workDays,
      isAdmin: employee.isAdmin,
      password: '',
      workCategoryId: employee.workCategoryId || '',
      canClockInPwa: (employee as any).canClockInPwa || false,
      canClockOutPwa: (employee as any).canClockOutPwa || false,
      defaultClockOut: (employee as any).defaultClockOut || '17:00',
      startDate: (employee as any).startDate ? (employee as any).startDate.split('T')[0] : '',
      endDate: (employee as any).endDate ? (employee as any).endDate.split('T')[0] : '',
    });
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingEmployee(null);
    setFormData(initialFormData);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const submitData: any = { ...formData, workCategoryId: formData.workCategoryId || null };
    if (editingEmployee) {
      if (!submitData.password) delete submitData.password;
      updateMutation.mutate({ id: editingEmployee.id, data: submitData });
    } else {
      createMutation.mutate(submitData);
    }
  };

  const handleDelete = (employee: Employee) => {
    if (confirm(`Möchten Sie ${employee.firstName} ${employee.lastName} wirklich deaktivieren?`)) {
      deleteMutation.mutate(employee.id);
    }
  };

  // RFID Modal Functions
  const openRfidModal = (employee: Employee) => {
    setRfidEmployee(employee);
    setRfidInput(employee.rfidCard || '');
    setShowRfidModal(true);
  };

  const closeRfidModal = useCallback(() => {
    // Stop scanning if active
    if (isScanning) {
      terminalApi.stopRfidRegistration().catch(() => {});
    }
    setIsScanning(false);
    setScanCountdown(0);
    setShowRfidModal(false);
    setRfidEmployee(null);
    setRfidInput('');
  }, [isScanning]);

  const handleRfidSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!rfidEmployee || !rfidInput.trim()) return;
    registerRfidMutation.mutate({ id: rfidEmployee.id, rfidCard: rfidInput.trim() });
  };

  const handleRfidRemove = () => {
    if (!rfidEmployee) return;
    if (confirm('RFID-Karte wirklich entfernen?')) {
      removeRfidMutation.mutate(rfidEmployee.id);
    }
  };

  // WebSocket für RFID-Scanning
  useEffect(() => {
    // Verbinde nur wenn Modal offen
    if (!showRfidModal) {
      setIsSocketConnected(false);
      return;
    }

    // Verbinde über nginx Proxy (gleiche Origin) — mit JWT-Auth
    const token = useAuthStore.getState().token || '';
    const socket = io(window.location.origin, {
      path: '/socket.io/',
      transports: ['websocket', 'polling'],
      timeout: 5000,
      auth: { token },
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      console.log('RFID WebSocket connected:', socket.id);
      setIsSocketConnected(true);
    });

    socket.on('disconnect', () => {
      console.log('RFID WebSocket disconnected');
      setIsSocketConnected(false);
    });

    socket.on('connect_error', (error) => {
      console.error('RFID WebSocket connection error:', error);
      setIsSocketConnected(false);
    });

    socket.on('rfid-card-scanned', (data: { success: boolean; rfidCard?: string; error?: string }) => {
      setIsScanning(false);
      setScanCountdown(0);

      if (data.success && data.rfidCard) {
        setRfidInput(data.rfidCard);
        toast.success(`Karte gescannt: ${data.rfidCard}`);
      } else {
        toast.error(data.error || 'Scan fehlgeschlagen');
      }
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
      setIsSocketConnected(false);
    };
  }, [showRfidModal]);

  // Countdown Timer
  useEffect(() => {
    if (!isScanning || scanCountdown <= 0) return;

    const timer = setInterval(() => {
      setScanCountdown((prev) => {
        if (prev <= 1) {
          setIsScanning(false);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [isScanning, scanCountdown]);

  const startRfidScan = async () => {
    if (!rfidEmployee) {
      toast.error('Kein Mitarbeiter ausgewählt');
      return;
    }

    if (!isSocketConnected || !socketRef.current?.id) {
      toast.error('WebSocket nicht verbunden - bitte warten...');
      return;
    }

    try {
      const response = await terminalApi.startRfidRegistration(rfidEmployee.id, socketRef.current.id);
      if (response.data.success) {
        setIsScanning(true);
        setScanCountdown(30); // 30 Sekunden Timeout
        toast.success('Bitte Karte am Terminal scannen...');
      }
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Fehler beim Starten des Scans');
    }
  };

  const stopRfidScan = async () => {
    try {
      await terminalApi.stopRfidRegistration();
    } catch {
      // Ignore errors
    }
    setIsScanning(false);
    setScanCountdown(0);
  };

  // WebSocket für RFID-Lookup
  useEffect(() => {
    if (!showLookupModal) {
      setLookupSocketConnected(false);
      return;
    }

    const socket = io(window.location.origin, {
      path: '/socket.io/',
      transports: ['websocket', 'polling'],
      timeout: 5000,
      auth: { token: useAuthStore.getState().token || '' },
    });
    lookupSocketRef.current = socket;

    socket.on('connect', () => setLookupSocketConnected(true));
    socket.on('disconnect', () => setLookupSocketConnected(false));
    socket.on('connect_error', () => setLookupSocketConnected(false));

    socket.on('rfid-card-lookup', (data: any) => {
      setLookupScanning(false);
      setLookupCountdown(0);

      if (data.success) {
        setLookupResult(data);
      } else {
        toast.error(data.error || 'Abfrage fehlgeschlagen');
      }
    });

    return () => {
      socket.disconnect();
      lookupSocketRef.current = null;
      setLookupSocketConnected(false);
    };
  }, [showLookupModal]);

  // Lookup Countdown Timer
  useEffect(() => {
    if (!lookupScanning || lookupCountdown <= 0) return;

    const timer = setInterval(() => {
      setLookupCountdown((prev) => {
        if (prev <= 1) {
          setLookupScanning(false);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [lookupScanning, lookupCountdown]);

  const startLookupScan = async () => {
    if (!lookupSocketConnected || !lookupSocketRef.current?.id) {
      toast.error('WebSocket nicht verbunden - bitte warten...');
      return;
    }

    setLookupResult(null);
    try {
      const response = await terminalApi.startRfidLookup(lookupSocketRef.current.id);
      if (response.data.success) {
        setLookupScanning(true);
        setLookupCountdown(30);
        toast.success('Bitte Karte am Terminal scannen...');
      }
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Fehler beim Starten');
    }
  };

  const stopLookupScan = async () => {
    try {
      await terminalApi.stopRfidLookup();
    } catch { /* ignore */ }
    setLookupScanning(false);
    setLookupCountdown(0);
  };

  // Time Entries Functions
  const loadTimeEntries = async (employeeId: string, month: Date) => {
    setLoadingTimeEntries(true);
    try {
      const from = startOfMonth(month).toISOString();
      const to = endOfMonth(month).toISOString();
      const year = month.getFullYear();

      // Load time entries, absences, and holidays in parallel
      const [entriesResponse, absencesResponse, holidaysResponse] = await Promise.all([
        timeEntriesApi.getAll({ employeeId, from, to }),
        settingsApi.getAbsences({ employeeId, from, to }),
        settingsApi.getHolidays(year),
      ]);

      setTimeEntries(entriesResponse.data as TimeEntry[]);
      setAbsences(absencesResponse.data as EmployeeAbsence[]);
      setHolidays(holidaysResponse.data as Holiday[]);
    } catch (error) {
      console.error('Error loading time entries:', error);
      toast.error('Fehler beim Laden der Zeiteinträge');
    } finally {
      setLoadingTimeEntries(false);
    }
  };

  const closeTimeEntriesModal = () => {
    setShowTimeEntriesModal(false);
    setSelectedEmployeeForTime(null);
    setTimeEntries([]);
    setAbsences([]);
    setHolidays([]);
    setEditingTimeEntry(null);
    setEditingDate(null);
    setShowCreateEntry(false);
    setShowAbsencePopup(false);
    setEditingAbsence(null);
  };

  const handleMonthChange = (direction: 'prev' | 'next') => {
    const newMonth = direction === 'prev' ? subMonths(selectedMonth, 1) : addMonths(selectedMonth, 1);
    setSelectedMonth(newMonth);
    if (selectedEmployeeForTime) {
      loadTimeEntries(selectedEmployeeForTime.id, newMonth);
    }
  };

  const getEntriesForDate = (date: Date): TimeEntry[] => {
    return timeEntries
      .filter(entry => isSameDay(new Date(entry.clockIn), date))
      .sort((a, b) => new Date(a.clockIn).getTime() - new Date(b.clockIn).getTime());
  };

  const getAbsenceForDate = (date: Date): EmployeeAbsence | undefined => {
    return absences.find(absence => isSameDay(new Date(absence.date), date));
  };

  const getHolidayForDate = (date: Date): Holiday | undefined => {
    return holidays.find(holiday => isSameDay(new Date(holiday.date), date));
  };

  // Berechnet Arbeitsstunden und automatische Pausen für einen Tag
  // Nur volle Minuten werden gezählt (keine Sekunden)
  const calculateDaySummary = (date: Date): DaySummary => {
    const entries = getEntriesForDate(date);
    const absence = getAbsenceForDate(date);
    const holiday = getHolidayForDate(date);
    let totalWorkMinutes = 0;
    let totalBreakMinutes = 0;
    let isActive = false;

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];

      // Arbeitszeit dieses Eintrags (nur volle Minuten)
      if (entry.clockOut) {
        const workMs = new Date(entry.clockOut).getTime() - new Date(entry.clockIn).getTime();
        totalWorkMinutes += Math.floor(workMs / (1000 * 60));
      } else {
        // Noch eingestempelt
        isActive = true;
        const workMs = new Date().getTime() - new Date(entry.clockIn).getTime();
        totalWorkMinutes += Math.floor(workMs / (1000 * 60));
      }

      // Automatische Pause: Zeit zwischen diesem clockOut und nächstem clockIn (nur volle Minuten)
      if (entry.clockOut && i < entries.length - 1) {
        const nextEntry = entries[i + 1];
        const breakMs = new Date(nextEntry.clockIn).getTime() - new Date(entry.clockOut).getTime();
        if (breakMs > 0) {
          totalBreakMinutes += Math.floor(breakMs / (1000 * 60));
        }
      }
    }

    return {
      date,
      entries,
      totalWorkMinutes,
      totalBreakMinutes,
      isActive,
      absence,
      holiday,
    };
  };

  const formatMinutesToHours = (minutes: number): string => {
    const hours = Math.floor(minutes / 60);
    const mins = Math.floor(minutes % 60);
    return `${hours}:${mins.toString().padStart(2, '0')}`;
  };

  // Formatiert Dezimalstunden zu H:MM Format
  const formatHoursToTime = (hours: number): string => {
    let h = Math.floor(hours);
    let m = Math.round((hours - h) * 60);
    // Falls Minuten auf 60 gerundet werden -> Stunde erhöhen
    if (m === 60) {
      h += 1;
      m = 0;
    }
    return `${h}:${m.toString().padStart(2, '0')}`;
  };

  const handleDayClick = (date: Date, entry?: TimeEntry) => {
    setEditingDate(date);

    if (entry) {
      // Bearbeite einen bestehenden Eintrag
      setEditingTimeEntry(entry);
      setShowCreateEntry(false);
      setTimeEntryFormData({
        clockIn: format(new Date(entry.clockIn), "HH:mm"),
        clockOut: entry.clockOut ? format(new Date(entry.clockOut), "HH:mm") : '',
        breakMinutes: 0, // Nicht mehr manuell, wird automatisch berechnet
        note: entry.note || '',
      });
    } else {
      // Neuen Eintrag für diesen Tag erstellen
      setEditingTimeEntry(null);
      setShowCreateEntry(true);

      // Auto-fill: Prüfe ob bereits Einträge für diesen Tag existieren
      const existingEntries = getEntriesForDate(date);
      let defaultClockIn = '08:00';
      let defaultClockOut = '17:00';

      if (existingEntries.length > 0) {
        // Sortiere nach clockIn und nimm den letzten Eintrag
        const lastEntry = existingEntries[existingEntries.length - 1];
        if (lastEntry.clockOut) {
          // clockIn = letztes clockOut
          defaultClockIn = format(new Date(lastEntry.clockOut), 'HH:mm');
          // clockOut leer lassen (Mitarbeiter soll es eingeben)
          defaultClockOut = '';
        }
      }

      setTimeEntryFormData({
        clockIn: defaultClockIn,
        clockOut: defaultClockOut,
        breakMinutes: 0,
        note: '',
      });
    }
  };

  const closeQuickEdit = () => {
    setEditingTimeEntry(null);
    setShowCreateEntry(false);
  };

  const handleTimeEntrySubmit = async (e: React.FormEvent, keepOpen: boolean = false) => {
    e.preventDefault();
    if (!selectedEmployeeForTime || !editingDate) return;

    try {
      const dateStr = format(editingDate, 'yyyy-MM-dd');
      const clockInDate = new Date(`${dateStr}T${timeEntryFormData.clockIn}:00`);
      const clockOutDate = timeEntryFormData.clockOut
        ? new Date(`${dateStr}T${timeEntryFormData.clockOut}:00`)
        : null;

      if (editingTimeEntry) {
        // Update existing entry
        const response = await timeEntriesApi.update(editingTimeEntry.id, {
          clockIn: clockInDate.toISOString(),
          clockOut: clockOutDate?.toISOString() || null,
          breakMinutes: timeEntryFormData.breakMinutes,
          note: timeEntryFormData.note || null,
        });
        // Optimistic Update: Lokalen State direkt aktualisieren
        setTimeEntries(prev => prev.map(entry =>
          entry.id === editingTimeEntry.id ? response.data : entry
        ));
        toast.success('Eintrag gespeichert');
        closeQuickEdit();
      } else {
        // Create new entry
        const response = await timeEntriesApi.createManual({
          employeeId: selectedEmployeeForTime.id,
          clockIn: clockInDate.toISOString(),
          clockOut: clockOutDate?.toISOString() || null,
          breakMinutes: timeEntryFormData.breakMinutes,
          note: timeEntryFormData.note || null,
        });
        // Optimistic Update: Neuen Eintrag hinzufügen
        setTimeEntries(prev => [...prev, response.data]);
        toast.success('Eintrag gespeichert');

        if (keepOpen && clockOutDate) {
          // Modal offen lassen, clockIn auf letztes clockOut setzen
          setTimeEntryFormData({
            clockIn: timeEntryFormData.clockOut,
            clockOut: '',
            breakMinutes: 0,
            note: '',
          });
          // Fokus auf Einstempeln-Feld setzen
          setTimeout(() => clockInInputRef.current?.focus(), 50);
        } else {
          closeQuickEdit();
        }
      }
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Fehler beim Speichern');
    }
  };

  const handleTimeEntryDelete = async () => {
    if (!editingTimeEntry || !selectedEmployeeForTime) return;

    if (confirm('Zeiteintrag wirklich löschen?')) {
      try {
        await timeEntriesApi.delete(editingTimeEntry.id);
        // Optimistic Update: Eintrag aus lokalem State entfernen
        setTimeEntries(prev => prev.filter(entry => entry.id !== editingTimeEntry.id));
        toast.success('Zeiteintrag gelöscht');
        closeQuickEdit();
      } catch (error: any) {
        toast.error(error.response?.data?.error || 'Fehler beim Löschen');
      }
    }
  };

  // Reklamation bearbeiten
  const handleResolveComplaint = async () => {
    if (!editingTimeEntry) return;
    setIsResolvingComplaint(true);
    try {
      const response = await timeEntriesApi.resolveComplaint(editingTimeEntry.id, complaintResponse || undefined);
      // Optimistic Update
      setTimeEntries(prev => prev.map(entry =>
        entry.id === editingTimeEntry.id ? response.data : entry
      ));
      setEditingTimeEntry(response.data);
      toast.success('Reklamation als bearbeitet markiert');
      setShowComplaintModal(false);
      setComplaintResponse('');
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Fehler beim Bearbeiten der Reklamation');
    } finally {
      setIsResolvingComplaint(false);
    }
  };

  // Absence Functions
  const openAbsencePopup = (date: Date, absence?: EmployeeAbsence) => {
    setEditingDate(date);
    setEditingTimeEntry(null);
    setShowCreateEntry(false);
    setSelectedDates([date]); // Single date selection

    if (absence) {
      setEditingAbsence(absence);
      setAbsenceFormData({
        absenceTypeId: absence.absenceTypeId,
        note: absence.note || '',
      });
    } else {
      setEditingAbsence(null);
      setAbsenceFormData({
        absenceTypeId: absenceTypes?.[0]?.id || '',
        note: '',
      });
    }
    setShowAbsencePopup(true);
  };

  // Pause Functions
  const openPausePopup = (date: Date, entryId: string) => {
    setPauseDate(date);
    setPauseEntryId(entryId);
    setPauseStart('12:00');
    setPauseEnd('12:30');
    setShowPausePopup(true);
  };

  const handleInsertPause = async () => {
    if (!pauseEntryId || !pauseDate) return;
    try {
      const dateStr = format(pauseDate, 'yyyy-MM-dd');
      await timeEntriesApi.insertPause(pauseEntryId, {
        pauseStart: `${dateStr}T${pauseStart}:00`,
        pauseEnd: `${dateStr}T${pauseEnd}:00`,
      });
      toast.success('Pause eingefügt');
      setShowPausePopup(false);
      // Reload time entries
      const from = format(startOfMonth(selectedMonth), 'yyyy-MM-dd');
      const to = format(endOfMonth(selectedMonth), 'yyyy-MM-dd');
      const res = await timeEntriesApi.getAll({ employeeId: selectedEmployeeForTime!.id, from, to });
      setTimeEntries(res.data);
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Fehler beim Einfügen der Pause');
    }
  };

  // Multi-Select: Popup mit mehreren Tagen öffnen
  const openMultiAbsencePopup = (dates: Date[]) => {
    setEditingDate(dates[0]);
    setEditingTimeEntry(null);
    setShowCreateEntry(false);
    setEditingAbsence(null);
    setSelectedDates(dates);
    setAbsenceFormData({
      absenceTypeId: absenceTypes?.[0]?.id || '',
      note: '',
    });
    setShowAbsencePopup(true);
  };

  const closeAbsencePopup = () => {
    setShowAbsencePopup(false);
    setEditingAbsence(null);
    setSelectedDates([]);
    // Reset multi-select state
    setIsSelecting(false);
    setSelectionStart(null);
    setSelectionEnd(null);
  };

  // Multi-Select: Berechnet alle Tage zwischen Start und Ende
  // Bei gleichem Wochentag (vertikal im Kalender) → nur diesen Wochentag auswählen
  const getSelectedDateRange = (): Date[] => {
    if (!selectionStart || !selectionEnd) return [];

    const start = selectionStart < selectionEnd ? selectionStart : selectionEnd;
    const end = selectionStart < selectionEnd ? selectionEnd : selectionStart;
    const allDays = eachDayOfInterval({ start, end });

    // Wenn Start und Ende der gleiche Wochentag sind (vertikaler Drag)
    // → nur diesen Wochentag auswählen
    if (selectionStart.getDay() === selectionEnd.getDay() && !isSameDay(selectionStart, selectionEnd)) {
      return allDays.filter(d => d.getDay() === selectionStart.getDay());
    }

    return allDays;
  };

  // Prüft ob ein Datum in der aktuellen Auswahl ist
  const isDateInSelection = (date: Date): boolean => {
    if (!isSelecting || !selectionStart) return false;

    const range = getSelectedDateRange();
    return range.some((d) => isSameDay(d, date));
  };

  // Multi-Select: Mouse-Events für Drag-Auswahl
  const handleSelectionStart = (date: Date, e: React.MouseEvent) => {
    // Nur mit linker Maustaste und wenn kein Popup offen ist
    if (e.button !== 0 || showAbsencePopup || editingTimeEntry || showCreateEntry) return;

    setIsSelecting(true);
    setSelectionStart(date);
    setSelectionEnd(date);
  };

  const handleSelectionMove = (date: Date) => {
    if (!isSelecting) return;
    setSelectionEnd(date);
  };

  const handleSelectionEnd = () => {
    if (!isSelecting || !selectionStart || !selectionEnd) {
      setIsSelecting(false);
      return;
    }

    const dates = getSelectedDateRange();

    // Bei Einzelklick (nur ein Tag) KEIN Abwesenheit-Popup öffnen
    if (dates.length <= 1) {
      setIsSelecting(false);
      setSelectionStart(null);
      setSelectionEnd(null);
      return;
    }

    // Filtere Tage raus, die bereits eine Abwesenheit haben
    const availableDates = dates.filter((d) => !getAbsenceForDate(d));

    if (availableDates.length === 0) {
      toast.error('Alle ausgewählten Tage haben bereits eine Abwesenheit');
      setIsSelecting(false);
      setSelectionStart(null);
      setSelectionEnd(null);
      return;
    }

    // Mehrere Tage -> Multi-Popup öffnen
    openMultiAbsencePopup(availableDates);

    setIsSelecting(false);
  };

  const handleAbsenceSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEmployeeForTime || !absenceFormData.absenceTypeId) return;

    try {
      if (editingAbsence) {
        // Update existing absence (nur einzelner Tag)
        const response = await settingsApi.updateAbsence(editingAbsence.id, {
          absenceTypeId: absenceFormData.absenceTypeId,
          note: absenceFormData.note || null,
        });
        // Optimistic Update: Lokalen State aktualisieren
        setAbsences(prev => prev.map(absence =>
          absence.id === editingAbsence.id ? response.data : absence
        ));
        toast.success('Abwesenheit aktualisiert');
      } else if (selectedDates.length > 0) {
        // Create absences for all selected dates
        let successCount = 0;
        let errorCount = 0;
        const newAbsences: EmployeeAbsence[] = [];

        for (const date of selectedDates) {
          try {
            const dateStr = format(date, 'yyyy-MM-dd');
            const response = await settingsApi.createAbsence({
              employeeId: selectedEmployeeForTime.id,
              absenceTypeId: absenceFormData.absenceTypeId,
              date: new Date(dateStr).toISOString(),
              note: absenceFormData.note || null,
            });
            newAbsences.push(response.data);
            successCount++;
          } catch {
            errorCount++;
          }
        }

        // Optimistic Update: Neue Abwesenheiten hinzufügen
        if (newAbsences.length > 0) {
          setAbsences(prev => [...prev, ...newAbsences]);
        }

        if (successCount > 0) {
          toast.success(
            selectedDates.length === 1
              ? 'Abwesenheit erstellt'
              : `${successCount} Abwesenheiten erstellt${errorCount > 0 ? ` (${errorCount} fehlgeschlagen)` : ''}`
          );
        } else {
          toast.error('Keine Abwesenheiten erstellt');
        }
      }

      closeAbsencePopup();
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Fehler beim Speichern');
    }
  };

  const handleAbsenceDelete = async () => {
    if (!editingAbsence || !selectedEmployeeForTime) return;

    if (confirm('Abwesenheit wirklich löschen?')) {
      try {
        await settingsApi.deleteAbsence(editingAbsence.id);
        // Optimistic Update: Abwesenheit aus lokalem State entfernen
        setAbsences(prev => prev.filter(absence => absence.id !== editingAbsence.id));
        toast.success('Abwesenheit gelöscht');
        closeAbsencePopup();
      } catch (error: any) {
        toast.error(error.response?.data?.error || 'Fehler beim Löschen');
      }
    }
  };

  // Berechnet Gesamtminuten für den Monat (mit automatischer Pausenberechnung)
  const calculateTotalMinutes = (): { workMinutes: number; breakMinutes: number } => {
    const days = eachDayOfInterval({
      start: startOfMonth(selectedMonth),
      end: endOfMonth(selectedMonth),
    });

    let totalWorkMinutes = 0;
    let totalBreakMinutes = 0;

    for (const day of days) {
      const summary = calculateDaySummary(day);
      totalWorkMinutes += summary.totalWorkMinutes;
      totalBreakMinutes += summary.totalBreakMinutes;
    }

    return {
      workMinutes: totalWorkMinutes,
      breakMinutes: totalBreakMinutes,
    };
  };

  // Close popup when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      // Wenn Reklamations-Modal offen ist, nicht das QuickEdit schließen
      if (complaintModalRef.current?.contains(event.target as Node)) {
        return;
      }
      if (popupRef.current && !popupRef.current.contains(event.target as Node)) {
        closeQuickEdit();
      }
      if (absencePopupRef.current && !absencePopupRef.current.contains(event.target as Node)) {
        closeAbsencePopup();
      }
    };

    if (editingTimeEntry || showCreateEntry || showAbsencePopup) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [editingTimeEntry, showCreateEntry, showAbsencePopup]);

  // Global mouseup listener für Drag-Auswahl
  useEffect(() => {
    if (isSelecting) {
      const handleGlobalMouseUp = () => {
        handleSelectionEnd();
      };

      document.addEventListener('mouseup', handleGlobalMouseUp);

      return () => {
        document.removeEventListener('mouseup', handleGlobalMouseUp);
      };
    }
  }, [isSelecting, selectionStart, selectionEnd]);

  const filteredEmployees = employees?.filter((e) => {
    const query = searchQuery.toLowerCase();
    return (
      e.firstName.toLowerCase().includes(query) ||
      e.lastName.toLowerCase().includes(query) ||
      e.employeeNumber.toLowerCase().includes(query)
    );
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Mitarbeiter</h1>
          <p className="text-gray-500">Mitarbeiter verwalten</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => { setShowLookupModal(true); setLookupResult(null); }}
            className="btn btn-secondary flex items-center gap-2"
          >
            <CreditCard size={20} />
            Karte abfragen
          </button>
          <button onClick={openCreateModal} className="btn btn-primary flex items-center gap-2">
            <Plus size={20} />
            Neuer Mitarbeiter
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Mitarbeiter suchen..."
          className="input pl-10"
        />
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
                  Kontakt
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Urlaub/Woche
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
              {isLoading ? (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-gray-500">
                    Laden...
                  </td>
                </tr>
              ) : filteredEmployees?.length ? (
                filteredEmployees.map((employee) => (
                  <tr key={employee.id} className={!employee.isActive ? 'bg-gray-50 opacity-60' : ''}>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        {/* Avatar/Foto */}
                        <div className="relative group">
                          {employee.photoUrl ? (
                            <img
                              src={employee.photoUrl}
                              alt={`${employee.firstName} ${employee.lastName}`}
                              className="w-10 h-10 rounded-full object-cover border-2 border-gray-200"
                            />
                          ) : (
                            <div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center text-gray-500">
                              <User size={20} />
                            </div>
                          )}
                          {/* Foto-Upload Overlay */}
                          <label className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-full opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer">
                            <Camera size={16} className="text-white" />
                            <input
                              type="file"
                              accept="image/jpeg,image/png,image/gif,image/webp"
                              className="hidden"
                              onChange={(e) => handlePhotoUpload(employee, e)}
                              disabled={uploadPhotoMutation.isPending}
                            />
                          </label>
                          {/* Löschen-Button wenn Foto vorhanden */}
                          {employee.photoUrl && (
                            <button
                              onClick={() => handlePhotoDelete(employee)}
                              className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                              title="Foto löschen"
                            >
                              <X size={12} className="text-white" />
                            </button>
                          )}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="font-medium text-gray-900">
                              {employee.firstName} {employee.lastName}
                            </p>
                            {complaintsByEmployee[employee.id] > 0 && (
                              <span className="flex items-center gap-1 px-1.5 py-0.5 text-xs font-bold text-orange-700 bg-orange-100 rounded-full">
                                <AlertTriangle size={12} />
                                {complaintsByEmployee[employee.id]}
                              </span>
                            )}
                          </div>
                          <p className="text-sm text-gray-500">#{employee.employeeNumber}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <p className="text-sm text-gray-900">{employee.email || '-'}</p>
                      <p className="text-sm text-gray-500">{employee.phone || '-'}</p>
                    </td>
                    <td className="px-6 py-4">
                      {employee.isAdmin ? (
                        <span className="text-sm text-gray-400">—</span>
                      ) : (
                        <>
                          <p className="text-gray-900">{employee.vacationDaysPerYear} Tage/Jahr</p>
                          <p className="text-sm text-gray-500">{employee.weeklyHours}h/Woche</p>
                          {employee.workCategory && (
                            <p className="text-xs text-primary-600">{employee.workCategory.name}</p>
                          )}
                        </>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-col gap-1">
                        <span
                          className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${
                            employee.isActive
                              ? 'bg-green-100 text-green-700'
                              : 'bg-gray-100 text-gray-600'
                          }`}
                        >
                          {employee.isActive ? 'Aktiv' : 'Inaktiv'}
                        </span>
                        {employee.isAdmin && (
                          <span className="inline-flex px-2 py-1 text-xs font-medium rounded-full bg-purple-100 text-purple-700">
                            Admin
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center justify-end gap-2">
                        {!employee.isAdmin && (
                        <>
                        <button
                          onClick={() => openRfidModal(employee)}
                          className={`p-2 rounded-lg ${
                            employee.rfidCard
                              ? 'text-green-600 hover:text-green-700 hover:bg-green-50'
                              : 'text-gray-500 hover:text-primary-600 hover:bg-primary-50'
                          }`}
                          title={employee.rfidCard ? `RFID: ${employee.rfidCard}` : 'RFID-Karte zuweisen'}
                        >
                          <CreditCard size={18} />
                        </button>
                        <button
                          onClick={() => navigate(`/admin/time-entries?employee=${employee.id}`)}
                          className="p-2 text-gray-500 hover:text-primary-600 hover:bg-primary-50 rounded-lg"
                          title="Zeiteinträge"
                        >
                          <Calendar size={18} />
                        </button>
                        </>
                        )}
                        <button
                          onClick={() => { setSelectedEmployeeForDocs(employee); setShowDocumentsModal(true); }}
                          className="p-2 text-gray-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg"
                          title="Dokumente"
                        >
                          <FolderOpen size={18} />
                        </button>
                        <button
                          onClick={() => openEditModal(employee)}
                          className="p-2 text-gray-500 hover:text-primary-600 hover:bg-primary-50 rounded-lg"
                          title="Bearbeiten"
                        >
                          <Edit2 size={18} />
                        </button>
                        <button
                          onClick={() => handleDelete(employee)}
                          className="p-2 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg"
                          title="Deaktivieren"
                          disabled={!employee.isActive}
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
                    Keine Mitarbeiter gefunden
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-gray-100 flex items-center justify-between">
              <h2 className="text-xl font-semibold">
                {editingEmployee ? 'Mitarbeiter bearbeiten' : 'Neuer Mitarbeiter'}
              </h2>
              <button onClick={closeModal} className="p-2 hover:bg-gray-100 rounded-lg">
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Mitarbeiternummer</label>
                  <input
                    type="text"
                    value={formData.employeeNumber}
                    onChange={(e) => setFormData({ ...formData, employeeNumber: e.target.value })}
                    className="input"
                    required
                  />
                </div>
                <div>
                  <label className="label">Benutzername</label>
                  <input
                    type="text"
                    value={formData.username}
                    onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                    className="input"
                    placeholder="z.B. max.mustermann"
                  />
                  <p className="text-xs text-gray-400 mt-1">Für die Anmeldung im Dashboard</p>
                </div>
              </div>
              {!formData.isAdmin && (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Urlaubstage/Jahr</label>
                  <input
                    type="number"
                    min="0"
                    max="365"
                    value={formData.vacationDaysPerYear}
                    onChange={(e) => setFormData({ ...formData, vacationDaysPerYear: parseInt(e.target.value) || 0 })}
                    className="input"
                    required
                  />
                </div>
              </div>
              )}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Vorname</label>
                  <input
                    type="text"
                    value={formData.firstName}
                    onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                    className="input"
                    required
                  />
                </div>
                <div>
                  <label className="label">Nachname</label>
                  <input
                    type="text"
                    value={formData.lastName}
                    onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
                    className="input"
                    required
                  />
                </div>
              </div>
              <div>
                <label className="label">E-Mail</label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className="input"
                />
              </div>
              <div>
                <label className="label">Telefon</label>
                <input
                  type="tel"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  className="input"
                />
              </div>
              {!formData.isAdmin && (
              <>
              <div>
                <label className="label">Wochenstunden</label>
                <input
                  type="number"
                  step="0.5"
                  value={formData.weeklyHours}
                  onChange={(e) => setFormData({ ...formData, weeklyHours: parseFloat(e.target.value) })}
                  className="input"
                  required
                />
              </div>
              <div>
                <label className="label">Arbeitstage</label>
                <div className="flex flex-wrap gap-2">
                  {WEEKDAY_OPTIONS.map((day) => {
                    const workDayNumbers = formData.workDays.split(',').map(d => parseInt(d.trim())).filter(d => !isNaN(d));
                    const isChecked = workDayNumbers.includes(day.value);
                    return (
                      <label
                        key={day.value}
                        className={`flex items-center gap-1 px-3 py-1.5 rounded-lg cursor-pointer border transition-colors ${
                          isChecked
                            ? 'bg-primary-100 border-primary-500 text-primary-700'
                            : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={(e) => {
                            let newWorkDays: number[];
                            if (e.target.checked) {
                              newWorkDays = [...workDayNumbers, day.value].sort((a, b) => a - b);
                            } else {
                              newWorkDays = workDayNumbers.filter(d => d !== day.value);
                            }
                            setFormData({ ...formData, workDays: newWorkDays.join(',') || '1,2,3,4,5' });
                          }}
                          className="sr-only"
                        />
                        <span className="text-sm font-medium">{day.label}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
              <div>
                <label className="label">Arbeitskategorie</label>
                <select
                  value={formData.workCategoryId}
                  onChange={(e) => setFormData({ ...formData, workCategoryId: e.target.value })}
                  className="input"
                >
                  <option value="">Keine Kategorie</option>
                  {workCategories?.map((cat: any) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.name} (ab {cat.earliestClockIn} Uhr)
                    </option>
                  ))}
                </select>
              </div>
              {/* Eintritts-/Austrittsdatum */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Eintrittsdatum</label>
                  <input
                    type="date"
                    value={formData.startDate}
                    onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
                    className="input"
                  />
                </div>
                <div>
                  <label className="label">Austrittsdatum</label>
                  <input
                    type="date"
                    value={formData.endDate}
                    onChange={(e) => setFormData({ ...formData, endDate: e.target.value })}
                    className="input"
                  />
                  {formData.endDate && <p className="text-xs text-red-500 mt-1">MA kann sich ab diesem Datum nicht mehr einstempeln</p>}
                </div>
              </div>
              {/* Reguläres Arbeitszeitende */}
              <div>
                <label className="label">Reguläres Arbeitszeitende</label>
                <input
                  type="time"
                  value={formData.defaultClockOut}
                  onChange={(e) => setFormData({ ...formData, defaultClockOut: e.target.value })}
                  className="input"
                />
                <p className="text-xs text-gray-400 mt-1">Wird für Auto-Ausstempeln verwendet wenn der MA sich nicht ausstempelt</p>
              </div>
              {/* PWA-Stempelung */}
              <div>
                <label className="label">PWA-Stempelung (mobil)</label>
                <div className="space-y-2">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={formData.canClockInPwa}
                      onChange={(e) => setFormData({ ...formData, canClockInPwa: e.target.checked })}
                      className="rounded"
                    />
                    <span className="text-sm">Einstempeln über PWA erlauben</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={formData.canClockOutPwa}
                      onChange={(e) => setFormData({ ...formData, canClockOutPwa: e.target.checked })}
                      className="rounded"
                    />
                    <span className="text-sm">Ausstempeln über PWA erlauben</span>
                  </label>
                </div>
              </div>
              </>
              )}
              <div>
                <label className="label">
                  {editingEmployee ? 'Neues Passwort (leer lassen = unverändert)' : 'Passwort'}
                </label>
                <input
                  type="password"
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  className="input"
                  minLength={editingEmployee ? 0 : 6}
                  required={!editingEmployee}
                />
                {editingEmployee && editingEmployee.email && (
                  <button
                    type="button"
                    id="reset-pw-btn"
                    className="mt-2 text-sm text-primary-600 hover:text-primary-700 inline-flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
                    onClick={async (e) => {
                      const btn = e.currentTarget;
                      btn.disabled = true;
                      const originalText = btn.innerHTML;
                      btn.innerHTML = '<svg class="animate-spin h-4 w-4" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" fill="none"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg> Wird gesendet...';
                      try {
                        const res = await authApi.adminResetPassword(editingEmployee.id);
                        toast.success(res.data.message || 'Passwort-Reset E-Mail wurde gesendet', { duration: 5000 });
                      } catch (err: any) {
                        toast.error(err.response?.data?.error || 'Fehler beim Senden');
                      } finally {
                        btn.innerHTML = originalText;
                        btn.disabled = false;
                      }
                    }}
                  >
                    <KeyRound size={14} />
                    Passwort-Reset per E-Mail senden
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="isAdmin"
                  checked={formData.isAdmin}
                  onChange={(e) => setFormData({ ...formData, isAdmin: e.target.checked })}
                  className="w-4 h-4 text-primary-600 rounded border-gray-300"
                />
                <label htmlFor="isAdmin" className="text-sm text-gray-700">
                  Administrator-Rechte
                </label>
              </div>
              {/* 2FA Management (only in edit mode) */}
              {editingEmployee && (
                <div className="border-t pt-4 mt-4">
                  <h4 className="text-sm font-semibold text-gray-700 mb-3">Zwei-Faktor-Authentifizierung</h4>
                  <TwoFactorAdminSection employeeId={editingEmployee.id} employeeName={`${editingEmployee.firstName} ${editingEmployee.lastName}`} />
                </div>
              )}

              <div className="flex justify-end gap-3 pt-4">
                <button type="button" onClick={closeModal} className="btn btn-secondary">
                  Abbrechen
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={createMutation.isPending || updateMutation.isPending}
                >
                  {editingEmployee ? 'Speichern' : 'Erstellen'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* RFID Modal */}
      {showRfidModal && rfidEmployee && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-sm w-full">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <CreditCard size={20} />
                RFID-Karte
              </h3>
              <button onClick={closeRfidModal} className="p-2 hover:bg-gray-100 rounded-lg">
                <X size={20} />
              </button>
            </div>

            <div className="mb-4">
              <p className="text-sm text-gray-600">
                Mitarbeiter: <strong>{rfidEmployee.firstName} {rfidEmployee.lastName}</strong>
              </p>
              <p className="text-sm text-gray-500">#{rfidEmployee.employeeNumber}</p>
            </div>

            {rfidEmployee.rfidCard ? (
              <div className="mb-4 p-3 bg-green-50 rounded-lg">
                <p className="text-sm text-green-700 font-medium">Aktuelle RFID-Karte:</p>
                <p className="font-mono text-green-800">{rfidEmployee.rfidCard}</p>
              </div>
            ) : (
              <div className="mb-4 p-3 bg-gray-50 rounded-lg">
                <p className="text-sm text-gray-500">Keine RFID-Karte zugewiesen</p>
              </div>
            )}

            {/* Scanning Status */}
            {isScanning && (
              <div className="mb-4 p-4 bg-blue-50 rounded-lg border-2 border-blue-200 animate-pulse">
                <div className="flex items-center justify-center gap-3 text-blue-700">
                  <Loader2 size={24} className="animate-spin" />
                  <div>
                    <p className="font-medium">Warte auf Karten-Scan...</p>
                    <p className="text-sm text-blue-600">
                      Bitte Karte am Terminal vorhalten ({scanCountdown}s)
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={stopRfidScan}
                  className="mt-3 w-full text-sm text-blue-600 hover:text-blue-800"
                >
                  Abbrechen
                </button>
              </div>
            )}

            <form onSubmit={handleRfidSubmit} className="space-y-4">
              <div>
                <label className="label">
                  {rfidEmployee.rfidCard ? 'Neue RFID-Karten-ID' : 'RFID-Karten-ID'}
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={rfidInput}
                    onChange={(e) => setRfidInput(e.target.value.toUpperCase())}
                    className="input font-mono flex-1"
                    placeholder="z.B. 1234567890"
                    autoFocus
                    disabled={isScanning}
                  />
                  <button
                    type="button"
                    onClick={startRfidScan}
                    disabled={isScanning || !isSocketConnected}
                    className={`btn ${isScanning ? 'btn-secondary' : isSocketConnected ? 'btn-primary' : 'btn-secondary opacity-50'} flex items-center gap-2`}
                    title={isSocketConnected ? 'Karte am Pi-Terminal scannen' : 'Verbinde zum Server...'}
                  >
                    {!isSocketConnected ? (
                      <Loader2 size={18} className="animate-spin" />
                    ) : (
                      <Wifi size={18} />
                    )}
                  </button>
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  {isSocketConnected ? (
                    <>ID manuell eingeben oder <strong>Wifi-Button</strong> klicken und Karte am Pi scannen</>
                  ) : (
                    <span className="text-orange-500">Verbinde zum Terminal-Server...</span>
                  )}
                </p>
              </div>

              <div className="flex gap-3">
                {rfidEmployee.rfidCard && (
                  <button
                    type="button"
                    onClick={handleRfidRemove}
                    className="btn btn-secondary text-red-600 hover:bg-red-50 flex-1"
                    disabled={removeRfidMutation.isPending || isScanning}
                  >
                    <Trash2 size={18} className="mr-2" />
                    Entfernen
                  </button>
                )}
                <button
                  type="submit"
                  className="btn btn-primary flex-1"
                  disabled={!rfidInput.trim() || registerRfidMutation.isPending || isScanning}
                >
                  {rfidEmployee.rfidCard ? 'Aktualisieren' : 'Registrieren'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Time Entries Modal - Fullscreen */}
      {showTimeEntriesModal && selectedEmployeeForTime && (
        <div className="fixed inset-0 z-50 bg-white flex flex-col">
            {/* Header */}
            <div className="p-6 border-b border-gray-100 flex items-center justify-between shrink-0">
              <div>
                <h2 className="text-xl font-semibold">
                  Zeiteinträge: {selectedEmployeeForTime.firstName} {selectedEmployeeForTime.lastName}
                </h2>
                <p className="text-sm text-gray-500">#{selectedEmployeeForTime.employeeNumber}</p>
              </div>
              <button onClick={closeTimeEntriesModal} className="p-2 hover:bg-gray-100 rounded-lg">
                <X size={20} />
              </button>
            </div>

            {/* Stats */}
            <div className="px-4 py-2 border-b border-gray-100 shrink-0">
              {(() => {
                const totals = calculateTotalMinutes();
                return (
                  <div className="bg-primary-50 rounded-lg p-2.5 flex justify-center gap-8 text-sm">
                    <span className="text-primary-700 font-medium">
                      Arbeitszeit: {formatMinutesToHours(totals.workMinutes)} h
                    </span>
                    <span className="text-orange-600 font-medium">
                      Pausen: {formatMinutesToHours(totals.breakMinutes)} h
                    </span>
                  </div>
                );
              })()}
            </div>

            {/* Chipdrive-Style Layout: Detail links, Kalender rechts */}
            <div className={`flex-1 overflow-hidden px-4 pb-4 transition-opacity duration-200 ${loadingTimeEntries ? 'opacity-50' : ''}`}>
                <div className="flex gap-4 h-full">
                  {/* LINKE SEITE: Tagesdetails */}
                  <div className="flex-1 overflow-y-auto">
                    {editingDate ? (() => {
                      const summary = calculateDaySummary(editingDate);
                      const employeeWorkDays = selectedEmployeeForTime?.workDays?.split(',').map(d => parseInt(d.trim())).filter(d => !isNaN(d)) || [1,2,3,4,5];
                      const isNonWorkDay = !employeeWorkDays.includes(editingDate.getDay());
                      const hasEntries = summary.entries.length > 0;
                      const hasAbsence = !!summary.absence;
                      const isHolidayOnWorkDay = !!summary.holiday && !isNonWorkDay;

                      return (
                        <div className="space-y-4">
                          {/* Tages-Header */}
                          <div className="flex items-center justify-between">
                            <div>
                              <h3 className="text-lg font-semibold text-gray-900">
                                {format(editingDate, 'EEEE, dd. MMMM yyyy', { locale: de })}
                              </h3>
                              <p className="text-sm text-gray-500">
                                {hasEntries ? `${formatMinutesToHours(summary.totalWorkMinutes)} h gearbeitet` : ''}
                                {summary.totalBreakMinutes > 0 ? ` · ${formatMinutesToHours(summary.totalBreakMinutes)} h Pause` : ''}
                                {summary.isActive ? ' · Aktiv' : ''}
                                {isHolidayOnWorkDay ? ` · Feiertag: ${summary.holiday!.name}` : ''}
                                {isNonWorkDay ? ' · Kein Arbeitstag' : ''}
                              </p>
                            </div>
                          </div>

                          {/* Abwesenheit */}
                          {hasAbsence && (
                            <div
                              className="flex items-center gap-2 cursor-pointer rounded-lg px-3 py-2"
                              style={{ backgroundColor: summary.absence!.absenceType.color + '20', borderLeft: `3px solid ${summary.absence!.absenceType.color}` }}
                              onClick={() => openAbsencePopup(editingDate, summary.absence)}
                            >
                              <Briefcase size={16} style={{ color: summary.absence!.absenceType.color }} />
                              <span className="font-medium" style={{ color: summary.absence!.absenceType.color }}>{summary.absence!.absenceType.name}</span>
                              {summary.absence!.absenceType.requiredHours > 0 && (
                                <span className="text-sm text-gray-500">({formatHoursToTime(summary.absence!.absenceType.requiredHours)} h Pflicht)</span>
                              )}
                              <Edit2 size={14} className="ml-auto text-gray-400" />
                            </div>
                          )}

                          {/* Stempelungen */}
                          {hasEntries ? (
                            <div className="bg-white border rounded-lg divide-y">
                              <div className="px-3 py-2 bg-gray-50 rounded-t-lg">
                                <span className="text-xs font-medium text-gray-500 uppercase">Buchungen</span>
                              </div>
                              {summary.entries.map((entry, idx) => (
                                <div key={entry.id}>
                                  {/* Pause zwischen Einträgen */}
                                  {idx > 0 && summary.entries[idx - 1].clockOut && (() => {
                                    const prevEnd = new Date(summary.entries[idx - 1].clockOut!);
                                    const currStart = new Date(entry.clockIn);
                                    const gapMinutes = Math.round((currStart.getTime() - prevEnd.getTime()) / 60000);
                                    if (gapMinutes > 0) {
                                      return (
                                        <div className="px-3 py-1.5 bg-orange-50 flex items-center gap-2 text-xs text-orange-600">
                                          <Clock size={12} />
                                          Pause: {format(prevEnd, 'HH:mm')} - {format(currStart, 'HH:mm')} ({gapMinutes} min)
                                        </div>
                                      );
                                    }
                                    return null;
                                  })()}
                                  <div
                                    className={`px-3 py-2 flex items-center gap-3 cursor-pointer hover:bg-gray-50 ${entry.complaintMessage && !entry.complaintResolvedAt ? 'bg-amber-50' : ''}`}
                                    onClick={() => handleDayClick(editingDate, entry)}
                                  >
                                    {entry.complaintMessage && (
                                      entry.complaintResolvedAt ? (
                                        <CheckCircle size={14} className="text-green-500 flex-shrink-0" />
                                      ) : (
                                        <AlertTriangle size={14} className="text-amber-500 flex-shrink-0" />
                                      )
                                    )}
                                    {((entry as any).clockInViaPwa || (entry as any).clockOutViaPwa) && (
                                      <button
                                        onClick={(e) => { e.stopPropagation(); setPwaDetailEntry(entry); }}
                                        className="flex-shrink-0 p-0.5 rounded hover:bg-blue-100"
                                      >
                                        <MapPin size={14} className="text-blue-500" />
                                      </button>
                                    )}
                                    <span className="font-mono text-sm font-medium w-28">
                                      {format(new Date(entry.clockIn), 'HH:mm')} - {entry.clockOut ? format(new Date(entry.clockOut), 'HH:mm') : <span className="text-green-600">Aktiv</span>}
                                    </span>
                                    {entry.clockOut && (
                                      <span className="text-sm text-gray-500">
                                        {formatMinutesToHours(Math.floor((new Date(entry.clockOut).getTime() - new Date(entry.clockIn).getTime()) / 60000))} h
                                      </span>
                                    )}
                                    {entry.note && <span className="text-xs text-gray-400 truncate ml-auto max-w-[150px]">{entry.note}</span>}
                                    <Edit2 size={14} className="text-gray-400 flex-shrink-0 ml-auto" />
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : !hasAbsence && !isHolidayOnWorkDay && !isNonWorkDay ? (
                            <div className="text-center text-gray-400 py-8 border rounded-lg border-dashed">
                              Keine Einträge für diesen Tag
                            </div>
                          ) : null}

                          {/* Action Buttons */}
                          <div className="flex items-center gap-2 flex-wrap">
                            <button
                              onClick={() => handleDayClick(editingDate)}
                              className="text-sm text-primary-600 hover:bg-primary-50 border border-primary-200 rounded px-3 py-1.5 flex items-center gap-1.5"
                            >
                              <Plus size={14} /> Eintrag hinzufügen
                            </button>
                            {!hasAbsence && absenceTypes && absenceTypes.length > 0 && (
                              <button
                                onClick={() => openAbsencePopup(editingDate)}
                                className="text-sm text-purple-600 hover:bg-purple-50 border border-purple-200 rounded px-3 py-1.5 flex items-center gap-1.5"
                              >
                                <Briefcase size={14} /> Abwesenheit
                              </button>
                            )}
                            {hasEntries && summary.entries.some((e: TimeEntry) => e.clockOut) && (
                              <button
                                onClick={() => {
                                  const completedEntry = summary.entries.find((e: TimeEntry) => e.clockOut);
                                  if (completedEntry) openPausePopup(editingDate, completedEntry.id);
                                }}
                                className="text-sm text-orange-600 hover:bg-orange-50 border border-orange-200 rounded px-3 py-1.5 flex items-center gap-1.5"
                              >
                                <Clock size={14} /> Pause
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })() : (
                      <div className="flex items-center justify-center h-full text-gray-400">
                        <div className="text-center">
                          <Calendar size={48} className="mx-auto mb-3 opacity-30" />
                          <p>Wähle einen Tag im Kalender</p>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* RECHTE SEITE: Kompakter Monatskalender */}
                  <div className="w-72 shrink-0 bg-white border rounded-lg p-3 self-start">
                    {(() => {
                      const monthStart = startOfMonth(selectedMonth);
                      const monthEnd = endOfMonth(selectedMonth);
                      const allDays = eachDayOfInterval({ start: monthStart, end: monthEnd });
                      const employeeWorkDays = selectedEmployeeForTime?.workDays?.split(',').map(d => parseInt(d.trim())).filter(d => !isNaN(d)) || [1,2,3,4,5];

                      // Wochen gruppieren (Mo=0)
                      const weeks: Date[][] = [];
                      let currentWeek: Date[] = [];
                      // Padding für erste Woche
                      const firstDayOfWeek = (monthStart.getDay() + 6) % 7; // Mo=0
                      for (let i = 0; i < firstDayOfWeek; i++) currentWeek.push(null as any);
                      for (const day of allDays) {
                        currentWeek.push(day);
                        if (currentWeek.length === 7) {
                          weeks.push(currentWeek);
                          currentWeek = [];
                        }
                      }
                      if (currentWeek.length > 0) {
                        while (currentWeek.length < 7) currentWeek.push(null as any);
                        weeks.push(currentWeek);
                      }

                      const MONTHS = ['Jan','Feb','Mär','Apr','Mai','Jun','Jul','Aug','Sep','Okt','Nov','Dez'];

                      return (
                        <>
                          {/* Monat/Jahr Navigation */}
                          <div className="flex items-center gap-1 mb-3">
                            <button onClick={() => handleMonthChange('prev')} className="p-1 hover:bg-gray-100 rounded">
                              <ChevronLeft size={16} />
                            </button>
                            <select
                              value={selectedMonth.getMonth()}
                              onChange={(e) => {
                                const newMonth = new Date(selectedMonth);
                                newMonth.setMonth(parseInt(e.target.value));
                                setSelectedMonth(newMonth);
                                if (selectedEmployeeForTime) loadTimeEntries(selectedEmployeeForTime.id, newMonth);
                              }}
                              className="text-sm font-medium bg-transparent border rounded px-1.5 py-0.5 cursor-pointer"
                            >
                              {MONTHS.map((m, i) => <option key={i} value={i}>{m}</option>)}
                            </select>
                            <select
                              value={selectedMonth.getFullYear()}
                              onChange={(e) => {
                                const newMonth = new Date(selectedMonth);
                                newMonth.setFullYear(parseInt(e.target.value));
                                setSelectedMonth(newMonth);
                                if (selectedEmployeeForTime) loadTimeEntries(selectedEmployeeForTime.id, newMonth);
                              }}
                              className="text-sm font-medium bg-transparent border rounded px-1.5 py-0.5 cursor-pointer"
                            >
                              {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - 2 + i).map(y => (
                                <option key={y} value={y}>{y}</option>
                              ))}
                            </select>
                            <button onClick={() => handleMonthChange('next')} className="p-1 hover:bg-gray-100 rounded">
                              <ChevronRight size={16} />
                            </button>
                          </div>

                          {/* Wochentag-Header */}
                          <div className="grid grid-cols-7 gap-0.5 mb-2">
                            {['Mo','Di','Mi','Do','Fr','Sa','So'].map(d => (
                              <div key={d} className="text-center text-[10px] font-medium text-gray-400 py-1">{d}</div>
                            ))}
                          </div>
                          <div className="grid grid-cols-7 gap-0.5">
                            {weeks.flat().map((day, i) => {
                              if (!day) return <div key={`empty-${i}`} className="aspect-square" />;

                              const summary = calculateDaySummary(day);
                              const isNonWork = !employeeWorkDays.includes(day.getDay());
                              const isToday = isSameDay(day, new Date());
                              const isSelected = editingDate && isSameDay(day, editingDate);
                              const hasEntries = summary.entries.length > 0;
                              const hasAbsence = !!summary.absence;
                              const isHoliday = !!summary.holiday && !isNonWork;
                              const isFuture = day > new Date();

                              // Farbcode
                              let bgColor = '';
                              let textColor = 'text-gray-900';
                              if (isSelected) {
                                bgColor = 'bg-primary-600'; textColor = 'text-white';
                              } else if (isNonWork) {
                                bgColor = 'bg-gray-100'; textColor = 'text-gray-400';
                              } else if (isHoliday) {
                                bgColor = 'bg-red-100'; textColor = 'text-red-700';
                              } else if (hasAbsence) {
                                bgColor = 'bg-blue-100'; textColor = 'text-blue-700';
                              } else if (hasEntries && summary.totalWorkMinutes > 0) {
                                bgColor = 'bg-green-100'; textColor = 'text-green-800';
                              } else if (summary.isActive) {
                                bgColor = 'bg-green-200'; textColor = 'text-green-900';
                              } else if (!isFuture && !isNonWork) {
                                bgColor = 'bg-orange-100'; textColor = 'text-orange-700';
                              } else {
                                bgColor = 'bg-gray-50';
                              }

                              const inSelection = isDateInSelection(day);

                              return (
                                <div
                                  key={day.toISOString()}
                                  onClick={() => { if (!isSelecting) setEditingDate(day); }}
                                  onMouseDown={(e) => { e.preventDefault(); handleSelectionStart(day, e); }}
                                  onMouseEnter={() => handleSelectionMove(day)}
                                  onMouseUp={() => handleSelectionEnd()}
                                  className={`aspect-square rounded flex flex-col items-center justify-center text-xs font-medium transition-all hover:ring-2 hover:ring-primary-300 select-none cursor-pointer ${inSelection ? 'bg-purple-200 text-purple-900 ring-2 ring-purple-400' : `${bgColor} ${textColor}`} ${isToday && !inSelection ? 'ring-2 ring-primary-500' : ''}`}
                                  title={`${format(day, 'dd.MM.')} - ${hasEntries ? formatMinutesToHours(summary.totalWorkMinutes) + 'h' : hasAbsence ? summary.absence!.absenceType.shortName : isHoliday ? 'Feiertag' : isNonWork ? 'Frei' : isFuture ? '' : 'Kein Eintrag'}`}
                                >
                                  <span className={`${isSelected ? 'font-bold' : ''}`}>{format(day, 'd')}</span>
                                  {hasEntries && !isSelected && !inSelection && (
                                    <span className="text-[8px] leading-none mt-0.5 opacity-75 pointer-events-none">{formatMinutesToHours(summary.totalWorkMinutes)}</span>
                                  )}
                                </div>
                              );
                            })}
                          </div>

                          {/* Legende */}
                          <div className="mt-3 pt-3 border-t flex flex-wrap gap-x-3 gap-y-1">
                            <div className="flex items-center gap-1 text-[10px] text-gray-500"><div className="w-2.5 h-2.5 rounded bg-green-100" /> Gearbeitet</div>
                            <div className="flex items-center gap-1 text-[10px] text-gray-500"><div className="w-2.5 h-2.5 rounded bg-orange-100" /> Fehlt</div>
                            <div className="flex items-center gap-1 text-[10px] text-gray-500"><div className="w-2.5 h-2.5 rounded bg-blue-100" /> Abwesend</div>
                            <div className="flex items-center gap-1 text-[10px] text-gray-500"><div className="w-2.5 h-2.5 rounded bg-red-100" /> Feiertag</div>
                            <div className="flex items-center gap-1 text-[10px] text-gray-500"><div className="w-2.5 h-2.5 rounded bg-gray-100" /> Frei</div>
                          </div>
                        </>
                      );
                    })()}
                  </div>
                </div>

              {/* Popups container */}
              <div className="relative">
                  {/* Hidden reference table */}
                  <table className="hidden">
                    <tbody>
                      {eachDayOfInterval({
                        start: startOfMonth(selectedMonth),
                        end: endOfMonth(selectedMonth),
                      }).map((date) => {
                        const summary = calculateDaySummary(date);
                        const employeeWorkDays = selectedEmployeeForTime?.workDays?.split(',').map(d => parseInt(d.trim())).filter(d => !isNaN(d)) || [1,2,3,4,5];
                        const isNonWorkDay = !employeeWorkDays.includes(date.getDay());
                        const isEditing = editingDate && isSameDay(date, editingDate);
                        const hasEntries = summary.entries.length > 0;
                        const hasAbsence = !!summary.absence;
                        const hasHoliday = !!summary.holiday;
                        const inSelection = isDateInSelection(date);

                        // Feiertage auf Arbeitstagen werden wie freie Tage behandelt
                        const isHolidayOnWorkDay = hasHoliday && !isNonWorkDay;

                        return (
                          <tr
                            key={date.toISOString()}
                            onMouseDown={(e) => {
                              // Nur starten wenn nicht auf einen Link/Button geklickt wird
                              if ((e.target as HTMLElement).closest('.entry-item')) return;
                              if ((e.target as HTMLElement).closest('.absence-item')) return;
                              if ((e.target as HTMLElement).closest('.holiday-item')) return;
                              if ((e.target as HTMLElement).closest('button')) return;
                              handleSelectionStart(date, e);
                            }}
                            onMouseEnter={() => handleSelectionMove(date)}
                            onClick={(e) => {
                              // Wenn auf einen spezifischen Eintrag geklickt wird, nicht die ganze Zeile
                              if ((e.target as HTMLElement).closest('.entry-item')) return;
                              if ((e.target as HTMLElement).closest('.absence-item')) return;
                              if ((e.target as HTMLElement).closest('.holiday-item')) return;
                              if ((e.target as HTMLElement).closest('button')) return;
                              // Nur bei Einzelklick (nicht bei Drag) neuen Eintrag erstellen
                              if (isSelecting) return;
                              // Zeiteinträge sind auch an Feiertagen möglich (Mitarbeiter kann trotzdem arbeiten)
                              if (!hasEntries && !hasAbsence) {
                                handleDayClick(date);
                              }
                            }}
                            className={`transition-colors select-none ${
                              isNonWorkDay ? 'bg-gray-50 text-gray-400' : ''
                            } ${isHolidayOnWorkDay && !isNonWorkDay ? 'bg-red-50' : ''} ${isEditing ? 'bg-primary-100' : ''} ${
                              inSelection ? 'bg-blue-100' : ''
                            } ${
                              hasAbsence ? '' : 'cursor-pointer hover:bg-primary-50'
                            }`}
                            style={hasAbsence && !inSelection && !hasHoliday ? { backgroundColor: summary.absence!.absenceType.color + '10' } : {}}
                          >
                            <td className="px-4 py-3 font-medium align-top">
                              {format(date, 'dd.MM.yyyy')}
                            </td>
                            <td className="px-4 py-3 align-top">
                              {format(date, 'EEEE', { locale: de })}
                            </td>
                            <td className="px-4 py-3">
                              {/* Feiertag anzeigen (auf Arbeitstagen) */}
                              {isHolidayOnWorkDay && (
                                <div
                                  className="holiday-item flex items-center gap-2 rounded px-2 py-1 -mx-1 mb-2 bg-red-100"
                                >
                                  <Star size={14} className="text-red-600" fill="currentColor" />
                                  <span className="font-medium text-red-700">
                                    {summary.holiday!.name}
                                  </span>
                                  <span className="text-xs text-red-500 ml-auto">
                                    Feiertag
                                  </span>
                                </div>
                              )}

                              {/* Abwesenheit anzeigen */}
                              {hasAbsence && (
                                <div
                                  className="absence-item flex items-center gap-2 cursor-pointer rounded px-2 py-1 -mx-1 mb-2"
                                  style={{
                                    backgroundColor: summary.absence!.absenceType.color + '20',
                                  }}
                                  onClick={() => openAbsencePopup(date, summary.absence)}
                                >
                                  <Briefcase
                                    size={14}
                                    style={{ color: summary.absence!.absenceType.color }}
                                  />
                                  <span
                                    className="font-medium"
                                    style={{ color: summary.absence!.absenceType.color }}
                                  >
                                    {summary.absence!.absenceType.name}
                                  </span>
                                  {summary.absence!.absenceType.requiredHours > 0 && (
                                    <span className="text-xs text-gray-500">
                                      ({formatHoursToTime(summary.absence!.absenceType.requiredHours)}h Pflicht)
                                    </span>
                                  )}
                                  <Edit2 size={14} className="text-gray-400 ml-auto" />
                                </div>
                              )}

                              {/* Zeiteinträge anzeigen */}
                              {hasEntries ? (
                                <div className="space-y-1">
                                  {summary.entries.map((entry) => (
                                    <div
                                      key={entry.id}
                                      className={`entry-item flex items-center gap-2 cursor-pointer hover:bg-gray-100 rounded px-1 -mx-1 ${entry.complaintMessage && !entry.complaintResolvedAt ? 'bg-amber-50' : ''}`}
                                      onClick={() => handleDayClick(date, entry)}
                                    >
                                      {/* Reklamations-Icon */}
                                      {entry.complaintMessage && (
                                        entry.complaintResolvedAt ? (
                                          <CheckCircle size={14} className="text-green-500 flex-shrink-0" />
                                        ) : (
                                          <AlertTriangle size={14} className="text-amber-500 flex-shrink-0" />
                                        )
                                      )}
                                      {((entry as any).clockInViaPwa || (entry as any).clockOutViaPwa) && (
                                        <button
                                          onClick={(e) => { e.stopPropagation(); setPwaDetailEntry(entry); }}
                                          className="flex-shrink-0 p-0.5 rounded hover:bg-blue-100"
                                          title="Auswärtsstempelung – Details anzeigen"
                                        >
                                          <MapPin size={14} className="text-blue-500" />
                                        </button>
                                      )}
                                      <span className="text-gray-900">
                                        {format(new Date(entry.clockIn), 'HH:mm')} -{' '}
                                        {entry.clockOut ? (
                                          format(new Date(entry.clockOut), 'HH:mm')
                                        ) : (
                                          <span className="text-green-600 font-medium">Aktiv</span>
                                        )}
                                      </span>
                                      <Edit2 size={14} className="text-gray-400" />
                                    </div>
                                  ))}
                                  {summary.totalBreakMinutes > 0 && (
                                    <div className="text-xs text-orange-600 mt-1">
                                      Pause: {formatMinutesToHours(summary.totalBreakMinutes)}
                                    </div>
                                  )}
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleDayClick(date);
                                    }}
                                    className="text-xs text-primary-600 hover:bg-primary-50 border border-primary-200 rounded px-2 py-1 mt-1 flex items-center gap-1"
                                  >
                                    <Plus size={12} />
                                    Eintrag
                                  </button>
                                </div>
                              ) : !hasAbsence ? (
                                <span className="text-gray-400">-</span>
                              ) : null}

                              {/* Buttons: Abwesenheit + Pause */}
                              <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                                {!hasAbsence && absenceTypes && absenceTypes.length > 0 && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      openAbsencePopup(date);
                                    }}
                                    className="text-xs text-purple-600 hover:bg-purple-50 border border-purple-200 rounded px-2 py-1 flex items-center gap-1"
                                  >
                                    <Briefcase size={12} />
                                    Abwesenheit
                                  </button>
                                )}
                                {hasEntries && summary.entries.some((e: TimeEntry) => e.clockOut) && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      const completedEntry = summary.entries.find((e: TimeEntry) => e.clockOut);
                                      if (completedEntry) openPausePopup(date, completedEntry.id);
                                    }}
                                    className="text-xs text-orange-600 hover:bg-orange-50 border border-orange-200 rounded px-2 py-1 flex items-center gap-1"
                                  >
                                    <Clock size={12} />
                                    Pause
                                  </button>
                                )}
                              </div>
                            </td>
                            <td className="px-4 py-3 text-right font-medium align-top">
                              {hasEntries ? (
                                <span className={summary.isActive ? 'text-green-600' : 'text-gray-900'}>
                                  {formatMinutesToHours(summary.totalWorkMinutes)} h
                                </span>
                              ) : isHolidayOnWorkDay ? (
                                <span className="text-red-600">Feiertag</span>
                              ) : hasAbsence ? (
                                <span style={{ color: summary.absence!.absenceType.color }}>
                                  {summary.absence!.absenceType.requiredHours === 0
                                    ? 'Frei'
                                    : `${formatHoursToTime(summary.absence!.absenceType.requiredHours)} h Pflicht`}
                                </span>
                              ) : (
                                <span className="text-gray-400">-</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>

                  {/* Quick Edit Popup */}
                  {(editingTimeEntry || showCreateEntry) && editingDate && (
                    <div
                      ref={popupRef}
                      className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-white rounded-xl shadow-2xl border border-gray-200 p-4 w-80 z-50"
                    >
                      <div className="flex items-center justify-between mb-4">
                        <h4 className="font-semibold">
                          {format(editingDate, 'dd.MM.yyyy - EEEE', { locale: de })}
                        </h4>
                        <button onClick={closeQuickEdit} className="p-1 hover:bg-gray-100 rounded">
                          <X size={16} />
                        </button>
                      </div>
                      <form onSubmit={(e) => handleTimeEntrySubmit(e, !editingTimeEntry)} className="space-y-3">
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="block text-xs font-medium text-gray-500 mb-1">
                              Einstempeln
                            </label>
                            <input
                              ref={clockInInputRef}
                              type="time"
                              value={timeEntryFormData.clockIn}
                              onChange={(e) => {
                                setTimeEntryFormData({ ...timeEntryFormData, clockIn: e.target.value });
                                // Auto-Tab zu Ausstempeln wenn Zeit vollständig (HH:MM = 5 Zeichen)
                                if (e.target.value.length === 5) {
                                  setTimeout(() => clockOutInputRef.current?.focus(), 10);
                                }
                              }}
                              className="input text-sm py-1.5"
                              required
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-gray-500 mb-1">
                              Ausstempeln
                            </label>
                            <input
                              ref={clockOutInputRef}
                              type="time"
                              value={timeEntryFormData.clockOut}
                              onChange={(e) =>
                                setTimeEntryFormData({ ...timeEntryFormData, clockOut: e.target.value })
                              }
                              className="input text-sm py-1.5"
                            />
                          </div>
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-500 mb-1">
                            Notiz (optional)
                          </label>
                          <input
                            type="text"
                            value={timeEntryFormData.note}
                            onChange={(e) =>
                              setTimeEntryFormData({ ...timeEntryFormData, note: e.target.value })
                            }
                            className="input text-sm py-1.5"
                            placeholder="z.B. Homeoffice, Außendienst..."
                          />
                        </div>
                        <p className="text-xs text-gray-400">
                          Pausen werden automatisch berechnet (Zeit zwischen Aus- und Einstempeln)
                        </p>

                        {/* Reklamations-Anzeige */}
                        {editingTimeEntry?.complaintMessage && (
                          <div className={`p-3 rounded-lg border ${editingTimeEntry.complaintResolvedAt ? 'bg-green-50 border-green-200' : 'bg-amber-50 border-amber-200'}`}>
                            <div className="flex items-start gap-2">
                              {editingTimeEntry.complaintResolvedAt ? (
                                <CheckCircle size={16} className="text-green-600 flex-shrink-0 mt-0.5" />
                              ) : (
                                <AlertTriangle size={16} className="text-amber-600 flex-shrink-0 mt-0.5" />
                              )}
                              <div className="flex-1 min-w-0">
                                <p className="text-xs font-medium text-gray-700">
                                  {editingTimeEntry.complaintResolvedAt ? 'Reklamation bearbeitet' : 'Offene Reklamation'}
                                </p>
                                <p className="text-sm text-gray-600 mt-1">{editingTimeEntry.complaintMessage}</p>
                                {editingTimeEntry.complaintResponse && (
                                  <p className="text-xs text-gray-500 mt-2 border-t border-gray-200 pt-2">
                                    <span className="font-medium">Antwort:</span> {editingTimeEntry.complaintResponse}
                                  </p>
                                )}
                                {!editingTimeEntry.complaintResolvedAt && (
                                  <button
                                    type="button"
                                    onClick={() => setShowComplaintModal(true)}
                                    className="text-xs text-amber-700 hover:text-amber-800 font-medium mt-2"
                                  >
                                    Als bearbeitet markieren →
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        )}

                        <div className="flex items-center justify-between pt-2">
                          {editingTimeEntry && (
                            <button
                              type="button"
                              onClick={handleTimeEntryDelete}
                              className="p-2 text-red-600 hover:bg-red-50 rounded-lg"
                              title="Löschen"
                            >
                              <Trash2 size={18} />
                            </button>
                          )}
                          <div className={`flex gap-2 ${editingTimeEntry ? '' : 'ml-auto'}`}>
                            <button
                              type="button"
                              onClick={closeQuickEdit}
                              className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"
                            >
                              Abbrechen
                            </button>
                            {/* Bei neuem Eintrag: Speichern & Weiter (Enter) + Fertig */}
                            {!editingTimeEntry ? (
                              <>
                                <button
                                  type="submit"
                                  className="px-3 py-1.5 text-sm bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300"
                                  disabled={!timeEntryFormData.clockOut}
                                  title={!timeEntryFormData.clockOut ? 'Ausstempeln-Zeit benötigt' : 'Enter = Speichern & Weiter'}
                                >
                                  Speichern & Weiter
                                </button>
                                <button
                                  type="button"
                                  onClick={(e) => handleTimeEntrySubmit(e, false)}
                                  className="px-3 py-1.5 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700"
                                >
                                  Fertig
                                </button>
                              </>
                            ) : (
                              <button
                                type="submit"
                                className="px-3 py-1.5 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700"
                              >
                                Speichern
                              </button>
                            )}
                          </div>
                        </div>
                      </form>
                    </div>
                  )}

                  {/* Reklamation bearbeiten Modal */}
                  {showComplaintModal && editingTimeEntry?.complaintMessage && (
                    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                      <div ref={complaintModalRef} className="bg-white rounded-xl shadow-2xl p-6 w-96 max-w-[90vw]">
                        <div className="flex items-center gap-3 mb-4">
                          <div className="p-2 bg-amber-100 rounded-lg">
                            <MessageSquare size={20} className="text-amber-600" />
                          </div>
                          <div>
                            <h3 className="font-semibold text-gray-900">Reklamation bearbeiten</h3>
                            <p className="text-sm text-gray-500">Mitarbeiter-Nachricht beantworten</p>
                          </div>
                        </div>

                        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4">
                          <p className="text-sm text-gray-700">{editingTimeEntry.complaintMessage}</p>
                        </div>

                        <div className="mb-4">
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            Antwort (optional)
                          </label>
                          <textarea
                            value={complaintResponse}
                            onChange={(e) => setComplaintResponse(e.target.value)}
                            className="input w-full"
                            rows={3}
                            placeholder="z.B. Pause wurde nachgetragen, Zeit korrigiert..."
                          />
                        </div>

                        <div className="flex justify-end gap-3">
                          <button
                            type="button"
                            onClick={() => {
                              setShowComplaintModal(false);
                              setComplaintResponse('');
                            }}
                            className="btn btn-secondary"
                          >
                            Abbrechen
                          </button>
                          <button
                            onClick={handleResolveComplaint}
                            disabled={isResolvingComplaint}
                            className="btn btn-primary flex items-center gap-2"
                          >
                            {isResolvingComplaint ? (
                              <>
                                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                Speichern...
                              </>
                            ) : (
                              <>
                                <CheckCircle size={16} />
                                Als bearbeitet markieren
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Absence Popup */}
                  {showAbsencePopup && editingDate && (
                    <div
                      ref={absencePopupRef}
                      className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-white rounded-xl shadow-2xl border border-gray-200 p-4 w-80 z-50"
                    >
                      <div className="flex items-center justify-between mb-4">
                        <div>
                          <h4 className="font-semibold flex items-center gap-2">
                            <Briefcase size={18} />
                            {selectedDates.length > 1 ? (
                              <>
                                {format(selectedDates[0], 'dd.MM.', { locale: de })} - {format(selectedDates[selectedDates.length - 1], 'dd.MM.yyyy', { locale: de })}
                              </>
                            ) : (
                              format(editingDate, 'dd.MM.yyyy', { locale: de })
                            )}
                          </h4>
                          {selectedDates.length > 1 && (
                            <p className="text-sm text-gray-500 mt-1">
                              {selectedDates.length} Tage ausgewählt
                            </p>
                          )}
                        </div>
                        <button onClick={closeAbsencePopup} className="p-1 hover:bg-gray-100 rounded">
                          <X size={16} />
                        </button>
                      </div>
                      <form onSubmit={handleAbsenceSubmit} className="space-y-3">
                        <div>
                          <label className="block text-xs font-medium text-gray-500 mb-1">
                            Abwesenheitstyp
                          </label>
                          <select
                            value={absenceFormData.absenceTypeId}
                            onChange={(e) =>
                              setAbsenceFormData({ ...absenceFormData, absenceTypeId: e.target.value })
                            }
                            className="input text-sm py-1.5"
                            required
                          >
                            <option value="">Bitte wählen...</option>
                            {absenceTypes?.map((type) => (
                              <option key={type.id} value={type.id}>
                                {type.name} ({type.requiredHours === 0 ? 'Frei' : `${formatHoursToTime(type.requiredHours)}h Pflicht`})
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-500 mb-1">
                            Notiz (optional)
                          </label>
                          <input
                            type="text"
                            value={absenceFormData.note}
                            onChange={(e) =>
                              setAbsenceFormData({ ...absenceFormData, note: e.target.value })
                            }
                            className="input text-sm py-1.5"
                            placeholder="z.B. Berufsschule in München..."
                          />
                        </div>
                        <div className="flex items-center justify-between pt-2">
                          {editingAbsence && (
                            <button
                              type="button"
                              onClick={handleAbsenceDelete}
                              className="p-2 text-red-600 hover:bg-red-50 rounded-lg"
                              title="Löschen"
                            >
                              <Trash2 size={18} />
                            </button>
                          )}
                          <div className={`flex gap-2 ${editingAbsence ? '' : 'ml-auto'}`}>
                            <button
                              type="button"
                              onClick={closeAbsencePopup}
                              className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"
                            >
                              Abbrechen
                            </button>
                            <button
                              type="submit"
                              className="px-3 py-1.5 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700"
                            >
                              Speichern
                            </button>
                          </div>
                        </div>
                      </form>
                    </div>
                  )}

                  {/* Pause Popup */}
                  {showPausePopup && pauseDate && (
                    <div
                      ref={pausePopupRef}
                      className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-white rounded-xl shadow-2xl border border-gray-200 p-4 w-80 z-50"
                    >
                      <div className="flex items-center justify-between mb-4">
                        <h4 className="font-semibold flex items-center gap-2">
                          <Clock size={18} className="text-orange-500" />
                          Pause einfügen
                        </h4>
                        <button onClick={() => setShowPausePopup(false)} className="p-1 hover:bg-gray-100 rounded">
                          <X size={16} />
                        </button>
                      </div>
                      <p className="text-sm text-gray-500 mb-3">
                        {format(pauseDate, 'EEEE, dd. MMMM yyyy', { locale: de })}
                      </p>
                      <div className="space-y-3">
                        <div>
                          <label className="block text-xs font-medium text-gray-500 mb-1">Pause von</label>
                          <input
                            type="time"
                            value={pauseStart}
                            onChange={(e) => setPauseStart(e.target.value)}
                            className="input text-sm py-1.5"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-500 mb-1">Pause bis</label>
                          <input
                            type="time"
                            value={pauseEnd}
                            onChange={(e) => setPauseEnd(e.target.value)}
                            className="input text-sm py-1.5"
                          />
                        </div>
                        <p className="text-xs text-gray-400">
                          Der Zeiteintrag wird aufgeteilt: Ausstempeln um {pauseStart}, Einstempeln um {pauseEnd}.
                        </p>
                        <div className="flex justify-end gap-2 pt-2">
                          <button
                            onClick={() => setShowPausePopup(false)}
                            className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"
                          >
                            Abbrechen
                          </button>
                          <button
                            onClick={handleInsertPause}
                            className="px-3 py-1.5 text-sm bg-orange-500 text-white rounded-lg hover:bg-orange-600"
                          >
                            Pause einfügen
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
            </div>
        </div>
      )}

      {/* Auswärtsstempelung Detail-Popup (Admin) */}
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
              {pwaDetailEntry.clockInViaPwa && (
                <div className="p-3 bg-green-50 rounded-lg">
                  <p className="text-green-600 font-semibold text-sm mb-2">Eingestempelt um {format(new Date(pwaDetailEntry.clockIn), 'HH:mm')} Uhr</p>
                  <div className="space-y-1 text-sm">
                    <p className="text-gray-600"><span className="text-gray-500">Grund:</span> <span className="font-medium">{pwaDetailEntry.pwaClockInReasonText || 'Nicht angegeben'}</span></p>
                    {pwaDetailEntry.clockInLatitude && pwaDetailEntry.clockInLongitude && (
                      <a href={`https://www.openstreetmap.org/?mlat=${pwaDetailEntry.clockInLatitude}&mlon=${pwaDetailEntry.clockInLongitude}#map=17/${pwaDetailEntry.clockInLatitude}/${pwaDetailEntry.clockInLongitude}`}
                        target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-blue-600 hover:underline">
                        <MapPin size={12} /> Standort auf Karte anzeigen
                      </a>
                    )}
                  </div>
                </div>
              )}
              {pwaDetailEntry.clockOutViaPwa && pwaDetailEntry.clockOut && (
                <div className="p-3 bg-red-50 rounded-lg">
                  <p className="text-red-600 font-semibold text-sm mb-2">Ausgestempelt um {format(new Date(pwaDetailEntry.clockOut), 'HH:mm')} Uhr</p>
                  <div className="space-y-1 text-sm">
                    <p className="text-gray-600"><span className="text-gray-500">Grund:</span> <span className="font-medium">{pwaDetailEntry.pwaClockOutReasonText || 'Nicht angegeben'}</span></p>
                    {pwaDetailEntry.clockOutLatitude && pwaDetailEntry.clockOutLongitude && (
                      <a href={`https://www.openstreetmap.org/?mlat=${pwaDetailEntry.clockOutLatitude}&mlon=${pwaDetailEntry.clockOutLongitude}#map=17/${pwaDetailEntry.clockOutLatitude}/${pwaDetailEntry.clockOutLongitude}`}
                        target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-blue-600 hover:underline">
                        <MapPin size={12} /> Standort auf Karte anzeigen
                      </a>
                    )}
                  </div>
                </div>
              )}
              {pwaDetailEntry.note && (
                <div className="p-3 bg-gray-50 rounded-lg text-sm text-gray-600">
                  <span className="text-gray-500">Notiz:</span> {pwaDetailEntry.note}
                </div>
              )}
            </div>
            <div className="p-4 border-t flex justify-end">
              <button onClick={() => setPwaDetailEntry(null)} className="px-4 py-2 border rounded-lg hover:bg-gray-50 text-sm">Schließen</button>
            </div>
          </div>
        </div>
      )}

      {/* Documents Modal */}
      {showDocumentsModal && selectedEmployeeForDocs && (() => {
        const MONTHS = ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'];
        const formatFileSize = (bytes: number) => bytes < 1024*1024 ? `${(bytes/1024).toFixed(1)} KB` : `${(bytes/(1024*1024)).toFixed(1)} MB`;
        return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setShowDocumentsModal(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="p-6 border-b border-gray-100 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold flex items-center gap-2">
                  <FolderOpen size={20} />
                  Dokumente
                </h2>
                <p className="text-sm text-gray-500">{selectedEmployeeForDocs.firstName} {selectedEmployeeForDocs.lastName}</p>
              </div>
              <button onClick={() => setShowDocumentsModal(false)} className="p-2 hover:bg-gray-100 rounded-lg"><X size={20} /></button>
            </div>
            <div className="overflow-y-auto flex-1 p-6 space-y-6">
              {/* Upload Section */}
              <div className="p-4 bg-gray-50 rounded-lg space-y-3">
                <h3 className="text-sm font-semibold text-gray-700">Dokument hochladen</h3>
                <DocumentTypeQuery>
                  {(documentTypes: any[]) => (
                    <>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="label text-xs">Dokumenttyp *</label>
                          <select value={docUploadForm.documentTypeId} onChange={(e) => setDocUploadForm({...docUploadForm, documentTypeId: e.target.value})} className="input py-1.5 text-sm">
                            <option value="">Bitte wählen...</option>
                            {documentTypes?.map((dt: any) => (
                              <option key={dt.id} value={dt.id}>{dt.name}</option>
                            ))}
                          </select>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="label text-xs">Jahr</label>
                            <select value={docUploadForm.year} onChange={(e) => setDocUploadForm({...docUploadForm, year: parseInt(e.target.value)})} className="input py-1.5 text-sm">
                              {[2023,2024,2025,2026,2027].map(y => <option key={y} value={y}>{y}</option>)}
                            </select>
                          </div>
                          <div>
                            <label className="label text-xs">Monat</label>
                            <select value={docUploadForm.month} onChange={(e) => setDocUploadForm({...docUploadForm, month: parseInt(e.target.value)})} className="input py-1.5 text-sm">
                              {MONTHS.map((m,i) => <option key={i} value={i+1}>{m}</option>)}
                            </select>
                          </div>
                        </div>
                      </div>
                      <div>
                        <label className="label text-xs">Notiz (optional)</label>
                        <input type="text" value={docUploadForm.note} onChange={(e) => setDocUploadForm({...docUploadForm, note: e.target.value})} className="input py-1.5 text-sm" placeholder="z.B. Korrektur" />
                      </div>
                      <label
                        className={`flex flex-col items-center justify-center w-full py-4 rounded-lg border-2 border-dashed cursor-pointer transition-colors ${
                          docDragging
                            ? 'border-primary-500 bg-primary-50'
                            : docUploadFile
                            ? 'border-green-400 bg-green-50'
                            : 'border-gray-300 hover:border-gray-400 hover:bg-gray-100'
                        }`}
                        onDragOver={(e) => { e.preventDefault(); setDocDragging(true); }}
                        onDragLeave={() => setDocDragging(false)}
                        onDrop={(e) => {
                          e.preventDefault();
                          setDocDragging(false);
                          const file = e.dataTransfer.files[0];
                          if (file) setDocUploadFile(file);
                        }}
                      >
                        <Upload size={20} className={docDragging ? 'text-primary-500' : docUploadFile ? 'text-green-600' : 'text-gray-400'} />
                        <p className="mt-1 text-sm text-gray-600">
                          {docUploading ? 'Wird hochgeladen...' : docUploadFile ? docUploadFile.name : docDragging ? 'Hier ablegen' : 'Datei hierhin ziehen oder klicken'}
                        </p>
                        <input type="file" className="hidden" onChange={(e) => setDocUploadFile(e.target.files?.[0] || null)} />
                      </label>
                      <div className="flex items-center gap-3">
                        {docUploadFile && (
                          <button onClick={() => setDocUploadFile(null)} className="text-sm text-gray-500 hover:text-gray-700">Datei entfernen</button>
                        )}
                        <button
                          onClick={async () => {
                            if (!docUploadFile || !docUploadForm.documentTypeId) {
                              toast.error('Bitte Datei und Dokumenttyp wählen');
                              return;
                            }
                            setDocUploading(true);
                            try {
                              await documentsApi.upload(selectedEmployeeForDocs.id, docUploadFile, {
                                documentTypeId: docUploadForm.documentTypeId,
                                year: docUploadForm.year,
                                month: docUploadForm.month,
                                note: docUploadForm.note || undefined,
                              });
                              toast.success('Dokument hochgeladen');
                              setDocUploadFile(null);
                              setDocUploadForm({...docUploadForm, note: ''});
                              queryClient.invalidateQueries({ queryKey: ['employee-documents', selectedEmployeeForDocs.id] });
                            } catch (err: any) {
                              toast.error(err.response?.data?.error || 'Fehler beim Hochladen');
                            } finally {
                              setDocUploading(false);
                            }
                          }}
                          disabled={!docUploadFile || !docUploadForm.documentTypeId || docUploading}
                          className="btn btn-primary text-sm ml-auto"
                        >
                          {docUploading ? 'Lädt hoch...' : 'Hochladen'}
                        </button>
                      </div>
                    </>
                  )}
                </DocumentTypeQuery>
              </div>

              {/* Document List */}
              <EmployeeDocumentList
                employeeId={selectedEmployeeForDocs.id}
                formatFileSize={formatFileSize}
                MONTHS={MONTHS}
                filterYear={docUploadForm.year}
                filterMonth={docUploadForm.month}
              />
            </div>
          </div>
        </div>
        );
      })()}

      {/* RFID Lookup Modal */}
      {showLookupModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => { if (!lookupScanning) { setShowLookupModal(false); } }}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="p-6 border-b border-gray-100 flex items-center justify-between">
              <h2 className="text-xl font-semibold flex items-center gap-2">
                <CreditCard size={20} />
                Karte abfragen
              </h2>
              <button
                onClick={() => { if (lookupScanning) stopLookupScan(); setShowLookupModal(false); }}
                className="p-2 hover:bg-gray-100 rounded-lg"
              >
                <X size={20} />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-sm text-gray-600">
                Scanne eine RFID-Karte am Terminal, um herauszufinden, welchem Mitarbeiter sie zugeordnet ist.
              </p>

              {/* Connection Status */}
              <div className="flex items-center gap-2 text-sm">
                <div className={`w-2 h-2 rounded-full ${lookupSocketConnected ? 'bg-green-500' : 'bg-red-500'}`} />
                <span className="text-gray-500">
                  {lookupSocketConnected ? 'Terminal verbunden' : 'Verbinde...'}
                </span>
              </div>

              {/* Scan Button */}
              <div className="flex gap-2">
                {!lookupScanning ? (
                  <button
                    onClick={startLookupScan}
                    disabled={!lookupSocketConnected}
                    className="btn btn-primary flex-1 flex items-center justify-center gap-2"
                  >
                    <Wifi size={18} />
                    Karte scannen
                  </button>
                ) : (
                  <button
                    onClick={stopLookupScan}
                    className="btn btn-secondary flex-1 flex items-center justify-center gap-2"
                  >
                    <Loader2 size={18} className="animate-spin" />
                    Warte auf Karte... ({lookupCountdown}s)
                  </button>
                )}
              </div>

              {/* Result */}
              {lookupResult && (
                <div className={`p-4 rounded-lg ${lookupResult.found ? 'bg-green-50 border border-green-200' : 'bg-yellow-50 border border-yellow-200'}`}>
                  {lookupResult.found ? (
                    <div className="flex items-center gap-3">
                      {lookupResult.employee.photoUrl ? (
                        <img src={lookupResult.employee.photoUrl} alt="" className="w-12 h-12 rounded-full object-cover" />
                      ) : (
                        <div className="w-12 h-12 rounded-full bg-green-200 flex items-center justify-center text-green-700 font-medium text-lg">
                          {lookupResult.employee.firstName[0]}{lookupResult.employee.lastName[0]}
                        </div>
                      )}
                      <div>
                        <p className="font-semibold text-gray-900">
                          {lookupResult.employee.firstName} {lookupResult.employee.lastName}
                        </p>
                        <p className="text-sm text-gray-500">#{lookupResult.employee.employeeNumber}</p>
                        <p className="text-xs text-gray-400 mt-1">RFID: {lookupResult.rfidCard}</p>
                        {!lookupResult.employee.isActive && (
                          <span className="text-xs text-red-600 font-medium">Inaktiv</span>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div>
                      <p className="font-medium text-yellow-800">Karte nicht zugeordnet</p>
                      <p className="text-sm text-yellow-600 mt-1">RFID: {lookupResult.rfidCard}</p>
                      <p className="text-sm text-yellow-600">Diese Karte ist keinem Mitarbeiter zugewiesen.</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
