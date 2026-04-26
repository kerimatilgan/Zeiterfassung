import { useState } from 'react';
import { Server, RotateCcw, Save } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  getServerUrl,
  setServerUrl,
  getDefaultServerUrl,
  isNativeApp,
} from '../lib/serverConfig';

/**
 * Settings-Block zum Ändern der Backend-Server-URL.
 * Wird hauptsächlich in den nativen Apps (Android/Windows) gebraucht,
 * im Browser ist die Domain implizit dieselbe und das Feld eher optional.
 */
export default function ServerUrlSettings() {
  const [url, setUrl] = useState(getServerUrl() || getDefaultServerUrl());
  const [saving, setSaving] = useState(false);

  // Im Browser (gleiche Domain wie Backend) ist die Komponente nutzlos —
  // dort braucht man die App nicht umkonfigurieren. Nur in nativen Apps anzeigen.
  if (!isNativeApp()) return null;

  const handleSave = () => {
    setSaving(true);
    try {
      // Format-Check — muss mit http(s):// anfangen
      if (!/^https?:\/\//.test(url)) {
        toast.error('URL muss mit http:// oder https:// beginnen');
        setSaving(false);
        return;
      }
      setServerUrl(url);
      toast.success('Server-URL gespeichert. App wird in 2 Sekunden neu geladen…');
      setTimeout(() => window.location.reload(), 2000);
    } catch (err: any) {
      toast.error(err.message || 'Fehler beim Speichern');
      setSaving(false);
    }
  };

  const handleReset = () => {
    setUrl(getDefaultServerUrl());
  };

  return (
    <div className="card">
      <div className="p-6 border-b border-gray-100">
        <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
          <Server size={20} />
          Server-URL
        </h2>
        <p className="text-sm text-gray-500 mt-1">
          Adresse des Zeiterfassungs-Backends. Standardmäßig die zentrale Handy-Insel-Instanz.
          Nur ändern, wenn du eine eigene Instanz nutzt.
        </p>
      </div>
      <div className="p-6 space-y-4">
        <div>
          <label className="label text-sm">Backend-URL</label>
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://zeit.handy-insel.de"
            className="input"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
          />
          <p className="text-xs text-gray-500 mt-1">
            Aktuell aktiv: <code className="text-xs bg-gray-100 px-1 rounded">{getServerUrl() || '(nicht gesetzt)'}</code>
          </p>
        </div>
      </div>
      <div className="p-6 border-t border-gray-100 flex justify-between">
        <button
          type="button"
          onClick={handleReset}
          className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1"
        >
          <RotateCcw size={14} />
          Auf Standard zurücksetzen
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="btn btn-primary flex items-center gap-2"
        >
          <Save size={18} />
          {saving ? 'Speichere…' : 'URL speichern + neu laden'}
        </button>
      </div>
    </div>
  );
}
