import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { authApi, twoFactorApi } from '../../lib/api';
import { useAuthStore } from '../../store/authStore';
import { startRegistration } from '@simplewebauthn/browser';
import { Lock, Eye, EyeOff, Save, ShieldCheck, Fingerprint, Trash2, Plus, CheckCircle } from 'lucide-react';
import toast from 'react-hot-toast';

export default function EmployeeSettings() {
  const { employee } = useAuthStore();
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [formData, setFormData] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });

  // 2FA State
  const [totpSetupData, setTotpSetupData] = useState<{ secret: string; qrCodeDataUrl: string } | null>(null);
  const [totpSetupCode, setTotpSetupCode] = useState('');
  const [totpDisableCode, setTotpDisableCode] = useState('');
  const [showTotpDisable, setShowTotpDisable] = useState(false);
  const [passkeyName, setPasskeyName] = useState('');
  const [showPasskeyRegister, setShowPasskeyRegister] = useState(false);

  // Queries
  const { data: twoFAStatus, refetch: refetchStatus } = useQuery({
    queryKey: ['2fa-status'],
    queryFn: async () => (await twoFactorApi.getStatus()).data,
  });

  const { data: passkeys = [], refetch: refetchPasskeys } = useQuery({
    queryKey: ['passkeys'],
    queryFn: async () => (await twoFactorApi.passkeyList()).data,
  });

  // Password mutation
  const changePasswordMutation = useMutation({
    mutationFn: () => authApi.changePassword(formData.currentPassword, formData.newPassword),
    onSuccess: () => {
      toast.success('Passwort erfolgreich geändert');
      setFormData({ currentPassword: '', newPassword: '', confirmPassword: '' });
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Fehler beim Ändern des Passworts');
    },
  });

  const handlePasswordSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (formData.newPassword !== formData.confirmPassword) {
      toast.error('Die neuen Passwörter stimmen nicht überein');
      return;
    }
    if (formData.newPassword.length < 10) {
      toast.error('Das neue Passwort muss mindestens 10 Zeichen haben');
      return;
    }
    changePasswordMutation.mutate();
  };

  // TOTP Setup
  const handleTotpSetup = async () => {
    try {
      const res = await twoFactorApi.totpSetup();
      setTotpSetupData(res.data);
      setTotpSetupCode('');
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Fehler beim Einrichten von 2FA');
    }
  };

  const handleTotpVerifySetup = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await twoFactorApi.totpVerifySetup(totpSetupCode);
      toast.success('2FA erfolgreich aktiviert!');
      setTotpSetupData(null);
      setTotpSetupCode('');
      refetchStatus();
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Ungültiger Code');
      setTotpSetupCode('');
    }
  };

  const handleTotpDisable = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await twoFactorApi.totpDisable(totpDisableCode);
      toast.success('2FA deaktiviert');
      setShowTotpDisable(false);
      setTotpDisableCode('');
      refetchStatus();
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Ungültiger Code');
      setTotpDisableCode('');
    }
  };

  // Passkey Registration
  const handlePasskeyRegister = async () => {
    try {
      const optionsRes = await twoFactorApi.passkeyRegisterOptions();
      const regResult = await startRegistration({ optionsJSON: optionsRes.data });
      await twoFactorApi.passkeyRegisterVerify(regResult, passkeyName || 'Mein Passkey');
      toast.success('Passkey erfolgreich registriert!');
      setShowPasskeyRegister(false);
      setPasskeyName('');
      refetchPasskeys();
      refetchStatus();
    } catch (error: any) {
      console.error('Passkey registration error:', error);
      if (error.name === 'NotAllowedError') {
        toast.error('Passkey-Registrierung abgebrochen');
      } else {
        toast.error(error.response?.data?.error || error.message || 'Fehler bei der Passkey-Registrierung');
      }
    }
  };

  const handlePasskeyDelete = async (id: string, name: string) => {
    if (!confirm(`Passkey "${name}" wirklich löschen?`)) return;
    try {
      await twoFactorApi.passkeyDelete(id);
      toast.success('Passkey gelöscht');
      refetchPasskeys();
      refetchStatus();
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Fehler beim Löschen');
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Einstellungen</h1>
        <p className="text-gray-500">Persönliche Einstellungen verwalten</p>
      </div>

      {/* Profile Info (Read-only) */}
      <div className="card p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Profil</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="label">Mitarbeiternummer</label>
            <p className="text-gray-900 font-medium">#{employee?.employeeNumber}</p>
          </div>
          <div>
            <label className="label">Name</label>
            <p className="text-gray-900 font-medium">
              {employee?.firstName} {employee?.lastName}
            </p>
          </div>
          {employee?.email && (
            <div>
              <label className="label">E-Mail</label>
              <p className="text-gray-900">{employee.email}</p>
            </div>
          )}
          {!employee?.isAdmin && (
            <div>
              <label className="label">Wochenstunden</label>
              <p className="text-gray-900">{employee?.weeklyHours} h</p>
            </div>
          )}
        </div>
        <p className="text-sm text-gray-500 mt-4">
          Um deine persönlichen Daten zu ändern, wende dich bitte an einen Administrator.
        </p>
      </div>

      {/* Change Password */}
      <div className="card p-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2 rounded-lg bg-primary-100">
            <Lock className="w-5 h-5 text-primary-600" />
          </div>
          <h2 className="text-lg font-semibold text-gray-900">Passwort ändern</h2>
        </div>

        <form onSubmit={handlePasswordSubmit} className="space-y-4 max-w-md">
          <div>
            <label className="label">Aktuelles Passwort</label>
            <div className="relative">
              <input
                type={showCurrentPassword ? 'text' : 'password'}
                value={formData.currentPassword}
                onChange={(e) => setFormData({ ...formData, currentPassword: e.target.value })}
                className="input pr-10"
                required
              />
              <button
                type="button"
                onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                {showCurrentPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          <div>
            <label className="label">Neues Passwort</label>
            <div className="relative">
              <input
                type={showNewPassword ? 'text' : 'password'}
                value={formData.newPassword}
                onChange={(e) => setFormData({ ...formData, newPassword: e.target.value })}
                className="input pr-10"
                minLength={6}
                required
              />
              <button
                type="button"
                onClick={() => setShowNewPassword(!showNewPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                {showNewPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
            <p className="text-xs text-gray-500 mt-1">Mindestens 6 Zeichen</p>
          </div>

          <div>
            <label className="label">Neues Passwort bestätigen</label>
            <div className="relative">
              <input
                type={showConfirmPassword ? 'text' : 'password'}
                value={formData.confirmPassword}
                onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                className="input pr-10"
                minLength={6}
                required
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={changePasswordMutation.isPending}
            className="btn btn-primary flex items-center gap-2"
          >
            <Save size={18} />
            {changePasswordMutation.isPending ? 'Speichern...' : 'Passwort ändern'}
          </button>
        </form>
      </div>

      {/* 2FA / TOTP */}
      <div className="card p-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2 rounded-lg bg-amber-100">
            <ShieldCheck className="w-5 h-5 text-amber-600" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Zwei-Faktor-Authentifizierung (2FA)</h2>
            <p className="text-sm text-gray-500">Zusätzliche Sicherheit beim Login mit Authenticator-App</p>
          </div>
        </div>

        {twoFAStatus?.totpEnabled ? (
          <div>
            <div className="flex items-center gap-2 mb-4">
              <CheckCircle className="w-5 h-5 text-green-500" />
              <span className="text-green-700 font-medium">2FA ist aktiviert</span>
            </div>
            {showTotpDisable ? (
              <form onSubmit={handleTotpDisable} className="max-w-sm space-y-3">
                <p className="text-sm text-gray-600">
                  Geben Sie Ihren aktuellen 2FA-Code ein, um die Zwei-Faktor-Authentifizierung zu deaktivieren.
                </p>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  value={totpDisableCode}
                  onChange={(e) => setTotpDisableCode(e.target.value.replace(/\D/g, ''))}
                  className="input text-center text-xl tracking-[0.3em] font-mono"
                  placeholder="000000"
                />
                <div className="flex gap-2">
                  <button type="submit" disabled={totpDisableCode.length !== 6} className="btn btn-primary text-sm">
                    Deaktivieren
                  </button>
                  <button type="button" onClick={() => { setShowTotpDisable(false); setTotpDisableCode(''); }} className="btn btn-secondary text-sm">
                    Abbrechen
                  </button>
                </div>
              </form>
            ) : (
              <button
                onClick={() => setShowTotpDisable(true)}
                className="text-sm text-red-600 hover:text-red-700 hover:underline"
              >
                2FA deaktivieren
              </button>
            )}
          </div>
        ) : totpSetupData ? (
          <div className="max-w-sm">
            <p className="text-sm text-gray-600 mb-4">
              Scannen Sie den QR-Code mit Ihrer Authenticator-App (z.B. Google Authenticator, Authy).
            </p>
            <div className="flex justify-center mb-4">
              <img src={totpSetupData.qrCodeDataUrl} alt="TOTP QR Code" className="w-48 h-48" />
            </div>
            <div className="mb-4">
              <p className="text-xs text-gray-500 mb-1">Oder manuell eingeben:</p>
              <code className="block bg-gray-100 p-2 rounded text-xs text-center break-all font-mono select-all">
                {totpSetupData.secret}
              </code>
            </div>
            <form onSubmit={handleTotpVerifySetup} className="space-y-3">
              <p className="text-sm text-gray-600">
                Geben Sie den 6-stelligen Code aus der App ein, um die Einrichtung abzuschließen.
              </p>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                value={totpSetupCode}
                onChange={(e) => setTotpSetupCode(e.target.value.replace(/\D/g, ''))}
                className="input text-center text-xl tracking-[0.3em] font-mono"
                placeholder="000000"
                autoFocus
              />
              <div className="flex gap-2">
                <button type="submit" disabled={totpSetupCode.length !== 6} className="btn btn-primary text-sm">
                  Verifizieren & Aktivieren
                </button>
                <button type="button" onClick={() => { setTotpSetupData(null); setTotpSetupCode(''); }} className="btn btn-secondary text-sm">
                  Abbrechen
                </button>
              </div>
            </form>
          </div>
        ) : (
          <div>
            <p className="text-sm text-gray-600 mb-4">
              Schützen Sie Ihr Konto mit einem zusätzlichen Code aus einer Authenticator-App.
            </p>
            <button onClick={handleTotpSetup} className="btn btn-primary text-sm flex items-center gap-2">
              <ShieldCheck size={16} />
              2FA einrichten
            </button>
          </div>
        )}
      </div>

      {/* Passkeys - only in secure context */}
      {window.isSecureContext && <div className="card p-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2 rounded-lg bg-indigo-100">
            <Fingerprint className="w-5 h-5 text-indigo-600" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Passkeys</h2>
            <p className="text-sm text-gray-500">Anmelden ohne Passwort mit Fingerabdruck, Face ID oder Sicherheitsschlüssel</p>
          </div>
        </div>

        {/* Existing passkeys */}
        {passkeys.length > 0 && (
          <div className="space-y-2 mb-4">
            {passkeys.map((pk: any) => (
              <div key={pk.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                <div className="flex items-center gap-3">
                  <Fingerprint size={18} className="text-indigo-500" />
                  <div>
                    <p className="text-sm font-medium text-gray-900">{pk.deviceName}</p>
                    <p className="text-xs text-gray-500">
                      Registriert am {new Date(pk.createdAt).toLocaleDateString('de-DE')}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => handlePasskeyDelete(pk.id, pk.deviceName)}
                  className="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg"
                  title="Passkey löschen"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
        )}

        {showPasskeyRegister ? (
          <div className="max-w-sm space-y-3">
            <div>
              <label className="label">Name für den Passkey</label>
              <input
                type="text"
                value={passkeyName}
                onChange={(e) => setPasskeyName(e.target.value)}
                className="input"
                placeholder="z.B. MacBook Pro, iPhone"
                autoFocus
              />
            </div>
            <div className="flex gap-2">
              <button onClick={handlePasskeyRegister} className="btn btn-primary text-sm flex items-center gap-2">
                <Fingerprint size={16} />
                Passkey erstellen
              </button>
              <button onClick={() => { setShowPasskeyRegister(false); setPasskeyName(''); }} className="btn btn-secondary text-sm">
                Abbrechen
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setShowPasskeyRegister(true)}
            className="btn btn-primary text-sm flex items-center gap-2"
          >
            <Plus size={16} />
            Neuen Passkey hinzufügen
          </button>
        )}
      </div>}
    </div>
  );
}
