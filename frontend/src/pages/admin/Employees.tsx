import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { employeesApi, timeEntriesApi, settingsApi, formatNumber } from '../../lib/api';
import toast from 'react-hot-toast';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, addMonths, subMonths } from 'date-fns';
import { de } from 'date-fns/locale';
import {
  Plus,
  Edit2,
  Trash2,
  QrCode,
  Search,
  X,
  Download,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Briefcase,
} from 'lucide-react';

interface Employee {
  id: string;
  employeeNumber: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  hourlyRate: number;
  weeklyHours: number;
  isActive: boolean;
  isAdmin: boolean;
  qrCode: string;
}

interface EmployeeFormData {
  employeeNumber: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  hourlyRate: number;
  weeklyHours: number;
  isAdmin: boolean;
  password: string;
}

const initialFormData: EmployeeFormData = {
  employeeNumber: '',
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  hourlyRate: 12.0,
  weeklyHours: 40,
  isAdmin: false,
  password: '',
};

interface TimeEntry {
  id: string;
  employeeId: string;
  clockIn: string;
  clockOut: string | null;
  breakMinutes: number;
  note: string | null;
  isManual: boolean;
  editedBy: string | null;
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

export default function AdminEmployees() {
  const [showModal, setShowModal] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [formData, setFormData] = useState<EmployeeFormData>(initialFormData);
  const [searchQuery, setSearchQuery] = useState('');
  const [showQrModal, setShowQrModal] = useState<string | null>(null);

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

  // Absences State
  const [absences, setAbsences] = useState<EmployeeAbsence[]>([]);
  const [showAbsencePopup, setShowAbsencePopup] = useState(false);
  const [editingAbsence, setEditingAbsence] = useState<EmployeeAbsence | null>(null);
  const [absenceFormData, setAbsenceFormData] = useState({
    absenceTypeId: '',
    note: '',
  });
  const absencePopupRef = useRef<HTMLDivElement>(null);

  // Multi-Select State für Abwesenheiten (Drag-Auswahl)
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectionStart, setSelectionStart] = useState<Date | null>(null);
  const [selectionEnd, setSelectionEnd] = useState<Date | null>(null);
  const [selectedDates, setSelectedDates] = useState<Date[]>([]);

  const queryClient = useQueryClient();

  const { data: employees, isLoading } = useQuery({
    queryKey: ['employees'],
    queryFn: () => employeesApi.getAll().then((r) => r.data as Employee[]),
  });

  const { data: absenceTypes } = useQuery({
    queryKey: ['absence-types'],
    queryFn: () => settingsApi.getAbsenceTypes().then((r) => r.data as AbsenceType[]),
  });

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

  const openCreateModal = () => {
    setEditingEmployee(null);
    setFormData(initialFormData);
    setShowModal(true);
  };

