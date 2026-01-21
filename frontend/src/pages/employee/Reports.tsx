import { useQuery } from '@tanstack/react-query';
import { reportsApi, formatNumber } from '../../lib/api';
import { FileText, Download, Clock, TrendingUp } from 'lucide-react';
import toast from 'react-hot-toast';

// Formatiert Dezimalstunden zu H:MM Format (nur volle Minuten, keine Sekunden)
const formatHoursToTime = (hours: number): string => {
  const h = Math.floor(hours);
  const m = Math.floor((hours - h) * 60);
  return `${h}:${m.toString().padStart(2, '0')}`;
};

const MONTHS = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
];

export default function EmployeeReports() {
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
      link.setAttribute('download', `Abrechnung_${year}_${String(month).padStart(2, '0')}.pdf`);
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

      {isLoading ? (
        <div className="flex items-center justify-center h-64">
          <div className="w-8 h-8 border-4 border-primary-600 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : reports?.length ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {reports.map((report: any) => (
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
                      <span>Überstunden</span>
                    </div>
                    <span
                      className={`font-medium ${
                        report.overtimeHours > 0 ? 'text-orange-600' : 'text-gray-900'
                      }`}
                    >
                      {report.overtimeHours > 0 ? '+' : ''}
                      {formatHoursToTime(report.overtimeHours)} h
                    </span>
                  </div>

                  <div className="pt-3 border-t border-gray-100">
                    <div className="flex items-center justify-between">
                      <span className="text-gray-500">Bruttolohn</span>
                      <span className="text-xl font-bold text-gray-900">
                        {formatNumber(report.grossPay)} EUR
                      </span>
                    </div>
                  </div>
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
