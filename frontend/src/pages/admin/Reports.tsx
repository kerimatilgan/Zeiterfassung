import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { reportsApi, employeesApi } from '../../lib/api';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import toast from 'react-hot-toast';
import { FileText, Download, Check, Trash2, Eye, Plus, X } from 'lucide-react';

const MONTHS = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
];

export default function AdminReports() {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [previewData, setPreviewData] = useState<any>(null);
  const [selectedEmployee, setSelectedEmployee] = useState('');
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1);

  const queryClient = useQueryClient();

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
      toast.success('Abrechnung erstellt');
      setShowCreateModal(false);
      setShowPreviewModal(false);
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
        <button
          onClick={() => setShowCreateModal(true)}
          className="btn btn-primary flex items-center gap-2"
        >
          <Plus size={20} />
          Neue Abrechnung
        </button>
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
                  Brutto
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
                  <td colSpan={6} className="px-6 py-8 text-center text-gray-500">
                    Laden...
                  </td>
                </tr>
              ) : reports?.length ? (
                reports.map((report: any) => (
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
                      <p className="text-gray-900">{report.totalHours.toFixed(2)} h</p>
                      {report.overtimeHours > 0 && (
                        <p className="text-sm text-orange-600">
                          +{report.overtimeHours.toFixed(2)} h Überstunden
                        </p>
                      )}
                    </td>
                    <td className="px-6 py-4 font-medium text-gray-900">
                      {report.grossPay.toFixed(2)} EUR
                    </td>
                    <td className="px-6 py-4">{getStatusBadge(report.status)}</td>
                    <td className="px-6 py-4">
                      <div className="flex items-center justify-end gap-2">
                        {report.status === 'draft' && (
                          <>
                            <button
                              onClick={() => finalizeMutation.mutate(report.id)}
                              className="p-2 text-gray-500 hover:text-green-600 hover:bg-green-50 rounded-lg"
                              title="Finalisieren"
                            >
                              <Check size={18} />
                            </button>
                            <button
                              onClick={() => deleteMutation.mutate(report.id)}
                              className="p-2 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg"
                              title="Löschen"
                            >
                              <Trash2 size={18} />
                            </button>
                          </>
                        )}
                        {report.pdfPath && (
                          <button
                            onClick={() =>
                              handleDownload(report.id, `Abrechnung_${report.employee.employeeNumber}_${report.year}_${report.month}.pdf`)
                            }
                            className="p-2 text-gray-500 hover:text-primary-600 hover:bg-primary-50 rounded-lg"
                            title="PDF herunterladen"
                          >
                            <Download size={18} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-gray-500">
                    Keine Abrechnungen vorhanden
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
            <div className="p-6 border-b border-gray-100 flex items-center justify-between">
              <h2 className="text-xl font-semibold">Neue Abrechnung</h2>
              <button
                onClick={() => setShowCreateModal(false)}
                className="p-2 hover:bg-gray-100 rounded-lg"
              >
                <X size={20} />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="label">Mitarbeiter</label>
                <select
                  value={selectedEmployee}
                  onChange={(e) => setSelectedEmployee(e.target.value)}
                  className="input"
                >
                  <option value="">Bitte wählen...</option>
                  {employees?.map((emp: any) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.firstName} {emp.lastName}
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
              <div className="flex justify-end gap-3 pt-4">
                <button
                  onClick={() => setShowCreateModal(false)}
                  className="btn btn-secondary"
                >
                  Abbrechen
                </button>
                <button
                  onClick={() => previewMutation.mutate()}
                  disabled={!selectedEmployee || previewMutation.isPending}
                  className="btn btn-primary flex items-center gap-2"
                >
                  <Eye size={18} />
                  Vorschau
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Preview Modal */}
      {showPreviewModal && previewData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-gray-100 flex items-center justify-between">
              <h2 className="text-xl font-semibold">
                Vorschau: {previewData.period.monthName} {previewData.period.year}
              </h2>
              <button
                onClick={() => setShowPreviewModal(false)}
                className="p-2 hover:bg-gray-100 rounded-lg"
              >
                <X size={20} />
              </button>
            </div>
            <div className="p-6 space-y-6">
              {/* Employee Info */}
              <div className="p-4 bg-gray-50 rounded-lg">
                <h3 className="font-medium text-gray-900">{previewData.employee.name}</h3>
                <p className="text-sm text-gray-500">
                  #{previewData.employee.employeeNumber} | {previewData.employee.hourlyRate.toFixed(2)} EUR/h
                </p>
              </div>

              {/* Summary */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="p-4 bg-blue-50 rounded-lg">
                  <p className="text-sm text-blue-600">Gesamtstunden</p>
                  <p className="text-2xl font-bold text-blue-700">
                    {previewData.summary.totalHours.toFixed(2)}
                  </p>
                </div>
                <div className="p-4 bg-gray-50 rounded-lg">
                  <p className="text-sm text-gray-600">Soll-Stunden</p>
                  <p className="text-2xl font-bold text-gray-700">
                    {previewData.summary.targetHours.toFixed(2)}
                  </p>
                </div>
                <div className="p-4 bg-orange-50 rounded-lg">
                  <p className="text-sm text-orange-600">Überstunden</p>
                  <p className="text-2xl font-bold text-orange-700">
                    {previewData.summary.overtimeHours.toFixed(2)}
                  </p>
                </div>
                <div className="p-4 bg-green-50 rounded-lg">
                  <p className="text-sm text-green-600">Bruttolohn</p>
                  <p className="text-2xl font-bold text-green-700">
                    {previewData.summary.grossPay.toFixed(2)} EUR
                  </p>
                </div>
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
                              {day.hours.toFixed(2)} h
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-3 pt-4 border-t">
                <button
                  onClick={() => setShowPreviewModal(false)}
                  className="btn btn-secondary"
                >
                  Abbrechen
                </button>
                <button
                  onClick={() =>
                    createMutation.mutate({
                      employeeId: selectedEmployee,
                      year: selectedYear,
                      month: selectedMonth,
                    })
                  }
                  disabled={createMutation.isPending}
                  className="btn btn-primary flex items-center gap-2"
                >
                  <FileText size={18} />
                  Abrechnung erstellen
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
