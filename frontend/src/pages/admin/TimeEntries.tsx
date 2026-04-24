import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { employeesApi, timeEntriesApi, settingsApi } from '../../lib/api';
import { photoSrc } from '../../lib/photoUrl';
import { useConfirm } from '../../components/ConfirmDialog';
import toast from 'react-hot-toast';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, addMonths, subMonths } from 'date-fns';
import { de } from 'date-fns/locale';
import {
  ChevronLeft, ChevronRight, X, Clock, Plus, Briefcase, Edit2, Search,
  AlertTriangle, CheckCircle, MapPin, Calendar, User, Trash2,
} from 'lucide-react';

interface Employee {
  id: string;
  employeeNumber: string;
  firstName: string;
  lastName: string;
  photoUrl: string | null;
  isActive: boolean;
  workDays: string;
  vacationDaysPerYear: number;
  startDate: string | null;
  endDate: string | null;
  initialSickDays?: number;
  initialVacationDaysUsed?: number;
  initialBalanceYear?: number;
}

interface TimeEntry {
  id: string;
  clockIn: string;
  clockOut: string | null;
  breakMinutes: number;
  note: string | null;
  clockInViaPwa?: boolean;
  clockOutViaPwa?: boolean;
  complaintMessage?: string | null;
  complaintAt?: string | null;
  complaintResolvedAt?: string | null;
  complaintResponse?: string | null;
  complaintOriginalClockIn?: string | null;
  complaintOriginalClockOut?: string | null;
  complaintOriginalBreakMinutes?: number | null;
}

interface Absence {
  id: string;
  date: string;
  absenceTypeId: string;
  absenceType: { name: string; shortName: string; color: string; requiredHours: number };
  note?: string;
}

interface Holiday { id: string; date: string; name: string; }

