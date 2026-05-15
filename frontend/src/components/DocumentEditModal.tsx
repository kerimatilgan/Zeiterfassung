import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { documentsApi, settingsApi } from '../lib/api';
import { Pencil, X, Lock, Eye } from 'lucide-react';
import toast from 'react-hot-toast';

interface DocumentEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  doc: any | null;
  // Welche Felder darf der User in diesem Modal ändern?
  // - 'self': MA bearbeitet eigenen Self-Upload (Name, Typ, Bemerkung, Sichtbarkeit)
  // - 'admin': Admin bearbeitet (zusätzlich Periode möglich — hier aktuell nicht ausgebaut)
  mode?: 'self' | 'admin';
}

export default function DocumentEditModal({ isOpen, onClose, doc, mode = 'self' }: DocumentEditModalProps) {
  const queryClient = useQueryClient();
  const [filename, setFilename] = useState('');
  const [documentTypeId, setDocumentTypeId] = useState('');
  const [note, setNote] = useState('');
  const [visibleToAdmin, setVisibleToAdmin] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen || !doc) return;
    setFilename(doc.originalFilename || '');
    setDocumentTypeId(doc.documentTypeId || '');
    setNote(doc.note || '');
    setVisibleToAdmin(!!doc.visibleToAdmin);
  }, [isOpen, doc]);

  const { data: documentTypes } = useQuery({
    queryKey: ['document-types-active'],
    queryFn: () => settingsApi.getDocumentTypes().then(r => r.data),
    enabled: isOpen,
  });

  if (!isOpen || !doc) return null;

  const trimmedName = filename.trim();
  const canSubmit = !!trimmedName && !!documentTypeId && !saving;

  const submit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    try {
      await documentsApi.update(doc.id, {
        originalFilename: trimmedName,
        documentTypeId,
        note: note || null,
        visibleToAdmin,
      });
      toast.success('Dokument aktualisiert');
      queryClient.invalidateQueries({ queryKey: ['my-documents'] });
      queryClient.invalidateQueries({ queryKey: ['employee-documents', doc.employeeId] });
      onClose();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Fehler beim Aktualisieren');
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <Pencil size={18} />
            Dokument bearbeiten
          </h2>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg" disabled={saving}>
            <X size={20} />
          </button>
        </div>

        <div className="overflow-y-auto px-6 pt-4 pb-6 space-y-4">
          <div>
            <label className="label text-xs">Dateiname *</label>
            <input
              type="text"
              value={filename}
              onChange={(e) => setFilename(e.target.value)}
              className="input py-2 text-sm"
              maxLength={200}
              autoFocus
            />
            <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">
              Dies ist der Anzeige- und Download-Name — die Datei selbst bleibt verschlüsselt.
            </p>
          </div>

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

          <div>
            <label className="label text-xs">Bemerkung (optional)</label>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="input py-2 text-sm"
              placeholder="z.B. Korrektur, Originalbeleg, …"
              maxLength={200}
            />
          </div>

          {mode === 'self' && (
            <label className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
              visibleToAdmin ? 'border-amber-300 bg-amber-50 dark:bg-amber-950/40' : 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700'
            }`}>
              <input
                type="checkbox"
                checked={visibleToAdmin}
                onChange={(e) => setVisibleToAdmin(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-gray-300 dark:border-gray-700 text-amber-600 dark:text-amber-400 focus:ring-amber-500"
              />
              <div className="flex-1 text-sm">
                <div className="flex items-center gap-1.5 font-medium text-gray-900 dark:text-gray-100">
                  {visibleToAdmin ? <Eye size={14} className="text-amber-600 dark:text-amber-400" /> : <Lock size={14} className="text-gray-500 dark:text-gray-400" />}
                  {visibleToAdmin ? 'Admin darf dieses Dokument sehen' : 'Privates Dokument'}
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  {visibleToAdmin
                    ? 'Erscheint auch in der Admin-Ansicht deiner Dokumente.'
                    : 'Nur du siehst dieses Dokument. Admin sieht weder Datei noch Existenz.'}
                </p>
              </div>
            </label>
          )}
        </div>

        <div className="px-6 py-4 border-t border-gray-100 dark:border-gray-800 flex justify-end gap-3">
          <button onClick={onClose} className="btn btn-secondary" disabled={saving}>
            Abbrechen
          </button>
          <button
            onClick={submit}
            disabled={!canSubmit}
            className="btn btn-primary"
          >
            {saving ? 'Speichere…' : 'Speichern'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