  const openEditModal = (employee: Employee) => {
    setEditingEmployee(employee);
    setFormData({
      employeeNumber: employee.employeeNumber,
      firstName: employee.firstName,
      lastName: employee.lastName,
      email: employee.email || '',
      phone: employee.phone || '',
      hourlyRate: employee.hourlyRate,
      weeklyHours: employee.weeklyHours,
      isAdmin: employee.isAdmin,
      password: '',
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
    if (editingEmployee) {
      const updateData: any = { ...formData };
      if (!updateData.password) delete updateData.password;
      updateMutation.mutate({ id: editingEmployee.id, data: updateData });
    } else {
      createMutation.mutate(formData);
    }
  };

  const handleDelete = (employee: Employee) => {
    if (confirm(`Möchten Sie ${employee.firstName} ${employee.lastName} wirklich deaktivieren?`)) {
      deleteMutation.mutate(employee.id);
    }
  };

  const generateQrCodeUrl = (qrCode: string) => {
    return `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qrCode)}`;
  };

  // Time Entries Functions
  const loadTimeEntries = async (employeeId: string, month: Date) => {
    setLoadingTimeEntries(true);
    try {
      const from = startOfMonth(month).toISOString();
      const to = endOfMonth(month).toISOString();

      // Load both time entries and absences in parallel
      const [entriesResponse, absencesResponse] = await Promise.all([
        timeEntriesApi.getAll({ employeeId, from, to }),
        settingsApi.getAbsences({ employeeId, from, to }),
      ]);

      setTimeEntries(entriesResponse.data as TimeEntry[]);
      setAbsences(absencesResponse.data as EmployeeAbsence[]);
    } catch (error) {
      console.error('Error loading time entries:', error);
      toast.error('Fehler beim Laden der Zeiteinträge');
    } finally {
      setLoadingTimeEntries(false);
    }
  };

  const openTimeEntriesModal = (employee: Employee) => {
    setSelectedEmployeeForTime(employee);
    setSelectedMonth(new Date());
    setShowTimeEntriesModal(true);
    loadTimeEntries(employee.id, new Date());
  };

  const closeTimeEntriesModal = () => {
    setShowTimeEntriesModal(false);
    setSelectedEmployeeForTime(null);
    setTimeEntries([]);
    setAbsences([]);
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

  // Berechnet Arbeitsstunden und automatische Pausen für einen Tag
  // Nur volle Minuten werden gezählt (keine Sekunden)
  const calculateDaySummary = (date: Date): DaySummary => {
    const entries = getEntriesForDate(date);
    const absence = getAbsenceForDate(date);
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
      setTimeEntryFormData({
        clockIn: '08:00',
        clockOut: '17:00',
        breakMinutes: 0,
        note: '',
      });
    }
  };

  const closeQuickEdit = () => {
    setEditingTimeEntry(null);
    setEditingDate(null);
    setShowCreateEntry(false);
  };

  const handleTimeEntrySubmit = async (e: React.FormEvent) => {
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
        await timeEntriesApi.update(editingTimeEntry.id, {
          clockIn: clockInDate.toISOString(),
          clockOut: clockOutDate?.toISOString() || null,
          breakMinutes: timeEntryFormData.breakMinutes,
          note: timeEntryFormData.note || null,
        });
        toast.success('Zeiteintrag aktualisiert');
      } else {
        // Create new entry
        await timeEntriesApi.createManual({
          employeeId: selectedEmployeeForTime.id,
          clockIn: clockInDate.toISOString(),
          clockOut: clockOutDate?.toISOString() || null,
          breakMinutes: timeEntryFormData.breakMinutes,
          note: timeEntryFormData.note || null,
        });
        toast.success('Zeiteintrag erstellt');
      }

      closeQuickEdit();
      loadTimeEntries(selectedEmployeeForTime.id, selectedMonth);
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Fehler beim Speichern');
    }
  };

  const handleTimeEntryDelete = async () => {
    if (!editingTimeEntry || !selectedEmployeeForTime) return;

    if (confirm('Zeiteintrag wirklich löschen?')) {
      try {
        await timeEntriesApi.delete(editingTimeEntry.id);
        toast.success('Zeiteintrag gelöscht');
        closeQuickEdit();
        loadTimeEntries(selectedEmployeeForTime.id, selectedMonth);
      } catch (error: any) {
        toast.error(error.response?.data?.error || 'Fehler beim Löschen');
      }
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
    setEditingDate(null);
    setSelectedDates([]);
    // Reset multi-select state
    setIsSelecting(false);
    setSelectionStart(null);
    setSelectionEnd(null);
  };

  // Multi-Select: Berechnet alle Tage zwischen Start und Ende
  const getSelectedDateRange = (): Date[] => {
    if (!selectionStart || !selectionEnd) return [];

    const start = selectionStart < selectionEnd ? selectionStart : selectionEnd;
    const end = selectionStart < selectionEnd ? selectionEnd : selectionStart;

    return eachDayOfInterval({ start, end });
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

    // Prüfen ob der Tag bereits eine Abwesenheit hat
    const absence = getAbsenceForDate(date);
    if (absence) {
      // Bei Klick auf existierende Abwesenheit -> direkt bearbeiten
      openAbsencePopup(date, absence);
      return;
    }

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

    // Filtere Tage raus, die bereits eine Abwesenheit haben
    const availableDates = dates.filter((d) => !getAbsenceForDate(d));

    if (availableDates.length === 0) {
      toast.error('Alle ausgewählten Tage haben bereits eine Abwesenheit');
      setIsSelecting(false);
      setSelectionStart(null);
      setSelectionEnd(null);
      return;
    }

    if (availableDates.length === 1) {
      // Nur ein Tag -> normale Abwesenheit erstellen
      openAbsencePopup(availableDates[0]);
    } else {
      // Mehrere Tage -> Multi-Popup öffnen
      openMultiAbsencePopup(availableDates);
    }

    setIsSelecting(false);
  };

  const handleAbsenceSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEmployeeForTime || !absenceFormData.absenceTypeId) return;

