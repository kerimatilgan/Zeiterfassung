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
    const variants: Record<string, { bg: string; text: string; dot: string; label: string }> = {
      draft: { bg: 'bg-yellow-100 dark:bg-yellow-900/40', text: 'text-yellow-700 dark:text-yellow-300', dot: 'bg-yellow-500', label: 'In Bearbeitung' },
      finalized: { bg: 'bg-green-100 dark:bg-green-900/40', text: 'text-green-700 dark:text-green-300', dot: 'bg-green-500', label: 'Fertig' },
      paid: { bg: 'bg-blue-100 dark:bg-blue-900/40', text: 'text-blue-700 dark:text-blue-300', dot: 'bg-blue-500', label: 'Ausgezahlt' },
    };
    const v = variants[status];
    if (!v) return null;
    return (
      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 font-label-md text-label-md rounded-full ${v.bg} ${v.text}`}>
        <span className={`w-1.5 h-1.5 rounded-full ${v.dot}`} />
        {v.label}
      </span>
    );
  };

  const selectCls = 'w-full bg-surface-container-lowest dark:bg-surface-container border border-outline-variant rounded-lg px-3 py-1.5 font-body-md text-body-md text-on-surface focus:outline-none focus:ring-2 focus:ring-primary-container focus:border-transparent';

  const emptyCard = (title: string, subtitle?: string) => (
    <div className="bg-surface dark:bg-surface-container-high border border-outline-variant rounded-xl shadow-sm p-stack_lg py-stack_lg text-center">
      <div className="inline-flex items-center justify-center w-16 h-16 bg-surface-container-high dark:bg-surface-container-highest rounded-full mb-stack_md">
        <FileText className="w-8 h-8 text-on-surface-variant" />
      </div>
      <h3 className="font-headline-md text-headline-md font-semibold text-on-surface">{title}</h3>
      {subtitle && <p className="font-body-md text-body-md text-on-surface-variant mt-1">{subtitle}</p>}
    </div>
  );

  return (
    <div className="space-y-stack_lg">
      <header>
        <h1 className="font-display text-display text-on-surface">Meine Abrechnungen</h1>
        <p className="font-body-md text-body-md text-on-surface-variant mt-1">Übersicht deiner Monatsabrechnungen mit PDF-Download.</p>
      </header>

      {/* Filter-Toolbar */}
      <div className="bg-surface dark:bg-surface-container-high border border-outline-variant rounded-xl shadow-sm p-stack_md">
        <div className="flex flex-wrap items-end gap-stack_md">
          <div className="flex items-center gap-2 text-on-surface-variant pb-1.5">
            <Filter size={18} />
            <span className="font-body-md text-body-md font-medium">Filter:</span>
          </div>
          <div className="min-w-[100px] flex flex-col gap-1">
            <label className="font-label-md text-label-md uppercase text-on-surface-variant">Jahr</label>
            <select value={filterYear} onChange={(e) => setFilterYear(e.target.value ? parseInt(e.target.value) : '')} className={selectCls}>
              <option value="">Alle</option>
              {[2023, 2024, 2025, 2026, 2027].map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
          <div className="min-w-[120px] flex flex-col gap-1">
            <label className="font-label-md text-label-md uppercase text-on-surface-variant">Monat</label>
            <select value={filterMonth} onChange={(e) => setFilterMonth(e.target.value ? parseInt(e.target.value) : '')} className={selectCls}>
              <option value="">Alle</option>
              {MONTHS.map((m, i) => (
                <option key={i} value={i + 1}>{m}</option>
              ))}
            </select>
          </div>
          {(filterYear || filterMonth) && (
            <button
              onClick={() => { setFilterYear(''); setFilterMonth(''); }}
              className="font-body-md text-body-md text-primary-container hover:underline pb-1.5"
            >
              Zurücksetzen
            </button>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-64">
          <div className="w-8 h-8 border-4 border-primary-container border-t-transparent rounded-full animate-spin" />
        </div>
      ) : reports?.length ? (() => {
        const filteredReports = reports.filter((r: any) => {
          if (filterYear && r.year !== filterYear) return false;
          if (filterMonth && r.month !== filterMonth) return false;
          return true;
        });
        return filteredReports.length ? (
        <div className="grid gap-gutter md:grid-cols-2 lg:grid-cols-3">
          {filteredReports.map((report: any) => (
            <div key={report.id} className="bg-surface dark:bg-surface-container-high border border-outline-variant rounded-xl shadow-sm overflow-hidden flex flex-col">
              <div className="p-stack_lg flex-1">
                <div className="flex items-start justify-between mb-stack_md">
                  <div>
                    <h3 className="font-headline-md text-headline-md font-semibold text-on-surface">
                      {MONTHS[report.month - 1]} {report.year}
                    </h3>
                    <div className="mt-2">{getStatusBadge(report.status)}</div>
                  </div>
                  <div className="p-2 bg-primary-container/10 dark:bg-primary-container/20 rounded-lg">
                    <FileText className="w-5 h-5 text-primary-container" />
                  </div>
                </div>

                <div className="space-y-stack_sm">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-on-surface-variant">
                      <Clock size={16} />
                      <span className="font-body-md text-body-md">Arbeitsstunden</span>
                    </div>
                    <span className="font-body-md text-body-md font-semibold text-on-surface">
                      {formatHoursToTime(report.totalHours)} h
                    </span>
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-on-surface-variant">
                      <TrendingUp size={16} />
                      <span className="font-body-md text-body-md">Differenz Monat</span>
                    </div>
                    <span
                      className={`font-body-md text-body-md font-medium ${
                        report.overtimeHours >= 0 ? 'text-orange-600 dark:text-orange-400' : 'text-red-600 dark:text-red-400'
                      }`}
                    >
                      {report.overtimeHours >= 0 ? '+' : ''}
                      {formatHoursToTime(report.overtimeHours)} h
                    </span>
                  </div>

                  <div className="flex items-center justify-between pt-stack_sm border-t border-outline-variant">
                    <div className="flex items-center gap-2 text-on-surface">
                      <Activity size={16} />
                      <span className="font-body-md text-body-md font-semibold">Überstunden-Saldo</span>
                    </div>
                    <span
                      className={`font-headline-md text-headline-md font-bold ${
                        (report.cumulativeOvertimeBalance || 0) >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
                      }`}
                    >
                      {(report.cumulativeOvertimeBalance || 0) >= 0 ? '+' : ''}
                      {formatHoursToTime(report.cumulativeOvertimeBalance || 0)} h
                    </span>
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-on-surface-variant">
                      <Umbrella size={16} />
                      <span className="font-body-md text-body-md">Urlaubstage</span>
                    </div>
                    <span className="font-body-md text-body-md font-medium text-on-surface">
                      {report.vacationDaysUsed ?? 0} / {report.vacationDaysRemaining != null ? report.vacationDaysUsed + report.vacationDaysRemaining : '-'}
                    </span>
                  </div>

                  {(report.sickDaysThisMonth > 0 || report.sickDaysTotal > 0) && (
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-on-surface-variant">
                        <ThermometerSun size={16} />
                        <span className="font-body-md text-body-md">Krankheitstage</span>
                      </div>
                      <span className="font-body-md text-body-md font-medium text-red-600 dark:text-red-400">
                        {report.sickDaysThisMonth || 0} <span className="font-label-md text-label-md text-on-surface-variant">(Jahr: {report.sickDaysTotal || 0})</span>
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {report.status === 'finalized' && report.pdfPath && (
                <div className="px-stack_lg py-stack_md bg-surface-container-low dark:bg-surface-container border-t border-outline-variant">
                  <button
                    onClick={() => handleDownload(report.id, report.year, report.month)}
                    className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-primary-container hover:bg-primary-container/90 text-on-primary-container font-body-md text-body-md font-medium transition-colors shadow-sm"
                  >
                    <Download size={18} />
                    PDF herunterladen
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
        ) : emptyCard('Keine Abrechnungen für diesen Filter');
      })() : emptyCard(
        'Noch keine Abrechnungen',
        'Sobald dein Administrator eine Abrechnung erstellt, wird sie hier angezeigt.'
      )}
    </div>
  );
}