export default function AdminTimeEntries() {
  const confirm = useConfirm();
  const [searchParams] = useSearchParams();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
  const [selectedMonth, setSelectedMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [timeEntries, setTimeEntries] = useState<TimeEntry[]>([]);
  const [absences, setAbsences] = useState<Absence[]>([]);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [yearAbsences, setYearAbsences] = useState<Absence[]>([]);
  const [vacationDetails, setVacationDetails] = useState<any>(null);
  const [vacationAdjustments, setVacationAdjustments] = useState<any[]>([]);
  const [showAdjPopup, setShowAdjPopup] = useState(false);
  const [adjForm, setAdjForm] = useState({ days: '', reason: '' });
  const [loading, setLoading] = useState(false);

  const [editingEntry, setEditingEntry] = useState<TimeEntry | null>(null);
  const [showCreateEntry, setShowCreateEntry] = useState(false);
  const [formData, setFormData] = useState({ clockIn: '', clockOut: '', note: '' });
  const popupRef = useRef<HTMLDivElement>(null);

  const [showPausePopup, setShowPausePopup] = useState(false);
  const [pauseEntryId, setPauseEntryId] = useState<string | null>(null);
  const [pauseStart, setPauseStart] = useState('12:00');
  const [pauseEnd, setPauseEnd] = useState('12:30');

  const [showAbsencePopup, setShowAbsencePopup] = useState(false);
  const [absenceFormData, setAbsenceFormData] = useState({ absenceTypeId: '', note: '' });
  const [editingAbsence, setEditingAbsence] = useState<Absence | null>(null);
  const [selectedDates, setSelectedDates] = useState<Date[]>([]);

  const [isSelecting, setIsSelecting] = useState(false);
  const [selectionStart, setSelectionStart] = useState<Date | null>(null);
  const [selectionEnd, setSelectionEnd] = useState<Date | null>(null);

  const { data: employees } = useQuery({ queryKey: ['employees'], queryFn: () => employeesApi.getAll().then(r => r.data as Employee[]) });
  const { data: absenceTypes } = useQuery({ queryKey: ['absenceTypesAll'], queryFn: () => settingsApi.getAllAbsenceTypes().then(r => r.data) });

  // Auto-select MA from URL parameter
  useEffect(() => {
    const empId = searchParams.get('employee');
    if (empId && employees && !selectedEmployee) {
      const emp = employees.find((e: Employee) => e.id === empId);
      if (emp) selectEmployee(emp);
    }
  }, [employees, searchParams]);

  const filtered = (employees || []).filter((e: any) => {
    if (!e.isActive) return false;
    if (e.isAdmin) return false;
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return e.firstName.toLowerCase().includes(q) || e.lastName.toLowerCase().includes(q) || e.employeeNumber.includes(q);
  });

  const loadData = async (empId: string, month: Date) => {
    setLoading(true);
    try {
      const from = format(startOfMonth(month), 'yyyy-MM-dd');
      const to = format(endOfMonth(month), 'yyyy-MM-dd');
      const yearFrom = `${month.getFullYear()}-01-01`;
      const yearTo = `${month.getFullYear()}-12-31`;
      const [eRes, aRes, hRes, yaRes, vdRes, adjRes] = await Promise.all([
        timeEntriesApi.getAll({ employeeId: empId, from, to }),
        settingsApi.getAbsences({ employeeId: empId, from, to }),
        settingsApi.getHolidays(month.getFullYear()),
        settingsApi.getAbsences({ employeeId: empId, from: yearFrom, to: yearTo }),
        timeEntriesApi.getVacationDetails(empId, month.getFullYear()),
        timeEntriesApi.getVacationAdjustments(empId, month.getFullYear()),
      ]);
      setTimeEntries(eRes.data);
      setAbsences(aRes.data);
      setHolidays(hRes.data);
      setYearAbsences(yaRes.data);
      setVacationDetails(vdRes.data);
      setVacationAdjustments(adjRes.data);
    } catch {} finally { setLoading(false); }
  };

  const selectEmployee = (emp: Employee) => {
    setSelectedEmployee(emp);
    setSelectedDate(new Date());
    loadData(emp.id, selectedMonth);
  };

  const changeMonth = (dir: 'prev' | 'next') => {
    const m = dir === 'prev' ? subMonths(selectedMonth, 1) : addMonths(selectedMonth, 1);
    setSelectedMonth(m);
    if (selectedEmployee) loadData(selectedEmployee.id, m);
  };

  const getEntries = (d: Date) => timeEntries.filter(e => isSameDay(new Date(e.clockIn), d)).sort((a, b) => new Date(a.clockIn).getTime() - new Date(b.clockIn).getTime());
  const getAbsence = (d: Date) => absences.find(a => isSameDay(new Date(a.date), d));
  const getHoliday = (d: Date) => holidays.find(h => isSameDay(new Date(h.date), d));
  const calcMin = (d: Date) => getEntries(d).reduce((s, e) => e.clockOut ? s + Math.floor((new Date(e.clockOut).getTime() - new Date(e.clockIn).getTime()) / 60000) : s, 0);
  const fmtMin = (m: number) => `${Math.floor(m / 60)}:${(m % 60).toString().padStart(2, '0')}`;
  const workDays = selectedEmployee?.workDays?.split(',').map(d => parseInt(d.trim())).filter(d => !isNaN(d)) || [1,2,3,4,5];
  const totalMin = timeEntries.reduce((s, e) => e.clockOut ? s + Math.floor((new Date(e.clockOut).getTime() - new Date(e.clockIn).getTime()) / 60000) : s, 0);

  // Soll-Stunden vom Backend holen (zentrale Berechnung)
  const { data: targetData } = useQuery({
    queryKey: ['targetHours', selectedEmployee?.id, selectedMonth.getFullYear(), selectedMonth.getMonth()],
    queryFn: () =>
      timeEntriesApi
        .getTargetHours(selectedEmployee!.id, selectedMonth.getFullYear(), selectedMonth.getMonth() + 1)
        .then((r) => r.data),
    enabled: !!selectedEmployee,
  });
  const targetMin = Math.round((targetData?.monthlyTarget ?? 0) * 60);
  const MONTHS = ['Jan','Feb','Mär','Apr','Mai','Jun','Jul','Aug','Sep','Okt','Nov','Dez'];

  const openEdit = (d: Date, entry?: TimeEntry) => {
    setSelectedDate(d);
    if (entry) { setEditingEntry(entry); setShowCreateEntry(false); setFormData({ clockIn: format(new Date(entry.clockIn), 'HH:mm'), clockOut: entry.clockOut ? format(new Date(entry.clockOut), 'HH:mm') : '', note: entry.note || '' }); }
    else { setEditingEntry(null); setShowCreateEntry(true); const last = getEntries(d).at(-1); setFormData({ clockIn: last?.clockOut ? format(new Date(last.clockOut), 'HH:mm') : '08:00', clockOut: '', note: '' }); }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEmployee) return;
    const ds = format(selectedDate, 'yyyy-MM-dd');
    try {
      if (editingEntry) { await timeEntriesApi.update(editingEntry.id, { clockIn: `${ds}T${formData.clockIn}:00`, clockOut: formData.clockOut ? `${ds}T${formData.clockOut}:00` : null, note: formData.note || null }); toast.success('Gespeichert'); }
      else { await timeEntriesApi.createManual({ employeeId: selectedEmployee.id, clockIn: `${ds}T${formData.clockIn}:00`, clockOut: formData.clockOut ? `${ds}T${formData.clockOut}:00` : null, note: formData.note || null }); toast.success('Erstellt'); }
      setEditingEntry(null); setShowCreateEntry(false); await loadData(selectedEmployee.id, selectedMonth);
    } catch (err: any) { toast.error(err.response?.data?.error || 'Fehler'); }
  };

  const handleDelete = async () => {
    if (!editingEntry || !selectedEmployee) return;
    const ok = await confirm({
      title: 'Zeiteintrag löschen?',
      variant: 'danger',
      confirmText: 'Löschen',
      message: 'Dieser Zeiteintrag wird unwiderruflich gelöscht.',
    });
    if (!ok) return;
    try { await timeEntriesApi.delete(editingEntry.id); toast.success('Gelöscht'); setEditingEntry(null); await loadData(selectedEmployee.id, selectedMonth); }
    catch (err: any) { toast.error(err.response?.data?.error || 'Fehler'); }
  };

  const handlePause = async () => {
    if (!pauseEntryId || !selectedEmployee) return;
    try { await timeEntriesApi.insertPause(pauseEntryId, { pauseStart: `${format(selectedDate, 'yyyy-MM-dd')}T${pauseStart}:00`, pauseEnd: `${format(selectedDate, 'yyyy-MM-dd')}T${pauseEnd}:00` }); toast.success('Pause eingefügt'); setShowPausePopup(false); await loadData(selectedEmployee.id, selectedMonth); }
    catch (err: any) { toast.error(err.response?.data?.error || 'Fehler'); }
  };

  const handleAbsenceDelete = async () => {
    if (!editingAbsence || !selectedEmployee) return;
    try { await settingsApi.deleteAbsence(editingAbsence.id); toast.success('Gelöscht'); setShowAbsencePopup(false); await loadData(selectedEmployee.id, selectedMonth); }
    catch (err: any) { toast.error(err.response?.data?.error || 'Fehler'); }
  };

  // Drag selection
  const getSelRange = () => {
    if (!selectionStart || !selectionEnd) return [];
    const s = selectionStart < selectionEnd ? selectionStart : selectionEnd;
    const e = selectionStart < selectionEnd ? selectionEnd : selectionStart;
    const all = eachDayOfInterval({ start: s, end: e });
    if (selectionStart.getDay() === selectionEnd.getDay() && !isSameDay(selectionStart, selectionEnd)) return all.filter(d => d.getDay() === selectionStart.getDay());
    return all;
  };
  const inSel = (d: Date) => isSelecting && selectionStart ? getSelRange().some(x => isSameDay(x, d)) : false;

  useEffect(() => {
    if (!isSelecting) return;
    const h = () => {
      const allDates = getSelRange();
      if (allDates.length > 1) {
        setSelectedDates(allDates);
        setEditingAbsence(null);
        setAbsenceFormData({ absenceTypeId: absenceTypes?.[0]?.id || '', note: '' });
        setShowAbsencePopup(true);
      }
      setIsSelecting(false);
    };
    document.addEventListener('mouseup', h);
    return () => document.removeEventListener('mouseup', h);
  }, [isSelecting, selectionStart, selectionEnd]);

  useEffect(() => {
    if (!editingEntry && !showCreateEntry) return;
    const h = (e: MouseEvent) => { if (popupRef.current && !popupRef.current.contains(e.target as Node)) { setEditingEntry(null); setShowCreateEntry(false); } };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [editingEntry, showCreateEntry]);

  return (
    <div className="h-[calc(100vh-4rem)] flex flex-col">
      <div className="p-4 border-b shrink-0">
        <h1 className="text-xl font-bold text-gray-900">Zeiteinträge</h1>
      </div>
      <div className="flex flex-1 overflow-hidden">
        {/* MA-Liste */}
        <div className="w-56 border-r flex flex-col shrink-0">
          <div className="p-2">
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-2.5 text-gray-400" />
              <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="w-full pl-8 pr-2 py-2 text-sm border rounded-lg" placeholder="Suchen..." />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {filtered.map(emp => (
              <button key={emp.id} onClick={() => selectEmployee(emp)}
                className={`w-full text-left px-3 py-2 flex items-center gap-2 text-sm hover:bg-gray-50 transition ${selectedEmployee?.id === emp.id ? 'bg-primary-50 border-l-[3px] border-l-primary-500' : 'border-l-[3px] border-l-transparent'}`}>
                <div className="w-7 h-7 rounded-full bg-gray-200 flex items-center justify-center shrink-0 overflow-hidden">
                  {emp.photoUrl ? <img src={photoSrc(emp.photoUrl)} className="w-full h-full object-cover" /> : <User size={14} className="text-gray-500" />}
                </div>
                <div className="min-w-0">
                  <p className="font-medium text-gray-900 truncate">{emp.firstName} {emp.lastName}</p>
                  <p className="text-xs text-gray-400">#{emp.employeeNumber}</p>
                </div>
              </button>
            ))}
          </div>
        </div>

        {selectedEmployee ? (<>
          {/* Mitte: Tagesdetails */}
          <div className={`flex-1 overflow-y-auto p-4 transition-opacity ${loading ? 'opacity-50' : ''}`}>
            {/* MA Info + Urlaub/Krank Stats */}
            {(() => {
              const isWorkDay = (d: string) => workDays.includes(new Date(d).getDay());
              const initialInYear = selectedEmployee?.initialBalanceYear === selectedMonth.getFullYear();
              const initialSick = initialInYear ? (selectedEmployee?.initialSickDays ?? 0) : 0;
              const sickYear = yearAbsences.filter((a: Absence) => a.absenceType.name.toLowerCase().includes('krank') && isWorkDay(a.date)).length + initialSick;
              const sickMonth = absences.filter((a: Absence) => a.absenceType.name.toLowerCase().includes('krank') && isWorkDay(a.date)).length;
              const vacationMonth = absences.filter((a: Absence) => a.absenceType.name.toLowerCase().includes('urlaub') && isWorkDay(a.date)).length;
              const vd = vacationDetails;
              return (
                <div className="mb-4 space-y-2">
                  <div className="bg-primary-50 rounded-lg p-2 text-sm text-center">
                    <span className="text-primary-700 font-medium">{selectedEmployee.firstName} {selectedEmployee.lastName}</span>
                    <span className="mx-2 text-gray-300">|</span>
                    <span className="text-primary-700">{format(selectedMonth, 'MMMM yyyy', { locale: de })}</span>
                    <span className="mx-2 text-gray-300">|</span>
                    <span className="text-primary-700">Ist: {fmtMin(totalMin)} h</span>
                    <span className="mx-2 text-gray-300">|</span>
                    <span className="text-primary-700">Soll: {fmtMin(targetMin)} h</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {/* Urlaub */}
                    <div className="border rounded-lg p-2.5">
                      <p className="text-xs font-medium text-gray-500 mb-1.5">Urlaub {selectedMonth.getFullYear()}</p>
                      {vd?.carryOver > 0 && (
                        <div className="mb-1.5 p-1 bg-blue-50 rounded text-center">
                          <p className="text-[10px] text-blue-600">Übertrag: <span className="font-bold">{vd.carryOver}</span> Tage {vd.carryOverUsed > 0 ? `(${vd.carryOverRemaining} übrig)` : ''}</p>
                        </div>
                      )}
                      <div className="grid grid-cols-3 gap-1 text-center">
                        <div className="bg-gray-50 rounded p-1"><p className="text-sm font-bold text-gray-900">{vd?.total ?? '-'}</p><p className="text-[10px] text-gray-400">Gesamt</p></div>
                        <div className="bg-orange-50 rounded p-1"><p className="text-sm font-bold text-orange-600">{vd?.totalUsed ?? '-'}</p><p className="text-[10px] text-gray-400">Genommen</p></div>
                        <div className="bg-green-50 rounded p-1"><p className={`text-sm font-bold ${(vd?.totalRemaining ?? 0) < 0 ? 'text-red-600' : 'text-green-600'}`}>{vd?.totalRemaining ?? '-'}</p><p className="text-[10px] text-gray-400">Rest</p></div>
                      </div>
                      {vacationMonth > 0 && <p className="text-[10px] text-gray-400 mt-1">davon {vacationMonth} in {format(selectedMonth, 'MMMM', { locale: de })}</p>}
                      {vd?.deductedDays > 0 && <p className="text-[10px] text-red-500 mt-1">{vd.deductedDays} abgezogen (Minusstd.)</p>}
                      {vd?.adjustmentDays != null && vd.adjustmentDays !== 0 && <p className={`text-[10px] mt-1 ${vd.adjustmentDays > 0 ? 'text-green-600' : 'text-red-500'}`}>{vd.adjustmentDays > 0 ? '+' : ''}{vd.adjustmentDays} angepasst (manuell)</p>}
                      {vd?.specialLeaveUsed > 0 && <p className="text-[10px] text-purple-500 mt-1">{vd.specialLeaveUsed} Sonderurlaub</p>}
                    </div>
                    {/* Krank */}
                    <div className="border rounded-lg p-2.5">
                      <p className="text-xs font-medium text-gray-500 mb-1.5">Krankheit {selectedMonth.getFullYear()}</p>
                      <div className="grid grid-cols-2 gap-1 text-center">
                        <div className="bg-red-50 rounded p-1"><p className="text-sm font-bold text-red-600">{sickMonth}</p><p className="text-[10px] text-gray-400">{format(selectedMonth, 'MMM', { locale: de })}</p></div>
                        <div className="bg-gray-50 rounded p-1"><p className="text-sm font-bold text-gray-900">{sickYear}</p><p className="text-[10px] text-gray-400">Jahr</p></div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}

            {(() => {
              const empStart = selectedEmployee?.startDate ? new Date(selectedEmployee.startDate) : null;
              const empEnd = selectedEmployee?.endDate ? new Date(selectedEmployee.endDate) : null;
              const beforeStart = empStart ? selectedDate < new Date(empStart.getFullYear(), empStart.getMonth(), empStart.getDate()) : false;
              const afterEnd = empEnd ? selectedDate > new Date(empEnd.getFullYear(), empEnd.getMonth(), empEnd.getDate()) : false;
              if (beforeStart || afterEnd) {
                return (
                  <div className="text-center text-gray-400 py-12 border rounded-lg border-dashed">
                    <Calendar size={32} className="mx-auto mb-2 opacity-30" />
                    <p>{beforeStart ? 'Vor dem Eintrittsdatum' : 'Nach dem Austrittsdatum'}</p>
                    <p className="text-xs mt-1">{beforeStart ? `Eintritt: ${format(empStart!, 'dd.MM.yyyy', { locale: de })}` : `Austritt: ${format(empEnd!, 'dd.MM.yyyy', { locale: de })}`}</p>
                  </div>
                );
              }
              const entries = getEntries(selectedDate);
              const absence = getAbsence(selectedDate);
              const holiday = getHoliday(selectedDate);
              const isNonWork = !workDays.includes(selectedDate.getDay());
              const isHol = !!holiday && !isNonWork;
              return (
                <div className="space-y-4">
                  <div>
                    <h3 className="text-lg font-semibold">{format(selectedDate, 'EEEE, dd. MMMM yyyy', { locale: de })}</h3>
                    <p className="text-sm text-gray-500">
                      {entries.length > 0 ? `${fmtMin(calcMin(selectedDate))} h` : ''}{isHol ? ` · ${holiday!.name}` : ''}{isNonWork ? ' · Frei' : ''}
                    </p>
                  </div>
                  {absence && (
                    <div className="rounded-lg px-3 py-2 cursor-pointer flex items-center gap-2" style={{ backgroundColor: absence.absenceType.color + '20', borderLeft: `3px solid ${absence.absenceType.color}` }}
                      onClick={() => { setEditingAbsence(absence); setAbsenceFormData({ absenceTypeId: absence.absenceTypeId, note: absence.note || '' }); setSelectedDates([selectedDate]); setShowAbsencePopup(true); }}>
                      <Briefcase size={16} style={{ color: absence.absenceType.color }} />
                      <span className="font-medium" style={{ color: absence.absenceType.color }}>{absence.absenceType.name}</span>
                      <Edit2 size={14} className="ml-auto text-gray-400" />
                    </div>
                  )}
                  {entries.length > 0 ? (
                    <div className="bg-white border rounded-lg divide-y">
                      <div className="px-3 py-2 bg-gray-50 rounded-t-lg"><span className="text-xs font-medium text-gray-500 uppercase">Buchungen</span></div>
                      {entries.map((entry, idx) => (
                        <div key={entry.id}>
                          {idx > 0 && entries[idx-1].clockOut && (() => { const gap = Math.round((new Date(entry.clockIn).getTime() - new Date(entries[idx-1].clockOut!).getTime()) / 60000); return gap > 0 ? <div className="px-3 py-1.5 bg-orange-50 flex items-center gap-2 text-xs text-orange-600"><Clock size={12} /> Pause: {format(new Date(entries[idx-1].clockOut!), 'HH:mm')} - {format(new Date(entry.clockIn), 'HH:mm')} ({gap >= 60 ? `${Math.floor(gap / 60)}:${String(gap % 60).padStart(2, '0')}h` : `${gap} min`})</div> : null; })()}
                          <div className="px-3 py-2 flex items-center gap-3 cursor-pointer hover:bg-gray-50" onClick={() => openEdit(selectedDate, entry)}>
                            {entry.complaintMessage && (entry.complaintResolvedAt ? <CheckCircle size={14} className="text-green-500" /> : <AlertTriangle size={14} className="text-amber-500" />)}
                            {(entry.clockInViaPwa || entry.clockOutViaPwa) && <MapPin size={14} className="text-blue-500" />}
                            <span className="font-mono text-sm font-medium w-28">{format(new Date(entry.clockIn), 'HH:mm')} - {entry.clockOut ? format(new Date(entry.clockOut), 'HH:mm') : <span className="text-green-600">Aktiv</span>}</span>
                            {entry.clockOut && <span className="text-sm text-gray-500">{fmtMin(Math.floor((new Date(entry.clockOut).getTime() - new Date(entry.clockIn).getTime()) / 60000))} h</span>}
                            <Edit2 size={14} className="text-gray-400 ml-auto" />
                          </div>
                          {entry.complaintMessage && (
                            <div className={'px-3 py-2.5 text-sm border-t ' + (entry.complaintResolvedAt ? 'bg-green-50' : 'bg-amber-50')}>
                              <div className="flex items-start gap-2">
                                {entry.complaintResolvedAt ? <CheckCircle size={14} className="text-green-600 mt-0.5 shrink-0" /> : <AlertTriangle size={14} className="text-amber-600 mt-0.5 shrink-0" />}
                                <div className="flex-1">
                                  <div className={'text-xs font-semibold uppercase tracking-wide mb-1 ' + (entry.complaintResolvedAt ? 'text-green-700' : 'text-amber-700')}>
                                    Reklamation {entry.complaintResolvedAt ? '(gelöst)' : '(offen)'}
                                    {entry.complaintAt && <span className="font-normal text-gray-500 ml-2">{format(new Date(entry.complaintAt), 'dd.MM.yyyy HH:mm')}</span>}
                                  </div>
                                  <div className="text-gray-800 whitespace-pre-wrap">{entry.complaintMessage}</div>
                                  {entry.complaintResponse && (
                                    <div className="mt-2 pt-2 border-t border-green-200">
                                      <div className="text-xs font-semibold text-green-700 mb-0.5">Admin-Antwort:</div>
                                      <div className="text-gray-700 whitespace-pre-wrap">{entry.complaintResponse}</div>
                                    </div>
                                  )}
                                  {(entry.complaintOriginalClockIn || entry.complaintOriginalClockOut) && entry.complaintResolvedAt && (
                                    <div className="mt-2 pt-2 border-t border-green-200 text-xs text-gray-600">
                                      <span className="font-semibold">Vorher:</span>{' '}
                                      {entry.complaintOriginalClockIn ? format(new Date(entry.complaintOriginalClockIn), 'HH:mm') : '—'} - {entry.complaintOriginalClockOut ? format(new Date(entry.complaintOriginalClockOut), 'HH:mm') : '—'}
                                      {entry.complaintOriginalBreakMinutes != null && <span> · Pause: {entry.complaintOriginalBreakMinutes} min</span>}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : !absence && !isHol && !isNonWork ? <div className="text-center text-gray-400 py-8 border rounded-lg border-dashed">Keine Einträge</div> : null}
                  <div className="flex items-center gap-2 flex-wrap">
                    <button onClick={() => openEdit(selectedDate)} className="text-sm text-primary-600 hover:bg-primary-50 border border-primary-200 rounded px-3 py-1.5 flex items-center gap-1.5"><Plus size={14} /> Eintrag</button>
                    {!absence && absenceTypes?.length > 0 && (
                      <button onClick={() => { setEditingAbsence(null); setAbsenceFormData({ absenceTypeId: absenceTypes[0].id, note: '' }); setSelectedDates([selectedDate]); setShowAbsencePopup(true); }}
                        className="text-sm text-purple-600 hover:bg-purple-50 border border-purple-200 rounded px-3 py-1.5 flex items-center gap-1.5"><Briefcase size={14} /> Abwesenheit</button>
                    )}
                    {entries.some(e => e.clockOut) && (
                      <button onClick={() => { setPauseEntryId(entries.find(e => e.clockOut)!.id); setPauseStart('12:00'); setPauseEnd('12:30'); setShowPausePopup(true); }}
                        className="text-sm text-orange-600 hover:bg-orange-50 border border-orange-200 rounded px-3 py-1.5 flex items-center gap-1.5"><Clock size={14} /> Pause</button>
                    )}
                  </div>
                </div>
              );
            })()}
          </div>

          {/* Rechts: Kalender */}
          <div className="w-72 border-l p-3 shrink-0 self-start">
            <div className="flex items-center gap-1 mb-3">
              <button onClick={() => changeMonth('prev')} className="p-1 hover:bg-gray-100 rounded"><ChevronLeft size={16} /></button>
              <select value={selectedMonth.getMonth()} onChange={e => { const m = new Date(selectedMonth); m.setMonth(parseInt(e.target.value)); setSelectedMonth(m); if (selectedEmployee) loadData(selectedEmployee.id, m); }} className="text-sm font-medium bg-transparent border rounded px-1.5 py-0.5">{MONTHS.map((m, i) => <option key={i} value={i}>{m}</option>)}</select>
              <select value={selectedMonth.getFullYear()} onChange={e => { const m = new Date(selectedMonth); m.setFullYear(parseInt(e.target.value)); setSelectedMonth(m); if (selectedEmployee) loadData(selectedEmployee.id, m); }} className="text-sm font-medium bg-transparent border rounded px-1.5 py-0.5">{Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - 2 + i).map(y => <option key={y} value={y}>{y}</option>)}</select>
              <button onClick={() => changeMonth('next')} className="p-1 hover:bg-gray-100 rounded"><ChevronRight size={16} /></button>
            </div>
            <div className="grid grid-cols-7 gap-0.5 mb-2">{['Mo','Di','Mi','Do','Fr','Sa','So'].map(d => <div key={d} className="text-center text-[10px] font-medium text-gray-400 py-1">{d}</div>)}</div>
            <div className="grid grid-cols-7 gap-0.5">
              {(() => {
                const mS = startOfMonth(selectedMonth), mE = endOfMonth(selectedMonth);
                const days = eachDayOfInterval({ start: mS, end: mE });
                const pad = (mS.getDay() + 6) % 7;
                const cells: (Date | null)[] = Array(pad).fill(null).concat(days);
                while (cells.length % 7) cells.push(null);
                return cells.map((day, i) => {
                  if (!day) return <div key={`e${i}`} className="aspect-square" />;
                  const empStart = selectedEmployee?.startDate ? new Date(selectedEmployee.startDate) : null;
                  const empEnd = selectedEmployee?.endDate ? new Date(selectedEmployee.endDate) : null;
                  const beforeStart = empStart ? day < new Date(empStart.getFullYear(), empStart.getMonth(), empStart.getDate()) : false;
                  const afterEnd = empEnd ? day > new Date(empEnd.getFullYear(), empEnd.getMonth(), empEnd.getDate()) : false;
                  const outOfRange = beforeStart || afterEnd;

                  const ents = getEntries(day), abs = getAbsence(day), hol = getHoliday(day);
                  const nw = !workDays.includes(day.getDay()), td = isSameDay(day, new Date()), sel = isSameDay(day, selectedDate), iS = inSel(day), fut = day > new Date(), he = ents.length > 0, ih = !!hol && !nw;
                  let bg = 'bg-gray-50', tx = 'text-gray-900';
                  if (outOfRange) { bg = 'bg-gray-50'; tx = 'text-gray-300'; }
                  else if (sel) { bg = 'bg-primary-600'; tx = 'text-white'; } else if (iS) { bg = 'bg-purple-200'; tx = 'text-purple-900'; } else if (nw) { bg = 'bg-gray-100'; tx = 'text-gray-400'; } else if (ih) { bg = 'bg-red-100'; tx = 'text-red-700'; } else if (abs) { bg = 'bg-blue-100'; tx = 'text-blue-700'; } else if (he) { bg = 'bg-green-100'; tx = 'text-green-800'; } else if (!fut && !nw) { bg = 'bg-orange-100'; tx = 'text-orange-700'; }
                  return <div key={day.toISOString()}
                    onClick={() => { if (!isSelecting && !outOfRange) setSelectedDate(day); }}
                    onMouseDown={e => { if (outOfRange) return; e.preventDefault(); setIsSelecting(true); setSelectionStart(day); setSelectionEnd(day); }}
                    onMouseEnter={() => { if (isSelecting) setSelectionEnd(day); }}
                    className={`aspect-square rounded flex flex-col items-center justify-center text-xs font-medium select-none ${outOfRange ? 'cursor-not-allowed opacity-40' : 'cursor-pointer hover:ring-2 hover:ring-primary-300'} ${bg} ${tx} ${td && !sel && !outOfRange ? 'ring-2 ring-primary-500' : ''}`}>
                    <span className={sel && !outOfRange ? 'font-bold' : ''}>{format(day, 'd')}</span>
                    {he && !sel && !iS && !outOfRange && <span className="text-[8px] leading-none mt-0.5 opacity-75 pointer-events-none">{fmtMin(calcMin(day))}</span>}
                  </div>;
                });
              })()}
            </div>
            <div className="mt-3 pt-3 border-t flex flex-wrap gap-x-3 gap-y-1">
              {[['bg-green-100','Gearbeitet'],['bg-orange-100','Fehlt'],['bg-blue-100','Abwesend'],['bg-red-100','Feiertag'],['bg-gray-100','Frei']].map(([c,l]) => <div key={l} className="flex items-center gap-1 text-[10px] text-gray-500"><div className={`w-2.5 h-2.5 rounded ${c}`} />{l}</div>)}
            </div>

            {/* Urlaubsanpassungen */}
            <div className="mt-4 pt-3 border-t">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-gray-700">Urlaubsanpassungen {selectedMonth.getFullYear()}</p>
                <button onClick={() => { setAdjForm({ days: '', reason: '' }); setShowAdjPopup(true); }} className="p-1 text-primary-600 hover:bg-primary-50 rounded" title="Anpassung hinzufügen"><Plus size={14} /></button>
              </div>
              {vacationAdjustments.length > 0 ? (
                <div className="space-y-1.5">
                  {vacationAdjustments.map((a: any) => (
                    <div key={a.id} className="flex items-start gap-2 text-[11px] bg-gray-50 rounded p-1.5">
                      <span className={`font-bold flex-shrink-0 ${a.days > 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {a.days > 0 ? '+' : ''}{a.days}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-gray-700 truncate" title={a.reason}>{a.reason}</p>
                        <p className="text-[10px] text-gray-400">{MONTHS[a.month - 1]} · {a.createdBy}</p>
                      </div>
                      <button onClick={async () => {
                        const current = vacationDetails?.totalRemaining ?? 0;
                        const after = current - a.days;
                        const willGoNegative = a.days > 0 && after < 0;
                        const ok = await confirm({
                          title: willGoNegative ? 'Anpassung löschen – Saldo wird negativ' : 'Anpassung löschen?',
                          variant: willGoNegative ? 'warning' : 'danger',
                          confirmText: 'Löschen',
                          message: willGoNegative ? (
                            <div className="space-y-2">
                              <p>Die Anpassung von <strong className="text-green-600">+{a.days}</strong> Tag(en) wird entfernt.</p>
                              <p>Resturlaub: <strong>{current}</strong> → <strong className="text-red-600">{after}</strong> Tag(e)</p>
                              <p className="text-xs text-gray-500">Der negative Urlaubssaldo wird ins nächste Jahr übernommen.</p>
                            </div>
                          ) : (
                            <p>Diese Urlaubsanpassung ({a.days > 0 ? '+' : ''}{a.days} Tage) wirklich löschen?</p>
                          ),
                        });
                        if (!ok) return;
                        try { await timeEntriesApi.deleteVacationAdjustment(a.id); toast.success('Gelöscht'); await loadData(selectedEmployee!.id, selectedMonth); } catch { toast.error('Fehler'); }
                      }} className="p-0.5 text-gray-400 hover:text-red-500 flex-shrink-0"><Trash2 size={12} /></button>
                    </div>
                  ))}
                  {vacationAdjustments.length > 1 && (() => {
                    const net = vacationAdjustments.reduce((s: number, a: any) => s + a.days, 0);
                    return <p className={`text-[10px] font-medium text-right ${net > 0 ? 'text-green-600' : net < 0 ? 'text-red-500' : 'text-gray-500'}`}>Gesamt: {net > 0 ? '+' : ''}{net} Tage</p>;
                  })()}
                </div>
              ) : (
                <p className="text-[10px] text-gray-400">Keine Anpassungen</p>
              )}
            </div>
          </div>
        </>) : (
          <div className="flex-1 flex items-center justify-center text-gray-400"><div className="text-center"><User size={48} className="mx-auto mb-3 opacity-30" /><p>Wähle einen Mitarbeiter</p></div></div>
        )}
      </div>

      {/* Quick Edit */}
      {(editingEntry || showCreateEntry) && <div ref={popupRef} className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-xl shadow-2xl border p-4 w-80 z-50">
        <div className="flex items-center justify-between mb-4"><h4 className="font-semibold">{format(selectedDate, 'dd.MM.yyyy', { locale: de })}</h4><button onClick={() => { setEditingEntry(null); setShowCreateEntry(false); }} className="p-1 hover:bg-gray-100 rounded"><X size={16} /></button></div>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3"><div><label className="block text-xs text-gray-500 mb-1">Ein</label><input type="time" value={formData.clockIn} onChange={e => setFormData({...formData, clockIn: e.target.value})} className="input text-sm py-1.5" required /></div><div><label className="block text-xs text-gray-500 mb-1">Aus</label><input type="time" value={formData.clockOut} onChange={e => setFormData({...formData, clockOut: e.target.value})} className="input text-sm py-1.5" /></div></div>
          <div><label className="block text-xs text-gray-500 mb-1">Notiz</label><input type="text" value={formData.note} onChange={e => setFormData({...formData, note: e.target.value})} className="input text-sm py-1.5" /></div>
          <div className="flex items-center justify-between pt-2">
            {editingEntry && <button type="button" onClick={handleDelete} className="p-2 text-red-600 hover:bg-red-50 rounded"><Trash2 size={16} /></button>}
            <div className={`flex gap-2 ${editingEntry ? '' : 'ml-auto'}`}><button type="button" onClick={() => { setEditingEntry(null); setShowCreateEntry(false); }} className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Abbrechen</button><button type="submit" className="px-3 py-1.5 text-sm bg-primary-600 text-white rounded-lg">Speichern</button></div>
          </div>
        </form>
      </div>}

      {/* Urlaubsanpassung Popup */}
      {showAdjPopup && (() => {
        const parsedDays = parseFloat(adjForm.days);
        const days = isNaN(parsedDays) ? 0 : parsedDays;
        const current = vacationDetails?.totalRemaining ?? 0;
        const after = current + days;
        const willGoNegative = days < 0 && after < 0;
        return (
        <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-xl shadow-2xl border p-4 w-80 z-50">
          <div className="flex items-center justify-between mb-4"><h4 className="font-semibold">Urlaubsanpassung</h4><button onClick={() => setShowAdjPopup(false)} className="p-1 hover:bg-gray-100 rounded"><X size={16} /></button></div>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Monat</label>
                <select value={selectedMonth.getMonth() + 1} disabled className="input text-sm py-1.5 w-full bg-gray-50">
                  {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Tage (+/-)</label>
                <input type="number" step="0.5" value={adjForm.days} onChange={e => setAdjForm({ ...adjForm, days: e.target.value })} className="input text-sm py-1.5 w-full" placeholder="z.B. 4 oder -2" />
              </div>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Begründung <span className="text-red-500">*</span></label>
              <input type="text" value={adjForm.reason} onChange={e => setAdjForm({ ...adjForm, reason: e.target.value })} className="input text-sm py-1.5 w-full" placeholder="z.B. Sondervereinbarung..." />
            </div>
            {days !== 0 && (
              <div className={`text-xs px-2 py-1.5 rounded ${willGoNegative ? 'bg-red-50 border border-red-200 text-red-700' : 'bg-gray-50 text-gray-600'}`}>
                Resturlaub: {current} → <strong>{after}</strong> Tag(e)
                {willGoNegative && <span className="block mt-0.5">⚠ Urlaubssaldo wird negativ — Übertrag ins nächste Jahr</span>}
              </div>
            )}
            <div className="flex gap-2 pt-1">
              <button onClick={() => setShowAdjPopup(false)} className="btn btn-secondary flex-1 text-sm py-1.5">Abbrechen</button>
              <button onClick={async () => {
                if (!days || days === 0) { toast.error('Tage dürfen nicht 0 sein'); return; }
                if (!adjForm.reason.trim()) { toast.error('Begründung erforderlich'); return; }
                if (willGoNegative) {
                  const name = `${selectedEmployee!.firstName} ${selectedEmployee!.lastName}`;
                  const ok = await confirm({
                    title: 'Urlaubssaldo wird negativ',
                    variant: 'warning',
                    confirmText: 'Trotzdem speichern',
                    message: (
                      <div className="space-y-2">
                        <p><strong>{name}</strong> hat aktuell <strong>{current}</strong> Resturlaubstag(e).</p>
                        <p>Nach dieser Anpassung von <strong>{days}</strong> Tag(en) ergibt sich ein Saldo von <strong className="text-red-600">{after} Tag(en)</strong>, der ins nächste Jahr übernommen wird.</p>
                      </div>
                    ),
                  });
                  if (!ok) return;
                }
                try {
                  await timeEntriesApi.createVacationAdjustment({ employeeId: selectedEmployee!.id, year: selectedMonth.getFullYear(), month: selectedMonth.getMonth() + 1, days, reason: adjForm.reason.trim() });
                  toast.success('Urlaubsanpassung gespeichert');
                  setShowAdjPopup(false);
                  await loadData(selectedEmployee!.id, selectedMonth);
                } catch (err: any) { toast.error(err.response?.data?.error || 'Fehler'); }
              }} className="btn btn-primary flex-1 text-sm py-1.5">Speichern</button>
            </div>
          </div>
        </div>
        );
      })()}

      {/* Pause */}
      {showPausePopup && <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-xl shadow-2xl border p-4 w-80 z-50">
        <div className="flex items-center justify-between mb-3"><h4 className="font-semibold flex items-center gap-2"><Clock size={18} className="text-orange-500" /> Pause</h4><button onClick={() => setShowPausePopup(false)} className="p-1 hover:bg-gray-100 rounded"><X size={16} /></button></div>
        <div className="space-y-3"><div><label className="block text-xs text-gray-500 mb-1">Von</label><input type="time" value={pauseStart} onChange={e => setPauseStart(e.target.value)} className="input text-sm py-1.5" /></div><div><label className="block text-xs text-gray-500 mb-1">Bis</label><input type="time" value={pauseEnd} onChange={e => setPauseEnd(e.target.value)} className="input text-sm py-1.5" /></div>
          <div className="flex justify-end gap-2"><button onClick={() => setShowPausePopup(false)} className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Abbrechen</button><button onClick={handlePause} className="px-3 py-1.5 text-sm bg-orange-500 text-white rounded-lg">Einfügen</button></div></div>
      </div>}

      {/* Abwesenheit */}
      {showAbsencePopup && (() => {
        const existingCount = selectedDates.filter(d => getAbsence(d)).length;
        const handleDeleteAll = async () => {
          if (!selectedEmployee) return;
          const ok = await confirm({
            title: `${existingCount} Abwesenheit(en) löschen?`,
            variant: 'danger',
            confirmText: 'Löschen',
            message: `Die ausgewählten Abwesenheiten werden unwiderruflich entfernt.`,
          });
          if (!ok) return;
          try {
            const ids = selectedDates.map(d => getAbsence(d)?.id).filter(Boolean) as string[];
            if (ids.length > 0) await settingsApi.deleteAbsencesBulk(ids);
            toast.success(`${ids.length} Einträge gelöscht`);
            setShowAbsencePopup(false);
            await loadData(selectedEmployee.id, selectedMonth);
          } catch (err: any) { toast.error(err.response?.data?.error || 'Fehler'); }
        };
        const handleSubmitWithOverwrite = async (e: React.FormEvent) => {
          e.preventDefault();
          if (!selectedEmployee) return;
          try {
            // Bestehende per Bulk löschen
            const idsToDelete = selectedDates.map(d => getAbsence(d)?.id).filter(Boolean) as string[];
            if (idsToDelete.length > 0) await settingsApi.deleteAbsencesBulk(idsToDelete);
            // Neue per Bulk erstellen
            await settingsApi.createAbsencesBulk({
              employeeId: selectedEmployee.id,
              absenceTypeId: absenceFormData.absenceTypeId,
              dates: selectedDates.map(d => format(d, 'yyyy-MM-dd')),
              note: absenceFormData.note || undefined,
            });
            toast.success('Gespeichert'); setShowAbsencePopup(false); await loadData(selectedEmployee.id, selectedMonth);
          } catch (err: any) { toast.error(err.response?.data?.error || 'Fehler'); }
        };
        return (
          <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-xl shadow-2xl border p-4 w-80 z-50">
            <div className="flex items-center justify-between mb-3">
              <h4 className="font-semibold flex items-center gap-2"><Briefcase size={18} /> {selectedDates.length > 1 ? `${selectedDates.length} Tage` : format(selectedDate, 'dd.MM.', { locale: de })}</h4>
              <button onClick={() => setShowAbsencePopup(false)} className="p-1 hover:bg-gray-100 rounded"><X size={16} /></button>
            </div>
            {existingCount > 0 && selectedDates.length > 1 && (
              <div className="mb-3 p-2 bg-amber-50 rounded-lg text-xs text-amber-700">
                {existingCount} der {selectedDates.length} Tage haben bereits einen Eintrag. Diese werden beim Speichern überschrieben.
              </div>
            )}
            <form onSubmit={handleSubmitWithOverwrite} className="space-y-3">
              <select value={absenceFormData.absenceTypeId} onChange={e => setAbsenceFormData({...absenceFormData, absenceTypeId: e.target.value})} className="input text-sm py-1.5 w-full" required>
                <option value="">Wählen...</option>
                {absenceTypes?.map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              <input type="text" value={absenceFormData.note} onChange={e => setAbsenceFormData({...absenceFormData, note: e.target.value})} className="input text-sm py-1.5 w-full" placeholder="Notiz..." />
              <div className="flex items-center justify-between pt-2">
                <div className="flex gap-1">
                  {editingAbsence && <button type="button" onClick={handleAbsenceDelete} className="p-2 text-red-600 hover:bg-red-50 rounded" title="Löschen"><Trash2 size={16} /></button>}
                  {existingCount > 0 && selectedDates.length > 1 && (
                    <button type="button" onClick={handleDeleteAll} className="px-2 py-1.5 text-xs text-red-600 hover:bg-red-50 border border-red-200 rounded-lg">
                      Alle löschen ({existingCount})
                    </button>
                  )}
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setShowAbsencePopup(false)} className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Abbrechen</button>
                  <button type="submit" className="px-3 py-1.5 text-sm bg-primary-600 text-white rounded-lg">Speichern</button>
                </div>
              </div>
            </form>
          </div>
        );
      })()}
    </div>
  );
}
