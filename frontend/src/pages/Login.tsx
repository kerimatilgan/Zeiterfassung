import { useState, useRef, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { authApi, twoFactorApi } from '../lib/api';
import { startAuthentication } from '@simplewebauthn/browser';
import toast from 'react-hot-toast';
import { Clock, LogIn, Fingerprint, ShieldCheck, ArrowLeft, Server } from 'lucide-react';
import { isNativeApp, getServerUrl, setServerUrl, getDefaultServerUrl } from '../lib/serverConfig';

type LoginStep = 'credentials' | 'totp';

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [passkeyLoading, setPasskeyLoading] = useState(false);
  const [step, setStep] = useState<LoginStep>('credentials');
  const [tempToken, setTempToken] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const totpInputRef = useRef<HTMLInputElement>(null);
  const { login } = useAuthStore();
  const navigate = useNavigate();
  const [showServerModal, setShowServerModal] = useState(false);
  const [serverInput, setServerInput] = useState(getServerUrl() || getDefaultServerUrl());

  useEffect(() => {
    if (step === 'totp' && totpInputRef.current) {
      totpInputRef.current.focus();
    }
  }, [step]);

  const completeLogin = (token: string, employee: any) => {
    login(token, employee);
    toast.success(`Willkommen, ${employee.firstName}!`);
    navigate(employee.isAdmin ? '/admin' : '/dashboard');
  };

  const handleCredentialSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const response = await authApi.login(username, password);

      if (response.data.requires2FA) {
        setTempToken(response.data.tempToken);
        setStep('totp');
        setTotpCode('');
      } else {
        completeLogin(response.data.token, response.data.employee);
      }
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Anmeldung fehlgeschlagen');
    } finally {
      setLoading(false);
    }
  };

  const handleTotpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (totpCode.length !== 6) return;
    setLoading(true);

    try {
      const response = await twoFactorApi.totpValidate(tempToken, totpCode);
      completeLogin(response.data.token, response.data.employee);
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Ungültiger Code');
      setTotpCode('');
    } finally {
      setLoading(false);
    }
  };

  const handlePasskeyLogin = async () => {
    setPasskeyLoading(true);

    try {
      const optionsRes = await twoFactorApi.passkeyAuthOptions();
      const authResult = await startAuthentication({ optionsJSON: optionsRes.data });
      const verifyRes = await twoFactorApi.passkeyAuthVerify(authResult);
      completeLogin(verifyRes.data.token, verifyRes.data.employee);
    } catch (error: any) {
      if (error.name === 'NotAllowedError') {
        toast.error('Passkey-Authentifizierung abgebrochen');
      } else {
        toast.error(error.response?.data?.error || 'Passkey-Anmeldung fehlgeschlagen');
      }
    } finally {
      setPasskeyLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-500 to-primary-700 p-4">
      <div className="w-full max-w-md">
        <div className="card p-8">
          {/* Logo */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-primary-100 rounded-full mb-4">
              <Clock className="w-8 h-8 text-primary-600" />
            </div>
            <h1 className="text-2xl font-bold text-gray-900">Handy-Insel</h1>
            <p className="text-gray-500">Zeiterfassung</p>
          </div>

          {step === 'credentials' ? (
            <>
              {/* Credentials Form */}
              <form onSubmit={handleCredentialSubmit} className="space-y-6">
                <div>
                  <label htmlFor="username" className="label">
                    Benutzername
                  </label>
                  <input
                    id="username"
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="input"
                    placeholder="Benutzername eingeben"
                    required
                    autoComplete="username"
                  />
                </div>

                <div>
                  <label htmlFor="password" className="label">
                    Passwort
                  </label>
                  <input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="input"
                    placeholder="Passwort eingeben"
                    required
                    autoComplete="current-password"
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="btn btn-primary w-full flex items-center justify-center gap-2"
                >
                  {loading ? (
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <>
                      <LogIn size={20} />
                      Anmelden
                    </>
                  )}
                </button>
              </form>

              {/* Passkey Button - only in secure context (https or localhost) UND nicht in nativer App
                  (Capacitor/Tauri-WebView unterstützt WebAuthn ohne Asset-Links nicht zuverlässig) */}
              {window.isSecureContext && !isNativeApp() && (
                <>
                  <div className="relative my-6">
                    <div className="absolute inset-0 flex items-center">
                      <div className="w-full border-t border-gray-200" />
                    </div>
                    <div className="relative flex justify-center text-sm">
                      <span className="bg-white px-4 text-gray-400">oder</span>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={handlePasskeyLogin}
                    disabled={passkeyLoading}
                    className="w-full flex items-center justify-center gap-2 px-4 py-3 border-2 border-gray-200 rounded-xl text-gray-700 font-medium hover:border-primary-300 hover:bg-primary-50 transition-colors disabled:opacity-50"
                  >
                    {passkeyLoading ? (
                      <div className="w-5 h-5 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <>
                        <Fingerprint size={20} className="text-primary-600" />
                        Mit Passkey anmelden
                      </>
                    )}
                  </button>
                </>
              )}

              {/* Passwort vergessen */}
              <div className="mt-4 text-center">
                <Link
                  to="/forgot-password"
                  className="text-sm text-primary-600 hover:text-primary-700 hover:underline"
                >
                  Passwort vergessen?
                </Link>
              </div>
            </>
          ) : (
            <>
              {/* TOTP Step */}
              <div className="text-center mb-6">
                <div className="inline-flex items-center justify-center w-12 h-12 bg-amber-100 rounded-full mb-3">
                  <ShieldCheck className="w-6 h-6 text-amber-600" />
                </div>
                <h2 className="text-lg font-semibold text-gray-900">Zwei-Faktor-Authentifizierung</h2>
                <p className="text-sm text-gray-500 mt-1">
                  Geben Sie den 6-stelligen Code aus Ihrer Authenticator-App ein.
                </p>
              </div>

              <form onSubmit={handleTotpSubmit} className="space-y-6">
                <div>
                  <input
                    ref={totpInputRef}
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={6}
                    value={totpCode}
                    onChange={(e) => {
                      const val = e.target.value.replace(/\D/g, '');
                      setTotpCode(val);
                    }}
                    className="input text-center text-2xl tracking-[0.5em] font-mono"
                    placeholder="000000"
                    autoComplete="one-time-code"
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading || totpCode.length !== 6}
                  className="btn btn-primary w-full flex items-center justify-center gap-2"
                >
                  {loading ? (
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <>
                      <ShieldCheck size={20} />
                      Verifizieren
                    </>
                  )}
                </button>
              </form>

              <div className="mt-4 text-center">
                <button
                  onClick={() => {
                    setStep('credentials');
                    setTempToken('');
                    setTotpCode('');
                  }}
                  className="inline-flex items-center gap-1 text-sm text-primary-600 hover:text-primary-700 hover:underline"
                >
                  <ArrowLeft size={16} />
                  Zurück zum Login
                </button>
              </div>
            </>
          )}
        </div>

        {/* Server-Konfiguration nur in nativen Apps */}
        {isNativeApp() && (
          <div className="mt-4 text-center">
            <button
              onClick={() => setShowServerModal(true)}
              className="inline-flex items-center gap-1 text-xs text-white/80 hover:text-white"
            >
              <Server size={12} />
              Server: {getServerUrl() || getDefaultServerUrl()}
            </button>
          </div>
        )}
      </div>

      {/* Server-Konfig-Modal */}
      {showServerModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
            <div className="p-5 border-b border-gray-100 flex items-center gap-2">
              <Server size={20} className="text-primary-600" />
              <h3 className="text-lg font-semibold">Server-URL konfigurieren</h3>
            </div>
            <div className="p-5 space-y-3">
              <p className="text-sm text-gray-600">
                Adresse der Zeiterfassungs-Instanz, mit der sich diese App verbinden soll.
              </p>
              <input
                type="url"
                value={serverInput}
                onChange={(e) => setServerInput(e.target.value)}
                className="input"
                placeholder="https://zeit.handy-insel.de"
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
              />
              <button
                type="button"
                onClick={() => setServerInput(getDefaultServerUrl())}
                className="text-xs text-gray-500 hover:text-gray-700"
              >
                Auf Standard ({getDefaultServerUrl()}) zurücksetzen
              </button>
            </div>
            <div className="p-5 border-t border-gray-100 flex justify-end gap-2">
              <button
                onClick={() => setShowServerModal(false)}
                className="btn btn-secondary"
              >
                Abbrechen
              </button>
              <button
                onClick={() => {
                  if (!/^https?:\/\//.test(serverInput)) {
                    toast.error('URL muss mit http:// oder https:// beginnen');
                    return;
                  }
                  setServerUrl(serverInput);
                  toast.success('Gespeichert. App wird neu geladen…');
                  setTimeout(() => window.location.reload(), 1000);
                }}
                className="btn btn-primary"
              >
                Speichern
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