    try {
      if (editingAbsence) {
        // Update existing absence (nur einzelner Tag)
        await settingsApi.updateAbsence(editingAbsence.id, {
          absenceTypeId: absenceFormData.absenceTypeId,
          note: absenceFormData.note || null,
        });
        toast.success('Abwesenheit aktualisiert');
      } else if (selectedDates.length > 0) {
        // Create absences for all selected dates
        let successCount = 0;
        let errorCount = 0;

        for (const date of selectedDates) {
          try {
            const dateStr = format(date, 'yyyy-MM-dd');
            await settingsApi.createAbsence({
              employeeId: selectedEmployeeForTime.id,
              absenceTypeId: absenceFormData.absenceTypeId,
              date: new Date(dateStr).toISOString(),
              note: absenceFormData.note || null,
            });
            successCount++;
          } catch {
            errorCount++;
          }
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
      loadTimeEntries(selectedEmployeeForTime.id, selectedMonth);
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Fehler beim Speichern');
    }
  };

  const handleAbsenceDelete = async () => {
    if (!editingAbsence || !selectedEmployeeForTime) return;

    if (confirm('Abwesenheit wirklich löschen?')) {
      try {
        await settingsApi.deleteAbsence(editingAbsence.id);
        toast.success('Abwesenheit gelöscht');
        closeAbsencePopup();
        loadTimeEntries(selectedEmployeeForTime.id, selectedMonth);
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
        <button onClick={openCreateModal} className="btn btn-primary flex items-center gap-2">
          <Plus size={20} />
          Neuer Mitarbeiter
        </button>
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
                  Stundenlohn
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
                      <div>
                        <p className="font-medium text-gray-900">
                          {employee.firstName} {employee.lastName}
                        </p>
                        <p className="text-sm text-gray-500">#{employee.employeeNumber}</p>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <p className="text-sm text-gray-900">{employee.email || '-'}</p>
                      <p className="text-sm text-gray-500">{employee.phone || '-'}</p>
                    </td>
                    <td className="px-6 py-4">
                      <p className="text-gray-900">{formatNumber(employee.hourlyRate)} EUR</p>
                      <p className="text-sm text-gray-500">{employee.weeklyHours}h/Woche</p>
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
                        <button
                          onClick={() => setShowQrModal(employee.qrCode)}
                          className="p-2 text-gray-500 hover:text-primary-600 hover:bg-primary-50 rounded-lg"
                          title="QR-Code"
                        >
                          <QrCode size={18} />
                        </button>
                        <button
                          onClick={() => openTimeEntriesModal(employee)}
                          className="p-2 text-gray-500 hover:text-primary-600 hover:bg-primary-50 rounded-lg"
                          title="Zeiteinträge"
                        >
                          <Calendar size={18} />
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
                    disabled={!!editingEmployee}
                  />
                </div>
                <div>
                  <label className="label">Stundenlohn (EUR)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={formData.hourlyRate}
                    onChange={(e) => setFormData({ ...formData, hourlyRate: parseFloat(e.target.value) })}
                    className="input"
                    required
                  />
                </div>
              </div>
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

      {/* QR Code Modal */}
      {showQrModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-sm w-full text-center">
            <h3 className="text-lg font-semibold mb-4">QR-Code für Zeiterfassung</h3>
            <img
              src={generateQrCodeUrl(showQrModal)}
              alt="QR-Code"
              className="mx-auto mb-4"
            />
            <p className="text-sm text-gray-500 mb-4 font-mono">{showQrModal}</p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowQrModal(null)}
                className="btn btn-secondary flex-1"
              >
                Schließen
              </button>
              <a
                href={generateQrCodeUrl(showQrModal)}
                download={`qrcode-${showQrModal}.png`}
                className="btn btn-primary flex-1 flex items-center justify-center gap-2"
              >
                <Download size={18} />
                Download
              </a>
            </div>
          </div>
        </div>
      )}

      {/* Time Entries Modal */}
      {showTimeEntriesModal && selectedEmployeeForTime && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
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

            {/* Month Navigation & Stats */}
            <div className="p-4 border-b border-gray-100 shrink-0">
              <div className="flex items-center justify-between">
                <button
                  onClick={() => handleMonthChange('prev')}
                  className="p-2 hover:bg-gray-100 rounded-lg"
                >
                  <ChevronLeft size={20} />
                </button>
                <h3 className="text-lg font-semibold">
                  {format(selectedMonth, 'MMMM yyyy', { locale: de })}
                </h3>
                <button
                  onClick={() => handleMonthChange('next')}
                  className="p-2 hover:bg-gray-100 rounded-lg"
                >
                  <ChevronRight size={20} />
                </button>
              </div>
              {(() => {
                const totals = calculateTotalMinutes();
                return (
                  <div className="mt-3 bg-primary-50 rounded-lg p-3 flex justify-center gap-8">
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

            {/* Calendar Table */}
            <div className="flex-1 overflow-y-auto p-4">
              {loadingTimeEntries ? (
                <div className="text-center text-gray-500 py-8">Laden...</div>
              ) : (
                <div className="relative">
                  <table className="w-full">
                    <thead className="bg-gray-50 sticky top-0">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                          Datum
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                          Tag
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                          Zeiten
                        </th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                          Stunden
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {eachDayOfInterval({
                        start: startOfMonth(selectedMonth),
                        end: endOfMonth(selectedMonth),
                      }).map((date) => {
                        const summary = calculateDaySummary(date);
                        const isWeekend = date.getDay() === 0 || date.getDay() === 6;
                        const isEditing = editingDate && isSameDay(date, editingDate);
                        const hasEntries = summary.entries.length > 0;
                        const hasAbsence = !!summary.absence;
                        const inSelection = isDateInSelection(date);

                        return (
                          <tr
                            key={date.toISOString()}
                            onMouseDown={(e) => {
                              // Nur starten wenn nicht auf einen Link/Button geklickt wird
                              if ((e.target as HTMLElement).closest('.entry-item')) return;
                              if ((e.target as HTMLElement).closest('.absence-item')) return;
                              if ((e.target as HTMLElement).closest('button')) return;
                              handleSelectionStart(date, e);
                            }}
                            onMouseEnter={() => handleSelectionMove(date)}
                            onClick={(e) => {
                              // Wenn auf einen spezifischen Eintrag geklickt wird, nicht die ganze Zeile
                              if ((e.target as HTMLElement).closest('.entry-item')) return;
                              if ((e.target as HTMLElement).closest('.absence-item')) return;
                              if ((e.target as HTMLElement).closest('button')) return;
                              // Nur bei Einzelklick (nicht bei Drag) neuen Eintrag erstellen
                              if (isSelecting) return;
                              if (!hasEntries && !hasAbsence) {
                                handleDayClick(date);
                              }
                            }}
                            className={`transition-colors select-none ${
                              isWeekend ? 'bg-gray-50 text-gray-400' : ''
                            } ${isEditing ? 'bg-primary-100' : ''} ${
                              inSelection ? 'bg-blue-100' : ''
                            } ${
                              hasAbsence ? '' : 'cursor-pointer hover:bg-primary-50'
                            }`}
                            style={hasAbsence && !inSelection ? { backgroundColor: summary.absence!.absenceType.color + '10' } : {}}
                          >
                            <td className="px-4 py-3 font-medium align-top">
                              {format(date, 'dd.MM.yyyy')}
                            </td>
                            <td className="px-4 py-3 align-top">
                              {format(date, 'EEEE', { locale: de })}
                            </td>
                            <td className="px-4 py-3">
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
                                      className="entry-item flex items-center gap-2 cursor-pointer hover:bg-gray-100 rounded px-1 -mx-1"
                                      onClick={() => handleDayClick(date, entry)}
                                    >
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
                                    className="text-xs text-primary-600 hover:text-primary-700 mt-1"
                                  >
                                    + Eintrag hinzufügen
                                  </button>
                                </div>
                              ) : !hasAbsence ? (
                                <span className="text-gray-400">-</span>
                              ) : null}

                              {/* Button zum Hinzufügen einer Abwesenheit wenn keine vorhanden */}
                              {!hasAbsence && absenceTypes && absenceTypes.length > 0 && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    openAbsencePopup(date);
                                  }}
                                  className="text-xs text-gray-500 hover:text-gray-700 mt-1 flex items-center gap-1"
                                >
                                  <Briefcase size={12} />
                                  Abwesenheit
                                </button>
                              )}
                            </td>
                            <td className="px-4 py-3 text-right font-medium align-top">
                              {hasEntries ? (
                                <span className={summary.isActive ? 'text-green-600' : 'text-gray-900'}>
                                  {formatMinutesToHours(summary.totalWorkMinutes)} h
                                </span>
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
                      <form onSubmit={handleTimeEntrySubmit} className="space-y-3">
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="block text-xs font-medium text-gray-500 mb-1">
                              Einstempeln
                            </label>
                            <input
                              type="time"
                              value={timeEntryFormData.clockIn}
                              onChange={(e) =>
                                setTimeEntryFormData({ ...timeEntryFormData, clockIn: e.target.value })
                              }
                              className="input text-sm py-1.5"
                              required
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-gray-500 mb-1">
                              Ausstempeln
                            </label>
                            <input
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
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
