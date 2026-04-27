import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { reportsApi, employeesApi } from '../../lib/api';
import { useConfirm } from '../../components/ConfirmDialog';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import toast from 'react-hot-toast';
import { FileText, Download, Check, Trash2, Eye, Plus, X, RefreshCw, Edit2, Calendar, Filter, AlertTriangle, ChevronLeft, ChevronRight, Upload } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import DocumentUploadModal from '../../components/DocumentUploadModal';

// Formatiert Dezimalstunden zu H:MM Format (unterstützt negative Werte)
const formatHoursToTime = (hours: number): string => {
  const sign = hours < 0 ? '-' : '';
  const abs = Math.abs(hours);
  const h = Math.floor(abs);
  const m = Math.floor((abs - h) * 60);
  return `${sign}${h}:${m.toString().padStart(2, '0')}`;
};

const MONTHS = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
];

export default function AdminReports() {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingReport, setEditingReport] = useState<any>(null);
  const [previewData, setPreviewData] = useState<any>(null);
  const [selectedEmployee, setSelectedEmployee] = useState('');
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1);
  const [applyDeduction, setApplyDeduction] = useState(true);
  const [customDeductionDays, setCustomDeductionDays] = useState(0);
  // Batch-Modus (alle MA)
  const [batchEmployees, setBatchEmployees] = useState<any[]>([]);
  const [batchIndex, setBatchIndex] = useState(0);
  const [batchCreated, setBatchCreated] = useState<Set<string>>(new Set());
  const [batchSkipped, setBatchSkipped] = useState<Set<string>>(new Set());
  const [batchDone, setBatchDone] = useState(false);
  const isBatchMode = batchEmployees.length > 0;

  // Dokumenten-Upload-Modal: optional vorbelegt aus Vorschau-Kontext
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [uploadPrefill, setUploadPrefill] = useState<{ employeeId?: string; year?: number; month?: number; lock?: boolean }>({});

  // Filter state (status from URL param if present)
  const [searchParams] = useSearchParams();
  const [filterEmployee, setFilterEmployee] = useState('');
  const [filterYear, setFilterYear] = useState<number | ''>(new Date().getFullYear());
  const [filterMonth, setFilterMonth] = useState<number | ''>(new Date().getMonth() + 1);
  const [filterStatus, setFilterStatus] = useState<string>(searchParams.get('status') || '');

  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const confirm = useConfirm();

  const { data: employees } = useQuery({
    queryKey: ['employees'],
    queryFn: () => employeesApi.getAll().then((r) => r.data),
  });

  const { data: reports, isLoading } = useQuery({
    queryKey: ['reports'],
    queryFn: () => reportsApi.getAll().then((r) => r.data),
  });

  const previewMutation = useMutation({
    mutationFn: () => reportsApi.preview(selectedEmployee, selectedYear, selectedMonth),
    onSuccess: (response) => {
      setPreviewData(response.data);
      setShowCreateModal(false);
      setShowPreviewModal(true);
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Fehler beim Laden der Vorschau');
    },
  });

  const createMutation = useMutation({
    mutationFn: (data: { employeeId: string; year: number; month: number }) =>
      reportsApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reports'] });
      if (isBatchMode) {
        const empName = batchEmployees[batchIndex];
        toast.success(`Abrechnung für ${empName?.lastName} erstellt`);
        setBatchCreated(prev => new Set(prev).add(selectedEmployee));
        navigateBatchNext();
      } else {
        toast.success('Abrechnung erstellt');
        setShowCreateModal(false);
        setShowPreviewModal(false);
      }
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Fehler beim Erstellen');
    },
  });

  const finalizeMutation = useMutation({
    mutationFn: (id: string) => reportsApi.finalize(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reports'] });
      toast.success('Abrechnung finalisiert und PDF erstellt');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Fehler beim Finalisieren');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => reportsApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reports'] });
      toast.success('Abrechnung gelöscht');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Fehler beim Löschen');
    },
  });

  // Batch-Navigation
  const navigateBatchTo = (index: number) => {
    setBatchIndex(index);
    const emp = batchEmployees[index];
    setSelectedEmployee(emp.id);
    setCustomDeductionDays(0);
    setApplyDeduction(true);
    previewMutation.mutate();
  };

  const navigateBatchNext = () => {
    if (batchIndex < batchEmployees.length - 1) {
      navigateBatchTo(batchIndex + 1);
    } else {
      setBatchDone(true);
    }
  };

  const handleBatchStart = () => {
    const activeEmps = (employees || [])
      .filter((e: any) => e.isActive && !e.isAdmin)
      .sort((a: any, b: any) => a.lastName.localeCompare(b.lastName));

    // MAs rausfiltern die schon eine Abrechnung für den Monat haben
    const existingReportEmpIds = new Set(
      (reports || [])
        .filter((r: any) => r.year === selectedYear && r.month === selectedMonth)
        .map((r: any) => r.employeeId)
    );
    const eligible = activeEmps.filter((e: any) => !existingReportEmpIds.has(e.id));

    if (eligible.length === 0) {
      toast.error('Alle Mitarbeiter haben bereits eine Abrechnung für diesen Monat');
      return;
    }

    setBatchEmployees(eligible);
    setBatchIndex(0);
    setBatchCreated(new Set());
    setBatchSkipped(new Set());
    setBatchDone(false);
    setSelectedEmployee(eligible[0].id);
    setCustomDeductionDays(0);
    setApplyDeduction(true);
    setShowCreateModal(false);
    previewMutation.mutate();
  };

  const closeBatch = () => {
    setBatchEmployees([]);
    setBatchIndex(0);
    setBatchCreated(new Set());
    setBatchSkipped(new Set());
    setBatchDone(false);
    setShowPreviewModal(false);
    setPreviewData(null);
  };

  const recalculateMutation = useMutation({
    mutationFn: (id: string) => reportsApi.recalculate(id),
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: ['reports'] });
      toast.success('Abrechnung neu berechnet');
      if (response.data?._warning) {
        toast(response.data._warning, { icon: '\u26A0\uFE0F', duration: 6000 });
      }
      setShowEditModal(false);
      setEditingReport(null);
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Fehler beim Neuberechnen');
    },
  });

  const openEditModal = (report: any) => {
    setEditingReport(report);
    setShowEditModal(true);
  };

  const handleDownload = async (id: string, filename: string) => {
    try {
      const response = await reportsApi.downloadPdf(id);
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (error) {
      toast.error('Fehler beim Herunterladen');
    }
  };

  const [isPreviewLoading, setIsPreviewLoading] = useState(false);

  const handlePreviewPdf = async (report: any) => {
    setIsPreviewLoading(true);
    try {
      const response = await reportsApi.previewPdf(report.id);
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `Vorschau_${report.employee.lastName}_${report.employee.firstName}_${String(report.month).padStart(2, '0')}_${report.year}.pdf`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      toast.success('PDF-Vorschau heruntergeladen');
    } catch (error) {
      toast.error('Fehler beim Erstellen der PDF-Vorschau');
    } finally {
      setIsPreviewLoading(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'draft':
        return <span className="px-2 py-1 text-xs font-medium rounded-full bg-yellow-100 text-yellow-700">Entwurf</span>;
      case 'finalized':
        return <span className="px-2 py-1 text-xs font-medium rounded-full bg-green-100 text-green-700">Finalisiert</span>;
      case 'paid':
        return <span className="px-2 py-1 text-xs font-medium rounded-full bg-blue-100 text-blue-700">Bezahlt</span>;
      default:
        return null;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Abrechnungen</h1>
          <p className="text-gray-500">Monatsabrechnungen verwalten</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setUploadPrefill({}); setUploadModalOpen(true); }}
            className="btn btn-secondary flex items-center gap-2"
            title="Externes Dokument für einen Mitarbeiter hochladen"
          >
            <Upload size={20} />
            Dokument hochladen
          </button>
          <button
            onClick={() => setShowCreateModal(true)}
            className="btn btn-primary flex items-center gap-2"
          >
            <Plus size={20} />
            Neue Abrechnung
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="card p-4">
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex items-center gap-2 text-gray-500">
            <Filter size={18} />
            <span className="text-sm font-medium">Filter:</span>
          </div>
          <div className="min-w-[180px]">
            <label className="label text-xs">Mitarbeiter</label>
            <select
              value={filterEmployee}
              onChange={(e) => setFilterEmployee(e.target.value)}
              className="input py-1.5 text-sm"
            >
              <option value="">Alle</option>
              {employees?.map((emp: any) => (
                <option key={emp.id} value={emp.id}>
                  {emp.firstName} {emp.lastName}
                </option>
              ))}
            </select>
          </div>
          <div className="min-w-[100px]">
            <label className="label text-xs">Jahr</label>
            <select
              value={filterYear}
              onChange={(e) => setFilterYear(e.target.value ? parseInt(e.target.value) : '')}
              className="input py-1.5 text-sm"
            >
              <option value="">Alle</option>
              {[2023, 2024, 2025, 2026, 2027].map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
          <div className="min-w-[120px]">
            <label className="label text-xs">Monat</label>
            <select
              value={filterMonth}
              onChange={(e) => setFilterMonth(e.target.value ? parseInt(e.target.value) : '')}
              className="input py-1.5 text-sm"
            >
              <option value="">Alle</option>
              {MONTHS.map((m, i) => (
                <option key={i} value={i + 1}>{m}</option>
              ))}
            </select>
          </div>
          <div className="min-w-[120px]">
            <label className="label text-xs">Status</label>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="input py-1.5 text-sm"
            >
              <option value="">Alle</option>
              <option value="draft">Entwurf</option>
              <option value="finalized">Finalisiert</option>
            </select>
          </div>
          {(filterEmployee || filterYear || filterMonth || filterStatus) && (
            <button
              onClick={() => { setFilterEmployee(''); setFilterYear(''); setFilterMonth(''); setFilterStatus(''); }}
              className="text-sm text-primary-600 hover:text-primary-700 hover:underline pb-1"
            >
              Zurücksetzen
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
                  Zeitraum
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Stunden
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
              {(() => {
                const filteredReports = reports?.filter((r: any) => {
                  if (filterEmployee && r.employeeId !== filterEmployee) return false;
                  if (filterYear && r.year !== filterYear) return false;
                  if (filterMonth && r.month !== filterMonth) return false;
                  if (filterStatus && r.status !== filterStatus) return false;
                  return true;
                });
                return isLoading ? (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-gray-500">
                    Laden...
                  </td>
                </tr>
              ) : filteredReports?.length ? (
                filteredReports.map((report: any) => (
                  <tr key={report.id}>
                    <td className="px-6 py-4">
                      <p className="font-medium text-gray-900">
                        {report.employee.firstName} {report.employee.lastName}
                      </p>
                      <p className="text-sm text-gray-500">#{report.employee.employeeNumber}</p>
                    </td>
                    <td className="px-6 py-4 text-gray-900">
                      {MONTHS[report.month - 1]} {report.year}
                    </td>
                    <td className="px-6 py-4">
                      <p className="text-gray-900">{formatHoursToTime(report.totalHours)} h</p>
                      {report.overtimeHours !== 0 && (
                        <p className={`text-sm ${report.overtimeHours >= 0 ? 'text-orange-600' : 'text-red-600'}`}>
                          {report.overtimeHours >= 0 ? '+' : ''}{formatHoursToTime(report.overtimeHours)} h Differenz
                        </p>
                      )}
                      {report.cumulativeOvertimeBalance != null && (
                        <p className={`text-xs font-medium ${report.cumulativeOvertimeBalance >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          Saldo: {report.cumulativeOvertimeBalance >= 0 ? '+' : ''}{formatHoursToTime(report.cumulativeOvertimeBalance)} h
                        </p>
                      )}
                    </td>
                    <td className="px-6 py-4">{getStatusBadge(report.status)}</td>
                    <td className="px-6 py-4">
                      <div className="flex items-center justify-end gap-2">
                        {/* Bearbeiten - immer verfügbar */}
                        <button
                          onClick={() => openEditModal(report)}
                          className="p-2 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg"
                          title="Bearbeiten"
                        >
                          <Edit2 size={18} />
                        </button>
                        {/* PDF-Vorschau - immer verfügbar */}
                        <button
                          onClick={() => handlePreviewPdf(report)}
                          className="p-2 text-gray-500 hover:text-primary-600 hover:bg-primary-50 rounded-lg"
                          title="PDF-Vorschau"
                        >
                          <Eye size={18} />
                        </button>
                        {/* Finalisieren - nur bei draft */}
                        {report.status === 'draft' && (
                          <button
                            onClick={() => finalizeMutation.mutate(report.id)}
                            className="p-2 text-gray-500 hover:text-green-600 hover:bg-green-50 rounded-lg"
                            title="Finalisieren"
                          >
                            <Check size={18} />
                          </button>
                        )}
                        {/* PDF herunterladen - nur bei finalisiert */}
                        {report.pdfPath && (
                          <button
                            onClick={() =>
                              handleDownload(report.id, `${report.employee.lastName}_${report.employee.firstName}_${String(report.month).padStart(2, '0')}_${report.year}.pdf`)
                            }
                            className="p-2 text-gray-500 hover:text-primary-600 hover:bg-primary-50 rounded-lg"
                            title="PDF herunterladen"
                          >
                            <Download size={18} />
                          </button>
                        )}
                        {/* Löschen - immer verfügbar mit Bestätigung */}
                        <button
                          onClick={async () => {
                            if (report.status === 'finalized') {
                              const ok = await confirm({
                                title: 'Finalisierte Abrechnung löschen?',
                                variant: 'danger',
                                confirmText: 'Löschen',
                                message: 'Diese Abrechnung ist bereits finalisiert. Das Löschen kann nicht rückgängig gemacht werden.',
                              });
                              if (ok) deleteMutation.mutate(report.id);
                            } else {
                              deleteMutation.mutate(report.id);
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
                    {reports?.length ? 'Keine Abrechnungen für diesen Filter' : 'Keine Abrechnungen vorhanden'}
                  </td>
                </tr>
              );
              })()}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create Modal */}
      {showCreateModal && (() => {
        // Doppel-Check: existiert bereits eine Abrechnung für MA + Jahr + Monat?
        const existingReport = selectedEmployee && selectedEmployee !== '__all__'
          ? (reports || []).find((r: any) =>
              r.employeeId === selectedEmployee && r.year === selectedYear && r.month === selectedMonth
            )
          : null;
        const blockedByDuplicate = !!existingReport;
        const blockReason = blockedByDuplicate
          ? `Für diesen Mitarbeiter existiert bereits eine Abrechnung für ${MONTHS[selectedMonth - 1]} ${selectedYear} (Status: ${
              existingReport.status === 'finalized' ? 'finalisiert' : existingReport.status === 'paid' ? 'bezahlt' : 'Entwurf'
            }).`
          : '';
        return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="text-xl font-semibold">Neue Abrechnung</h2>
              <button
                onClick={() => setShowCreateModal(false)}
                className="p-2 hover:bg-gray-100 rounded-lg"
              >
                <X size={20} />
              </button>
            </div>
            <div className="px-6 pt-4 pb-6 space-y-4">
              <div>
                <label className="label">Mitarbeiter</label>
                <select
                  value={selectedEmployee}
                  onChange={(e) => setSelectedEmployee(e.target.value)}
                  className="input"
                >
                  <option value="">Bitte wählen...</option>
                  <option value="__all__">-- Alle Mitarbeiter --</option>
                  {employees?.filter((e: any) => e.isActive && !e.isAdmin).sort((a: any, b: any) => a.lastName.localeCompare(b.lastName)).map((emp: any) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.lastName}, {emp.firstName}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Jahr</label>
                  <select
                    value={selectedYear}
                    onChange={(e) => setSelectedYear(parseInt(e.target.value))}
                    className="input"
                  >
                    {[2023, 2024, 2025, 2026].map((y) => (
                      <option key={y} value={y}>
                        {y}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label">Monat</label>
                  <select
                    value={selectedMonth}
                    onChange={(e) => setSelectedMonth(parseInt(e.target.value))}
                    className="input"
                  >
                    {MONTHS.map((m, i) => (
                      <option key={i} value={i + 1}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              {blockedByDuplicate && (
                <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
                  <AlertTriangle size={16} className="text-amber-600 shrink-0 mt-0.5" />
                  <span>{blockReason}</span>
                </div>
              )}
              <div className="flex justify-end gap-3 pt-4">
                <button
                  onClick={() => setShowCreateModal(false)}
                  className="btn btn-secondary"
                >
                  Abbrechen
                </button>
                <button
                  onClick={() => selectedEmployee === '__all__' ? handleBatchStart() : previewMutation.mutate()}
                  disabled={!selectedEmployee || previewMutation.isPending || blockedByDuplicate}
                  title={blockedByDuplicate ? blockReason : undefined}
                  className="btn btn-primary flex items-center gap-2"
                >
                  <Eye size={18} />
                  {selectedEmployee === '__all__' ? 'Alle prüfen' : 'Vorschau'}
                </button>
              </div>
            </div>
          </div>
        </div>
        );
      })()}

      {/* Preview Modal */}
      {showPreviewModal && previewData && !batchDone && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              {isBatchMode && (
                <button
                  onClick={() => navigateBatchTo(batchIndex - 1)}
                  disabled={batchIndex === 0 || previewMutation.isPending}
                  className="p-2 hover:bg-gray-100 rounded-lg disabled:opacity-30"
                >
                  <ChevronLeft size={20} />
                </button>
              )}
              <div className="text-center flex-1">
                <h2 className="text-xl font-semibold">
                  Vorschau: {previewData.period.monthName} {previewData.period.year}
                </h2>
                {isBatchMode && (
                  <p className="text-sm text-gray-500">{batchIndex + 1} / {batchEmployees.length} Mitarbeiter</p>
                )}
              </div>
              {isBatchMode && (
                <button
                  onClick={() => navigateBatchTo(batchIndex + 1)}
                  disabled={batchIndex >= batchEmployees.length - 1 || previewMutation.isPending}
                  className="p-2 hover:bg-gray-100 rounded-lg disabled:opacity-30"
                >
                  <ChevronRight size={20} />
                </button>
              )}
              <button
                onClick={() => isBatchMode ? closeBatch() : setShowPreviewModal(false)}
                className="p-2 hover:bg-gray-100 rounded-lg ml-2"
              >
                <X size={20} />
              </button>
            </div>
            <div className="px-6 pt-4 pb-6 space-y-4">
              {/* Employee Info */}
              <div className="p-4 bg-gray-50 rounded-lg">
                <h3 className="font-medium text-gray-900">{previewData.employee.name}</h3>
                <p className="text-sm text-gray-500">
                  #{previewData.employee.employeeNumber} | {previewData.employee.weeklyHours} h/Woche
                </p>
              </div>

              {/* Summary */}
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <div className="p-4 bg-blue-50 rounded-lg">
                  <p className="text-sm text-blue-600">Gesamtstunden</p>
                  <p className="text-2xl font-bold text-blue-700">
                    {formatHoursToTime(previewData.summary.totalHours)} h
                  </p>
                </div>
                <div className="p-4 bg-gray-50 rounded-lg">
                  <p className="text-sm text-gray-600">Soll-Stunden</p>
                  <p className="text-2xl font-bold text-gray-700">
                    {formatHoursToTime(previewData.summary.targetHours)} h
                  </p>
                </div>
                <div className={`p-4 rounded-lg ${previewData.summary.overtimeHours >= 0 ? 'bg-orange-50' : 'bg-red-50'}`}>
                  <p className={`text-sm ${previewData.summary.overtimeHours >= 0 ? 'text-orange-600' : 'text-red-600'}`}>Differenz Monat</p>
                  <p className={`text-2xl font-bold ${previewData.summary.overtimeHours >= 0 ? 'text-orange-700' : 'text-red-700'}`}>
                    {previewData.summary.overtimeHours >= 0 ? '+' : ''}{formatHoursToTime(previewData.summary.overtimeHours)} h
                  </p>
                </div>
                <div className="p-4 bg-purple-50 rounded-lg">
                  <p className="text-sm text-purple-600">Übertrag Vormonat</p>
                  <p className={`text-2xl font-bold ${(previewData.summary.previousOvertimeBalance || 0) >= 0 ? 'text-purple-700' : 'text-red-700'}`}>
                    {(previewData.summary.previousOvertimeBalance || 0) >= 0 ? '+' : ''}{formatHoursToTime(previewData.summary.previousOvertimeBalance || 0)} h
                  </p>
                </div>
                <div className={`p-4 rounded-lg ${(previewData.summary.cumulativeOvertimeBalance || 0) >= 0 ? 'bg-indigo-50' : 'bg-red-50'}`}>
                  <p className={`text-sm font-medium ${(previewData.summary.cumulativeOvertimeBalance || 0) >= 0 ? 'text-indigo-600' : 'text-red-600'}`}>Überstunden-Saldo</p>
                  <p className={`text-2xl font-bold ${(previewData.summary.cumulativeOvertimeBalance || 0) >= 0 ? 'text-indigo-700' : 'text-red-700'}`}>
                    {(previewData.summary.cumulativeOvertimeBalance || 0) >= 0 ? '+' : ''}{formatHoursToTime(previewData.summary.cumulativeOvertimeBalance || 0)} h
                  </p>
                </div>
                <div className="p-4 bg-green-50 rounded-lg">
                  <p className="text-sm text-green-600">Urlaubstage ({previewData.period.year})</p>
                  <p className="text-2xl font-bold text-green-700">
                    {previewData.summary.vacationDaysUsed} / {previewData.employee.vacationDaysTotal ?? previewData.employee.vacationDaysPerYear}
                  </p>
                  {previewData.summary.vacationAdjustments?.length > 0 && (
                    <div className="mt-1.5 space-y-0.5">
                      {previewData.summary.vacationAdjustments.map((a: any, i: number) => (
                        <p key={i} className={`text-xs ${a.days > 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {a.days > 0 ? '+' : ''}{a.days} Tag(e): {a.reason}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
                {(previewData.summary.sickDaysThisMonth > 0 || previewData.summary.sickDaysTotal > 0) && (
                  <div className="p-4 bg-red-50 rounded-lg">
                    <p className="text-sm text-red-600">Krankheitstage</p>
                    <p className="text-2xl font-bold text-red-700">
                      {previewData.summary.sickDaysThisMonth || 0}
                    </p>
                    <p className="text-xs text-red-500">Jahr: {previewData.summary.sickDaysTotal || 0} Tage</p>
                  </div>
                )}
              </div>

              {/* Daily Hours */}
              {previewData.dailyHours.length > 0 && (
                <div>
                  <h3 className="font-medium text-gray-900 mb-3">Tägliche Aufstellung</h3>
                  <div className="max-h-48 overflow-y-auto border rounded-lg">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 sticky top-0">
                        <tr>
                          <th className="px-4 py-2 text-left">Datum</th>
                          <th className="px-4 py-2 text-right">Stunden</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {previewData.dailyHours.map((day: any) => (
                          <tr key={day.date}>
                            <td className="px-4 py-2">
                              {format(new Date(day.date), 'EEEE, dd.MM.', { locale: de })}
                            </td>
                            <td className="px-4 py-2 text-right font-medium">
                              {formatHoursToTime(day.hours)} h
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Minusstunden-Abzug Hinweis */}
              {previewData.summary.suggestedDeductionDays > 0 && (() => {
                const days = customDeductionDays || previewData.summary.suggestedDeductionDays;
                const hours = days * 8;
                const remaining = previewData.summary.vacationDaysRemaining ?? 0;
                const overdraw = applyDeduction && days > remaining ? days - remaining : 0;
                // customDeductionDays beim ersten Anzeigen setzen
                if (customDeductionDays === 0) setCustomDeductionDays(previewData.summary.suggestedDeductionDays);
                return (
                <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
                  <div className="flex items-start gap-3">
                    <div className="p-1.5 bg-amber-100 rounded-lg shrink-0 mt-0.5">
                      <AlertTriangle size={18} className="text-amber-600" />
                    </div>
                    <div className="flex-1">
                      <h4 className="font-semibold text-amber-800">Minusstunden-Ausgleich</h4>
                      <p className="text-sm text-amber-700 mt-1">
                        Der Überstunden-Saldo beträgt <strong>{formatHoursToTime(previewData.summary.cumulativeOvertimeBalance)} h</strong>.
                        Vorschlag: {previewData.summary.suggestedDeductionDays} Tag(e) abziehen.
                        {' '}Resturlaub: <strong>{remaining}</strong> Tag(e).
                      </p>
                      <div className="flex items-center gap-3 mt-3">
                        <label className="flex items-center gap-2">
                          <input type="checkbox" checked={applyDeduction} onChange={e => setApplyDeduction(e.target.checked)} className="rounded" />
                          <span className="text-sm text-amber-800 font-medium">Urlaubsabzug</span>
                        </label>
                        {applyDeduction && (
                          <div className="flex items-center gap-2">
                            <input type="number" min={1} max={previewData.summary.suggestedDeductionDays} value={customDeductionDays}
                              onChange={e => setCustomDeductionDays(Math.max(1, Math.min(previewData.summary.suggestedDeductionDays, parseInt(e.target.value) || 1)))}
                              className="w-16 px-2 py-1 border border-amber-300 rounded text-sm text-center" />
                            <span className="text-sm text-amber-700">Tag(e) = {hours}h Gutschrift</span>
                          </div>
                        )}
                      </div>
                      {overdraw > 0 && (
                        <div className="mt-3 p-3 bg-red-50 border border-red-300 rounded-lg flex items-start gap-2">
                          <AlertTriangle size={16} className="text-red-600 shrink-0 mt-0.5" />
                          <p className="text-sm text-red-800">
                            <strong>Achtung:</strong> Der Mitarbeiter hat nur noch <strong>{remaining}</strong> Resturlaubstag(e),
                            du ziehst aber <strong>{days}</strong> ab. Das ergibt einen Urlaubssaldo von <strong>-{overdraw}</strong> Tag(en),
                            der ins nächste Jahr übernommen wird.
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                );
              })()}

              <div className="flex justify-between gap-3 pt-4 border-t flex-wrap">
                <div className="flex gap-2">
                  <button
                    onClick={() => isBatchMode ? closeBatch() : setShowPreviewModal(false)}
                    className="btn btn-secondary"
                  >
                    Abbrechen
                  </button>
                  <button
                    onClick={() => {
                      setUploadPrefill({
                        employeeId: selectedEmployee,
                        year: selectedYear,
                        month: selectedMonth,
                        lock: true,
                      });
                      setUploadModalOpen(true);
                    }}
                    className="btn btn-secondary flex items-center gap-2"
                    title="Externes Dokument für diesen Mitarbeiter & Monat hochladen"
                  >
                    <Upload size={16} />
                    Dokument hochladen
                  </button>
                </div>
                <div className="flex gap-2">
                  {isBatchMode && (
                    <button
                      onClick={() => {
                        setBatchSkipped(prev => new Set(prev).add(selectedEmployee));
                        navigateBatchNext();
                      }}
                      disabled={createMutation.isPending}
                      className="btn btn-secondary"
                    >
                      Überspringen
                    </button>
                  )}
                  <button
                    onClick={async () => {
                      const remaining = previewData.summary.vacationDaysRemaining ?? 0;
                      const willDeduct = applyDeduction && customDeductionDays > 0;
                      if (willDeduct && customDeductionDays > remaining) {
                        const overdraw = customDeductionDays - remaining;
                        const name = previewData.employee.name;
                        const ok = await confirm({
                          title: 'Urlaubssaldo wird negativ',
                          variant: 'warning',
                          confirmText: 'Trotzdem abziehen',
                          message: (
                            <div className="space-y-2">
                              <p><strong>{name}</strong> hat nur noch <strong>{remaining}</strong> Resturlaubstag(e), du ziehst aber <strong>{customDeductionDays}</strong> ab.</p>
                              <p>Das ergibt einen Urlaubssaldo von <strong className="text-red-600">−{overdraw} Tag(en)</strong>, der ins nächste Jahr übernommen wird.</p>
                            </div>
                          ),
                        });
                        if (!ok) return;
                      }
                      createMutation.mutate({
                        employeeId: selectedEmployee,
                        year: selectedYear,
                        month: selectedMonth,
                        applyVacationDeduction: willDeduct,
                        deductionDays: customDeductionDays,
                      } as any);
                    }}
                    disabled={createMutation.isPending}
                    className="btn btn-primary flex items-center gap-2"
                  >
                    <FileText size={18} />
                    {isBatchMode ? 'Erstellen & Weiter' : 'Abrechnung erstellen'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Batch-Zusammenfassung */}
      {batchDone && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 text-center">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <FileText size={32} className="text-green-600" />
            </div>
            <h2 className="text-xl font-semibold mb-2">Sammelabrechnung abgeschlossen</h2>
            <p className="text-gray-600 mb-4">
              {MONTHS[selectedMonth - 1]} {selectedYear}
            </p>
            <div className="grid grid-cols-2 gap-4 mb-6">
              <div className="p-3 bg-green-50 rounded-lg">
                <p className="text-2xl font-bold text-green-600">{batchCreated.size}</p>
                <p className="text-sm text-gray-500">Erstellt</p>
              </div>
              <div className="p-3 bg-gray-50 rounded-lg">
                <p className="text-2xl font-bold text-gray-600">{batchSkipped.size}</p>
                <p className="text-sm text-gray-500">Übersprungen</p>
              </div>
            </div>
            <button onClick={closeBatch} className="btn btn-primary w-full">
              Schließen
            </button>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {showEditModal && editingReport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg">
            <div className="p-6 border-b border-gray-100 flex items-center justify-between">
              <h2 className="text-xl font-semibold">
                Abrechnung bearbeiten
              </h2>
              <button
                onClick={() => {
                  setShowEditModal(false);
                  setEditingReport(null);
                }}
                className="p-2 hover:bg-gray-100 rounded-lg"
              >
                <X size={20} />
              </button>
            </div>
            <div className="p-6 space-y-4">
              {/* Report Info */}
              <div className="p-4 bg-gray-50 rounded-lg">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-medium text-gray-900">
                      {editingReport.employee.firstName} {editingReport.employee.lastName}
                    </h3>
                    <p className="text-sm text-gray-500">
                      #{editingReport.employee.employeeNumber} | {MONTHS[editingReport.month - 1]} {editingReport.year}
                    </p>
                  </div>
                  {getStatusBadge(editingReport.status)}
                </div>
              </div>

              {/* Current Values */}
              <div className="grid grid-cols-2 gap-4">
                <div className="p-3 bg-blue-50 rounded-lg">
                  <p className="text-xs text-blue-600">Gesamtstunden</p>
                  <p className="text-xl font-bold text-blue-700">
                    {formatHoursToTime(editingReport.totalHours)} h
                  </p>
                </div>
                <div className="p-3 bg-gray-50 rounded-lg">
                  <p className="text-xs text-gray-600">Soll-Stunden</p>
                  <p className="text-xl font-bold text-gray-700">
                    {formatHoursToTime(editingReport.targetHours)} h
                  </p>
                </div>
                <div className={`p-3 rounded-lg ${editingReport.overtimeHours >= 0 ? 'bg-orange-50' : 'bg-red-50'}`}>
                  <p className={`text-xs ${editingReport.overtimeHours >= 0 ? 'text-orange-600' : 'text-red-600'}`}>Differenz Monat</p>
                  <p className={`text-xl font-bold ${editingReport.overtimeHours >= 0 ? 'text-orange-700' : 'text-red-700'}`}>
                    {editingReport.overtimeHours >= 0 ? '+' : ''}{formatHoursToTime(editingReport.overtimeHours)} h
                  </p>
                </div>
                <div className="p-3 bg-purple-50 rounded-lg">
                  <p className="text-xs text-purple-600">Übertrag Vormonat</p>
                  <p className={`text-xl font-bold ${(editingReport.previousOvertimeBalance || 0) >= 0 ? 'text-purple-700' : 'text-red-700'}`}>
                    {(editingReport.previousOvertimeBalance || 0) >= 0 ? '+' : ''}{formatHoursToTime(editingReport.previousOvertimeBalance || 0)} h
                  </p>
                </div>
                <div className={`p-3 rounded-lg ${(editingReport.cumulativeOvertimeBalance || 0) >= 0 ? 'bg-indigo-50' : 'bg-red-50'}`}>
                  <p className={`text-xs font-medium ${(editingReport.cumulativeOvertimeBalance || 0) >= 0 ? 'text-indigo-600' : 'text-red-600'}`}>Überstunden-Saldo</p>
                  <p className={`text-xl font-bold ${(editingReport.cumulativeOvertimeBalance || 0) >= 0 ? 'text-indigo-700' : 'text-red-700'}`}>
                    {(editingReport.cumulativeOvertimeBalance || 0) >= 0 ? '+' : ''}{formatHoursToTime(editingReport.cumulativeOvertimeBalance || 0)} h
                  </p>
                </div>
                <div className="p-3 bg-green-50 rounded-lg">
                  <p className="text-xs text-green-600">Urlaubstage</p>
                  <p className="text-xl font-bold text-green-700">
                    {editingReport.vacationDaysUsed ?? 0} genommen
                  </p>
                </div>
                {(editingReport.sickDaysThisMonth > 0 || editingReport.sickDaysTotal > 0) && (
                  <div className="p-3 bg-red-50 rounded-lg">
                    <p className="text-xs text-red-600">Krankheitstage</p>
                    <p className="text-xl font-bold text-red-700">
                      {editingReport.sickDaysThisMonth || 0} <span className="text-sm font-normal">(Jahr: {editingReport.sickDaysTotal || 0})</span>
                    </p>
                  </div>
                )}
              </div>

              {/* Instructions */}
              <div className={`p-4 rounded-lg text-sm ${editingReport.status === 'finalized' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'}`}>
                <p className="font-medium mb-1">
                  {editingReport.status === 'finalized' ? 'Achtung - Finalisierte Abrechnung:' : 'Hinweis:'}
                </p>
                <p>
                  {editingReport.status === 'finalized'
                    ? 'Diese Abrechnung ist bereits finalisiert. "Neu berechnen" setzt den Status zurück auf Entwurf und löscht die bestehende PDF.'
                    : 'Zeiteinträge können in der Mitarbeiter-Verwaltung bearbeitet werden. Nach Änderungen hier "Neu berechnen" klicken.'}
                </p>
              </div>

              {/* Actions */}
              <div className="flex flex-col gap-3 pt-4 border-t">
                <button
                  onClick={() => {
                    navigate(`/admin/employees?edit=${editingReport.employeeId}&month=${editingReport.year}-${String(editingReport.month).padStart(2, '0')}`);
                    setShowEditModal(false);
                  }}
                  className="btn btn-secondary flex items-center justify-center gap-2"
                >
                  <Calendar size={18} />
                  Zeiteinträge bearbeiten
                </button>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => recalculateMutation.mutate(editingReport.id)}
                    disabled={recalculateMutation.isPending}
                    className="btn btn-secondary flex items-center justify-center gap-2"
                  >
                    {recalculateMutation.isPending ? (
                      <>
                        <div className="w-4 h-4 border-2 border-gray-500 border-t-transparent rounded-full animate-spin" />
                        Berechne...
                      </>
                    ) : (
                      <>
                        <RefreshCw size={18} />
                        Neu berechnen
                      </>
                    )}
                  </button>
                  <button
                    onClick={() => handlePreviewPdf(editingReport)}
                    disabled={isPreviewLoading}
                    className="btn btn-secondary flex items-center justify-center gap-2"
                  >
                    {isPreviewLoading ? (
                      <>
                        <div className="w-4 h-4 border-2 border-gray-500 border-t-transparent rounded-full animate-spin" />
                        PDF...
                      </>
                    ) : (
                      <>
                        <Download size={18} />
                        PDF-Vorschau
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Dokumenten-Upload-Modal — sowohl aus Listenansicht als auch aus Vorschau-Modal */}
      <DocumentUploadModal
        isOpen={uploadModalOpen}
        onClose={() => setUploadModalOpen(false)}
        defaultEmployeeId={uploadPrefill.employeeId}
        defaultYear={uploadPrefill.year}
        defaultMonth={uploadPrefill.month}
        lockEmployee={uploadPrefill.lock}
        lockPeriod={uploadPrefill.lock}
      />
    </div>
  );
}
