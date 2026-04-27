import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { documentsApi, employeesApi, settingsApi } from '../lib/api';
import { Upload, X, FileText } from 'lucide-react';
import toast from 'react-hot-toast';

const MONTHS = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
];

interface DocumentUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  // Vorbelegungen
  defaultEmployeeId?: string;
  defaultYear?: number;
  defaultMonth?: number;
  // Wenn true, ist der jeweilige Wert fix und im UI nicht änderbar
  lockEmployee?: boolean;
  lockPeriod?: boolean;
  // Optional: zusätzlicher Erfolg-Callback (z.B. um andere Queries zu invalidieren)
  onSuccess?: () => void;
}

export default function DocumentUploadModal({
  isOpen,
  onClose,
  defaultEmployeeId,
  defaultYear,
  defaultMonth,
  lockEmployee = false,
  lockPeriod = false,
  onSuccess,
}: DocumentUploadModalProps) {
  const queryClient = useQueryClient();
  const today = new Date();

  const [employeeId, setEmployeeId] = useState(defaultEmployeeId || '');
  const [documentTypeId, setDocumentTypeId] = useState('');
  const [year, setYear] = useState(defaultYear ?? today.getFullYear());
  const [month, setMonth] = useState(defaultMonth ?? today.getMonth() + 1);
  const [note, setNote] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);

  // Bei jedem Öffnen Defaults reapplizieren
  useEffect(() => {
    if (!isOpen) return;
    setEmployeeId(defaultEmployeeId || '');
    setDocumentTypeId('');
    setYear(defaultYear ?? today.getFullYear());
    setMonth(defaultMonth ?? today.getMonth() + 1);
    setNote('');
    setFile(null);
    setDragging(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, defaultEmployeeId, defaultYear, defaultMonth]);

  const { data: employees } = useQuery({
    queryKey: ['employees-for-upload'],
    queryFn: () => employeesApi.getAll().then(r => r.data),
    enabled: isOpen && !lockEmployee,
  });

  const { data: documentTypes } = useQuery({
    queryKey: ['document-types-active'],
    queryFn: () => settingsApi.getDocumentTypes().then(r => r.data),
    enabled: isOpen,
  });

  const lockedEmployee = lockEmployee && defaultEmployeeId
    ? (employees || []).find((e: any) => e.id === defaultEmployeeId)
    : null;

  if (!isOpen) return null;

  const canSubmit = !!employeeId && !!documentTypeId && !!file && !uploading;

  const submit = async () => {
    if (!file || !employeeId || !documentTypeId) {
      toast.error('Bitte Mitarbeiter, Typ und Datei wählen');
      return;
    }
    setUploading(true);
    try {
      await documentsApi.upload(employeeId, file, {
        documentTypeId,
        year,
        month,
        note: note || undefined,
      });
      toast.success('Dokument hochgeladen');
      queryClient.invalidateQueries({ queryKey: ['employee-documents', employeeId] });
      queryClient.invalidateQueries({ queryKey: ['my-documents'] });
      onSuccess?.();
      onClose();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Fehler beim Hochladen');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="p-6 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <FileText size={20} />
            Dokument hochladen
          </h2>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg" disabled={uploading}>
            <X size={20} />
          </button>
        </div>

        <div className="overflow-y-auto p-6 space-y-4">
          {/* Mitarbeiter */}
          <div>
            <label className="label text-xs">Mitarbeiter *</label>
            {lockEmployee && lockedEmployee ? (
              <div className="input py-2 text-sm bg-gray-50 text-gray-700">
                {lockedEmployee.lastName}, {lockedEmployee.firstName}
              </div>
            ) : (
              <select
                value={employeeId}
                onChange={(e) => setEmployeeId(e.target.value)}
                className="input py-2 text-sm"
                disabled={lockEmployee}
              >
                <option value="">Bitte wählen...</option>
                {(employees || [])
                  .filter((e: any) => !e.isAdmin)
                  .sort((a: any, b: any) => a.lastName.localeCompare(b.lastName))
                  .map((e: any) => (
                    <option key={e.id} value={e.id}>
                      {e.lastName}, {e.firstName} {!e.isActive ? '(inaktiv)' : ''}
                    </option>
                  ))}
              </select>
            )}
          </div>

          {/* Typ + Periode */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label text-xs">Dokumenttyp *</label>
              <select
                value={documentTypeId}
                onChange={(e) => setDocumentTypeId(e.target.value)}
                className="input py-2 text-sm"
              >
                <option value="">Bitte wählen...</option>
                {(documentTypes || []).map((dt: any) => (
                  <option key={dt.id} value={dt.id}>{dt.name}</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="label text-xs">Jahr</label>
                <select
                  value={year}
                  onChange={(e) => setYear(parseInt(e.target.value))}
                  className="input py-2 text-sm"
                  disabled={lockPeriod}
                >
                  {[2023, 2024, 2025, 2026, 2027].map(y => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label text-xs">Monat</label>
                <select
                  value={month}
                  onChange={(e) => setMonth(parseInt(e.target.value))}
                  className="input py-2 text-sm"
                  disabled={lockPeriod}
                >
                  {MONTHS.map((m, i) => (
                    <option key={i} value={i + 1}>{m}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Notiz */}
          <div>
            <label className="label text-xs">Notiz (optional)</label>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="input py-2 text-sm"
              placeholder="z.B. Korrektur, Originalbeleg, …"
              maxLength={200}
            />
          </div>

          {/* Datei-Drop */}
          <label
            className={`flex flex-col items-center justify-center w-full py-6 rounded-lg border-2 border-dashed cursor-pointer transition-colors ${
              dragging
                ? 'border-primary-500 bg-primary-50'
                : file
                ? 'border-green-400 bg-green-50'
                : 'border-gray-300 hover:border-gray-400 hover:bg-gray-50'
            }`}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              const f = e.dataTransfer.files[0];
              if (f) setFile(f);
            }}
          >
            <Upload size={28} className={dragging ? 'text-primary-500' : file ? 'text-green-600' : 'text-gray-400'} />
            <p className="mt-2 text-sm text-gray-600 text-center px-3">
              {uploading
                ? 'Wird hochgeladen...'
                : file
                ? file.name
                : dragging
                ? 'Hier ablegen'
                : 'Datei hierhin ziehen oder klicken'}
            </p>
            {file && !uploading && (
              <p className="text-xs text-gray-500 mt-1">
                {file.size < 1024 * 1024
                  ? `${(file.size / 1024).toFixed(1)} KB`
                  : `${(file.size / (1024 * 1024)).toFixed(1)} MB`}
              </p>
            )}
            <input type="file" className="hidden" onChange={(e) => setFile(e.target.files?.[0] || null)} />
          </label>
          {file && !uploading && (
            <button onClick={() => setFile(null)} className="text-xs text-gray-500 hover:text-gray-700">
              Datei entfernen
            </button>
          )}
        </div>

        <div className="p-6 border-t border-gray-100 flex justify-end gap-3">
          <button onClick={onClose} className="btn btn-secondary" disabled={uploading}>
            Abbrechen
          </button>
          <button
            onClick={submit}
            disabled={!canSubmit}
            className="btn btn-primary flex items-center gap-2"
          >
            <Upload size={18} />
            {uploading ? 'Lädt hoch...' : 'Hochladen'}
          </button>
        </div>
      </div>
    </div>
  );
}
