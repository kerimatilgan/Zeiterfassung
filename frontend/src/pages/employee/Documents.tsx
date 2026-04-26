import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { documentsApi, settingsApi, reportsApi } from '../../lib/api';
import { useAuthStore } from '../../store/authStore';
import { Download, Filter, FolderOpen, CheckCircle2, PenLine, X } from 'lucide-react';
import toast from 'react-hot-toast';

const MONTHS = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
];

const formatFileSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const REPORT_TYPE = { id: '__report__', name: 'Stundenabrechnung', shortName: 'SA', color: '#0EA5E9' };

export default function EmployeeDocuments() {
  const { employee } = useAuthStore();
  const queryClient = useQueryClient();
  const [filterType, setFilterType] = useState('');
  const [filterYear, setFilterYear] = useState<number | ''>('');
  const [filterMonth, setFilterMonth] = useState<number | ''>('');
  const [signDoc, setSignDoc] = useState<any | null>(null);
  const [signPassword, setSignPassword] = useState('');

  const { data: documents, isLoading } = useQuery({
    queryKey: ['my-documents'],
    queryFn: () => documentsApi.getMy().then((r) => r.data),
  });

  // Beim Öffnen der Page: alle ungelesenen Dokumente UND Abrechnungen als
  // gelesen markieren (entfernt Banner aus dem Dashboard).
  useEffect(() => {
    Promise.all([
      documentsApi.markAllViewed().catch(() => null),
      reportsApi.markAllViewed().catch(() => null),
    ]).then(([docRes, repRes]) => {
      if ((docRes as any)?.data?.markedAsRead > 0) {
        queryClient.invalidateQueries({ queryKey: ['my-documents'] });
      }
      if ((repRes as any)?.data?.markedAsRead > 0) {
        queryClient.invalidateQueries({ queryKey: ['my-reports'] });
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const signMutation = useMutation({
    mutationFn: ({ id, password }: { id: string; password: string }) => documentsApi.sign(id, password),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-documents'] });
      toast.success('Info-Schreiben digital bestätigt');
      setSignDoc(null);
      setSignPassword('');
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.error || 'Fehler bei der Signatur');
    },
  });

  const { data: reports, isLoading: reportsLoading } = useQuery({
    queryKey: ['my-reports'],
    queryFn: () => reportsApi.getMy().then((r) => r.data),
  });

  const { data: documentTypes } = useQuery({
    queryKey: ['document-types'],
    queryFn: () => settingsApi.getDocumentTypes().then((r) => r.data),
  });

  // Merge document types with virtual "Stundenabrechnung"
  const allTypes = [...(documentTypes || []), REPORT_TYPE];

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

  const handleReportDownload = async (report: any) => {
    try {
      const response = await reportsApi.downloadPdf(report._reportId);
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `${employee?.lastName}_${employee?.firstName}_${String(report.month).padStart(2, '0')}_${report.year}.pdf`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch {
      toast.error('Fehler beim Herunterladen');
    }
  };

  // Convert reports to document-like objects
  const reportDocs = (reports || [])
    .filter((r: any) => r.status === 'finalized' && r.pdfPath)
    .map((r: any) => ({
      id: `report-${r.id}`,
      _isReport: true,
      _reportId: r.id,
      documentTypeId: REPORT_TYPE.id,
      documentType: REPORT_TYPE,
      firstViewedAt: r.firstViewedAt,
      originalFilename: `${employee?.lastName}_${employee?.firstName}_${String(r.month).padStart(2, '0')}_${r.year}.pdf`,
      fileSize: 0,
      year: r.year,
      month: r.month,
      note: null,
      createdAt: r.finalizedAt || r.createdAt,
    }));

  // Merge and filter
  const allDocuments = [...(documents || []), ...reportDocs];

  const filteredDocuments = allDocuments.filter((doc: any) => {
    if (filterType && doc.documentTypeId !== filterType) return false;
    if (filterYear && doc.year !== filterYear) return false;
    if (filterMonth && doc.month !== filterMonth) return false;
    return true;
  });

  // Sort: newest first
  filteredDocuments.sort((a: any, b: any) => {
    const yearDiff = (b.year || 0) - (a.year || 0);
    if (yearDiff !== 0) return yearDiff;
    const monthDiff = (b.month || 0) - (a.month || 0);
    if (monthDiff !== 0) return monthDiff;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  const loading = isLoading || reportsLoading;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Meine Dokumente</h1>
        <p className="text-gray-500">Gehaltsabrechnungen, Verträge und weitere Dokumente</p>
      </div>

      {/* Filters */}
      <div className="card p-4">
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex items-center gap-2 text-gray-500">
            <Filter size={18} />
            <span className="text-sm font-medium">Filter:</span>
          </div>
          <div className="min-w-[180px]">
            <label className="label text-xs">Dokumenttyp</label>
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              className="input py-1.5 text-sm"
            >
              <option value="">Alle</option>
              {allTypes.map((dt: any) => (
                <option key={dt.id} value={dt.id}>{dt.name}</option>
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
          {(filterType || filterYear || filterMonth) && (
            <button
              onClick={() => { setFilterType(''); setFilterYear(''); setFilterMonth(''); }}
              className="text-sm text-primary-600 hover:text-primary-700 hover:underline pb-1"
            >
              Zurücksetzen
            </button>
          )}
        </div>
      </div>

      {/* Documents */}
      {loading ? (
        <div className="card p-12 text-center text-gray-500">Laden...</div>
      ) : filteredDocuments.length ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredDocuments.map((doc: any) => (
            <div key={doc.id} className={`card p-4 hover:shadow-md transition-shadow ${!doc.firstViewedAt ? 'ring-2 ring-blue-300' : ''}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    <span
                      className="inline-flex px-2 py-0.5 text-xs font-medium rounded-full text-white"
                      style={{ backgroundColor: doc.documentType.color }}
                    >
                      {doc.documentType.shortName}
                    </span>
                    {!doc.firstViewedAt && (
                      <span className="inline-flex px-2 py-0.5 text-[10px] font-bold rounded-full bg-blue-600 text-white">
                        NEU
                      </span>
                    )}
                    <span className="text-xs text-gray-500">
                      {doc.documentType.name}
                    </span>
                  </div>
                  <p className="text-sm font-medium text-gray-900 truncate" title={doc.originalFilename}>
                    {doc.originalFilename}
                  </p>
                  <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                    {doc.year && doc.month && (
                      <span>{MONTHS[doc.month - 1]} {doc.year}</span>
                    )}
                    {doc.year && !doc.month && (
                      <span>{doc.year}</span>
                    )}
                    {!doc._isReport && doc.fileSize > 0 && <span>{formatFileSize(doc.fileSize)}</span>}
                  </div>
                  {doc.note && (
                    <p className="text-xs text-gray-400 mt-1 truncate">{doc.note}</p>
                  )}
                  <p className="text-xs text-gray-400 mt-1">
                    {new Date(doc.createdAt).toLocaleDateString('de-DE')} {new Date(doc.createdAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}
                  </p>
                  {doc.documentType.name === 'Info-Schreiben' && !doc._isReport && (
                    doc.signedAt ? (
                      <div className="flex items-center gap-1.5 mt-2 text-xs text-green-700 bg-green-50 rounded px-2 py-1">
                        <CheckCircle2 size={14} />
                        <span>Bestätigt am {new Date(doc.signedAt).toLocaleDateString('de-DE')} {new Date(doc.signedAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}</span>
                      </div>
                    ) : (
                      <button
                        onClick={() => setSignDoc(doc)}
                        className="flex items-center gap-1.5 mt-2 text-xs text-amber-700 bg-amber-50 hover:bg-amber-100 rounded px-2 py-1 w-full justify-center border border-amber-200"
                      >
                        <PenLine size={14} />
                        <span>Jetzt digital bestätigen</span>
                      </button>
                    )
                  )}
                </div>
                <button
                  onClick={() => doc._isReport ? handleReportDownload(doc) : handleDownload(doc.id, doc.originalFilename)}
                  className="p-2 text-primary-600 hover:bg-primary-50 rounded-lg flex-shrink-0"
                  title="Herunterladen"
                >
                  <Download size={20} />
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="card p-12 text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-gray-100 rounded-full mb-4">
            <FolderOpen className="w-8 h-8 text-gray-400" />
          </div>
          <h3 className="text-lg font-medium text-gray-900 mb-2">
            {allDocuments.length ? 'Keine Dokumente für diesen Filter' : 'Noch keine Dokumente'}
          </h3>
          {!allDocuments.length && (
            <p className="text-gray-500">
              Sobald dein Administrator Dokumente hochlädt, werden sie hier angezeigt.
            </p>
          )}
        </div>
      )}

      {/* Signatur-Modal */}
      {signDoc && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <PenLine size={20} className="text-amber-600" />
                <h3 className="text-lg font-semibold">Info-Schreiben bestätigen</h3>
              </div>
              <button
                onClick={() => { setSignDoc(null); setSignPassword(''); }}
                className="p-1 hover:bg-gray-100 rounded"
              >
                <X size={20} />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <p className="text-sm text-gray-700">
                Mit der digitalen Bestätigung erklärst du den Erhalt und die Kenntnisnahme des Info-Schreibens
                zur digitalen Zeiterfassung. Deine Bestätigung wird mit Zeitstempel und IP-Adresse protokolliert.
              </p>
              <div className="bg-gray-50 rounded-lg p-3 text-sm">
                <p className="text-gray-500 text-xs">Dokument</p>
                <p className="font-medium">{signDoc.originalFilename}</p>
              </div>
              <div>
                <label className="label text-sm">Zur Bestätigung bitte dein Login-Passwort eingeben</label>
                <input
                  type="password"
                  value={signPassword}
                  onChange={(e) => setSignPassword(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && signPassword) signMutation.mutate({ id: signDoc.id, password: signPassword }); }}
                  autoFocus
                  className="input"
                  placeholder="Passwort"
                />
              </div>
            </div>
            <div className="p-5 border-t border-gray-100 flex justify-end gap-2">
              <button
                onClick={() => { setSignDoc(null); setSignPassword(''); }}
                className="btn btn-secondary"
                disabled={signMutation.isPending}
              >
                Abbrechen
              </button>
              <button
                onClick={() => signMutation.mutate({ id: signDoc.id, password: signPassword })}
                disabled={signMutation.isPending || !signPassword}
                className="btn btn-primary flex items-center gap-2"
              >
                <CheckCircle2 size={18} />
                {signMutation.isPending ? 'Bestätige…' : 'Verbindlich bestätigen'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
