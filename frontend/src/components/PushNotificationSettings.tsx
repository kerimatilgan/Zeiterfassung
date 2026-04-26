import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Bell, BellOff } from 'lucide-react';
import {
  isPushSupported,
  enablePush,
  disablePush,
  hasActiveSubscription,
  getNotificationPermission,
} from '../lib/pushNotifications';

export default function PushNotificationSettings() {
  const [supported] = useState(isPushSupported());
  const [permission, setPermission] = useState<NotificationPermission>(getNotificationPermission());
  const [subscribed, setSubscribed] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!supported) {
      setSubscribed(false);
      return;
    }
    hasActiveSubscription().then(setSubscribed);
  }, [supported]);

  if (!supported) {
    return (
      <div className="card">
        <div className="p-6">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <Bell size={20} />
            Push-Benachrichtigungen
          </h2>
          <p className="text-sm text-gray-500 mt-2">
            Dein Browser unterstützt keine Push-Benachrichtigungen.
          </p>
        </div>
      </div>
    );
  }

  const handleEnable = async () => {
    setBusy(true);
    try {
      const res = await enablePush();
      if (res.ok) {
        toast.success('Push-Benachrichtigungen aktiviert');
        setSubscribed(true);
        setPermission(getNotificationPermission());
      } else {
        toast.error(res.reason || 'Konnte nicht aktiviert werden');
        setPermission(getNotificationPermission());
      }
    } catch (err: any) {
      toast.error(err.message || 'Fehler beim Aktivieren');
    } finally {
      setBusy(false);
    }
  };

  const handleDisable = async () => {
    setBusy(true);
    try {
      await disablePush();
      toast.success('Push-Benachrichtigungen deaktiviert');
      setSubscribed(false);
    } catch (err: any) {
      toast.error(err.message || 'Fehler beim Deaktivieren');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <div className="p-6 border-b border-gray-100">
        <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
          <Bell size={20} />
          Push-Benachrichtigungen
        </h2>
        <p className="text-sm text-gray-500 mt-1">
          Erhalte direkte Benachrichtigungen wenn neue Dokumente oder Abrechnungen für dich
          bereitgestellt werden, oder wenn du das Ausstempeln vergessen hast.
        </p>
      </div>
      <div className="p-6 flex items-center justify-between gap-4">
        <div className="flex-1">
          <p className="text-sm">
            Status: {subscribed === null ? '—' : subscribed
              ? <span className="text-green-700 font-medium">Aktiv</span>
              : <span className="text-gray-500">Inaktiv</span>}
          </p>
          {permission === 'denied' && (
            <p className="text-xs text-amber-700 mt-1">
              Dein Browser hat Benachrichtigungen blockiert. Aktivierung nur über die Browser-Einstellungen möglich.
            </p>
          )}
        </div>
        {subscribed ? (
          <button
            type="button"
            onClick={handleDisable}
            disabled={busy}
            className="btn btn-secondary flex items-center gap-2"
          >
            <BellOff size={16} />
            Deaktivieren
          </button>
        ) : (
          <button
            type="button"
            onClick={handleEnable}
            disabled={busy || permission === 'denied'}
            className="btn btn-primary flex items-center gap-2"
          >
            <Bell size={16} />
            Aktivieren
          </button>
        )}
      </div>
    </div>
  );
}
