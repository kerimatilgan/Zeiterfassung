import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { reportsApi } from '../../lib/api';
import { useAuthStore } from '../../store/authStore';
import { FileText, Download, Clock, TrendingUp, Umbrella, Activity, ThermometerSun, Filter } from 'lucide-react';
import toast from 'react-hot-toast';

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

export default function EmployeeReports() {
  const { employee } = useAuthStore();
  const [filterYear, setFilterYear] = useState<number | ''>(new Date().getFullYear());
  const [filterMonth, setFilterMonth] = useState<number | ''>('');

  const { data: reports, isLoading } = useQuery({
    queryKey: ['my-reports'],
    queryFn: () => reportsApi.getMy().then((r) => r.data),
  });

  const handleDownload = async (id: string, year: number, month: number) => {
    try {
      const response = await reportsApi.downloadPdf(id);
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `${employee?.lastName}_${employee?.firstName}_${String(month).padStart(2, '0')}_${year}.pdf`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      toast.success('PDF heruntergeladen');
    } catch (error) {
      toast.error('Fehler beim Herunterladen');
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'draft':
        return (
          <span className="px-3 py-1 text-sm font-medium rounded-full bg-yellow-100 text-yellow-700">
            In Bearbeitung
          </span>
        );
      case 'finalized':
        return (
          <span className="px-3 py-1 text-sm font-medium rounded-full bg-green-100 text-green-700">
            Fertig
          </span>
        );
      case 'paid':
        return (
          <span className="px-3 py-1 text-sm font-medium rounded-full bg-blue-100 text-blue-700">
            Ausgezahlt
          </span>
        );
      default:
        return null;
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Meine Abrechnungen</h1>
        <p className="text-gray-500">Übersicht deiner Monatsabrechnungen</p>
      </div>

      {/* Filters */}
      <div className="card p-4">
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex items-center gap-2 text-gray-500">
            <Filter size={18} />
            <span className="text-sm font-medium">Filter:</span>
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
          {(filterYear || filterMonth) && (
            <button
              onClick={() => { setFilterYear(''); setFilterMonth(''); }}
              className="text-sm text-primary-600 hover:text-primary-700 hover:underline pb-1"
            >
              Zurücksetzen
            </button>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-64">
          <div className="w-8 h-8 border-4 border-primary-600 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : reports?.length ? (() => {
        const filteredReports = reports.filter((r: any) => {
          if (filterYear && r.year !== filterYear) return false;
          if (filterMonth && r.month !== filterMonth) return false;
          return true;
        });
        return filteredReports.length ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredReports.map((report: any) => (
            <div key={report.id} className="card overflow-hidden">
              <div className="p-6">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900">
                      {MONTHS[report.month - 1]} {report.year}
                    </h3>
                    {getStatusBadge(report.status)}
                  </div>
                  <div className="p-2 bg-primary-100 rounded-lg">
                    <FileText className="w-5 h-5 text-primary-600" />
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-gray-500">
                      <Clock size={16} />
                      <span>Arbeitsstunden</span>
                    </div>
                    <span className="font-medium text-gray-900">
                      {formatHoursToTime(report.totalHours)} h
                    </span>
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-gray-500">
                      <TrendingUp size={16} />
                      <span>Differenz Monat</span>
                    </div>
                    <span
                      className={`font-medium ${
                        report.overtimeHours >= 0 ? 'text-orange-600' : 'text-red-600'
                      }`}
                    >
                      {report.overtimeHours >= 0 ? '+' : ''}
                      {formatHoursToTime(report.overtimeHours)} h
                    </span>
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-gray-500">
                      <Activity size={16} />
                      <span className="font-semibold">Überstunden-Saldo</span>
                    </div>
                    <span
                      className={`font-bold ${
                        (report.cumulativeOvertimeBalance || 0) >= 0 ? 'text-green-600' : 'text-red-600'
                      }`}
                    >
                      {(report.cumulativeOvertimeBalance || 0) >= 0 ? '+' : ''}
                      {formatHoursToTime(report.cumulativeOvertimeBalance || 0)} h
                    </span>
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-gray-500">
                      <Umbrella size={16} />
                      <span>Urlaubstage</span>
                    </div>
                    <span className="font-medium text-gray-900">
                      {report.vacationDaysUsed ?? 0} / {report.vacationDaysRemaining != null ? report.vacationDaysUsed + report.vacationDaysRemaining : '-'}
                    </span>
                  </div>

                  {(report.sickDaysThisMonth > 0 || report.sickDaysTotal > 0) && (
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-gray-500">
                        <ThermometerSun size={16} />
                        <span>Krankheitstage</span>
                      </div>
                      <span className="font-medium text-red-600">
                        {report.sickDaysThisMonth || 0} <span className="text-xs text-gray-500">(Jahr: {report.sickDaysTotal || 0})</span>
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {report.status === 'finalized' && report.pdfPath && (
                <div className="px-6 py-4 bg-gray-50 border-t border-gray-100">
                  <button
                    onClick={() => handleDownload(report.id, report.year, report.month)}
                    className="btn btn-primary w-full flex items-center justify-center gap-2"
                  >
                    <Download size={18} />
                    PDF herunterladen
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
        ) : (
        <div className="card p-12 text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-gray-100 rounded-full mb-4">
            <FileText className="w-8 h-8 text-gray-400" />
          </div>
          <h3 className="text-lg font-medium text-gray-900 mb-2">
            Keine Abrechnungen für diesen Filter
          </h3>
        </div>
        );
      })() : (
        <div className="card p-12 text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-gray-100 rounded-full mb-4">
            <FileText className="w-8 h-8 text-gray-400" />
          </div>
          <h3 className="text-lg font-medium text-gray-900 mb-2">
            Noch keine Abrechnungen
          </h3>
          <p className="text-gray-500">
            Sobald dein Administrator eine Abrechnung erstellt, wird sie hier angezeigt.
          </p>
        </div>
      )}
    </div>
  );
}
