import { useState, useRef, useEffect } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { authApi, twoFactorApi, settingsApi } from '../lib/api';
import { useQuery } from '@tanstack/react-query';
import { startAuthentication } from '@simplewebauthn/browser';
import toast from 'react-hot-toast';
import { Clock, LogIn, Fingerprint, ShieldCheck, ArrowLeft, Server, KeyRound } from 'lucide-react';
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
  const [searchParams, setSearchParams] = useSearchParams();
  const [showServerModal, setShowServerModal] = useState(false);
  const [serverInput, setServerInput] = useState(getServerUrl() || getDefaultServerUrl());

  // Firmenname + SSO-Status für die Login-Karte (öffentlich, ohne Auth)
  const { data: branding } = useQuery({
    queryKey: ['public-branding'],
    queryFn: () =>
      settingsApi.getPublic().then(
        (r) => r.data as { companyName: string; ssoEnabled?: boolean; ssoButtonLabel?: string }
      ),
    staleTime: 5 * 60 * 1000,
  });
  const showSsoButton = !!branding?.ssoEnabled && !isNativeApp();

  // Fehler vom SSO-Callback (Backend leitet auf /login?sso_error=... weiter)
  useEffect(() => {
    const err = searchParams.get('sso_error');
    if (err) {
      toast.error(err);
      const next = new URLSearchParams(searchParams);
      next.delete('sso_error');
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const companyName = branding?.companyName?.trim() || 'Zeiterfassung';
  const companyNameSizeClass = companyName.length <= 16
    ? 'text-headline-lg'
    : companyName.length <= 24
    ? 'text-headline-md'
    : 'text-body-lg';

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

  const showSecondaryAuth = showSsoButton || (window.isSecureContext && !isNativeApp());

  // Styling-Helper für Inputs/Labels/Buttons der neuen Login-Karte
  const labelCls = 'font-label-md text-label-md uppercase text-on-surface-variant';
  const inputCls =
    'w-full bg-surface-container-lowest dark:bg-surface-container-high border border-outline-variant rounded-lg px-4 py-2.5 text-body-lg text-on-surface placeholder-on-surface-variant/60 focus:outline-none focus:ring-2 focus:ring-primary-container focus:border-transparent transition-shadow duration-150 ease-in-out';
  const primaryBtnCls =
    'w-full flex items-center justify-center gap-2 rounded-lg py-3 px-4 bg-primary-container hover:bg-primary-container/90 text-on-primary-container font-body-lg font-medium transition-colors duration-150 ease-in-out disabled:opacity-60 disabled:cursor-not-allowed';
  const secondaryBtnCls =
    'w-full flex items-center justify-center gap-2 rounded-lg py-2.5 px-4 bg-surface-container hover:bg-surface-container-high text-on-surface border border-outline-variant/50 font-body-md font-medium transition-colors duration-150 ease-in-out disabled:opacity-60 disabled:cursor-not-allowed';

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-primary-container to-on-primary-fixed-variant dark:from-[#0f172a] dark:to-[#1e1b4b]">
      <div className="w-full max-w-md">
        {/* Karte */}
        <div className="bg-surface dark:bg-surface-container-high rounded-xl shadow-lg border border-outline-variant/30 overflow-hidden">
          {/* Header */}
          <div className="pt-8 pb-6 px-8 flex flex-col items-center text-center">
            <div className="w-16 h-16 rounded-full flex items-center justify-center mb-4 bg-primary-container/10 dark:bg-primary-container">
              <Clock className="w-8 h-8 text-primary-container dark:text-on-primary-container" strokeWidth={2} />
            </div>
            <h1 className={`${companyNameSizeClass} font-headline-lg text-on-surface leading-tight break-words`} title={companyName}>
              {companyName}
            </h1>
            <p className="font-body-md text-body-md text-on-surface-variant mt-1">Zeiterfassung</p>
          </div>

          <div className="px-8 pb-8">
            {step === 'credentials' ? (
              <>
                <form onSubmit={handleCredentialSubmit} className="flex flex-col gap-stack_md">
                  <div className="flex flex-col gap-1">
                    <label className={labelCls} htmlFor="username">Benutzername</label>
                    <input
                      id="username"
                      type="text"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      className={inputCls}
                      placeholder="Benutzername eingeben"
                      required
                      autoComplete="username"
                    />
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className={labelCls} htmlFor="password">Passwort</label>
                    <input
                      id="password"
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className={inputCls}
                      placeholder="••••••••"
                      required
                      autoComplete="current-password"
                    />
                  </div>

                  <button type="submit" disabled={loading} className={`${primaryBtnCls} mt-2`}>
                    {loading ? (
                      <div className="w-5 h-5 border-2 border-on-primary-container border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <>
                        <LogIn size={20} />
                        Anmelden
                      </>
                    )}
                  </button>
                </form>

                {showSecondaryAuth && (
                  <>
                    {/* Trenner */}
                    <div className="relative flex items-center py-6">
                      <div className="flex-grow border-t border-outline-variant/60" />
                      <span className="flex-shrink-0 mx-4 text-on-surface-variant font-label-md text-label-md uppercase">oder</span>
                      <div className="flex-grow border-t border-outline-variant/60" />
                    </div>

                    {/* Alternative Anmeldungen */}
                    <div className="flex flex-col gap-3">
                      {showSsoButton && (
                        <button
                          type="button"
                          onClick={() => { window.location.href = '/api/auth/sso/login'; }}
                          className={secondaryBtnCls}
                        >
                          <KeyRound size={18} className="text-on-surface-variant" />
                          {branding?.ssoButtonLabel?.trim() || 'Single Sign-On'}
                        </button>
                      )}

                      {window.isSecureContext && !isNativeApp() && (
                        <button
                          type="button"
                          onClick={handlePasskeyLogin}
                          disabled={passkeyLoading}
                          className={secondaryBtnCls}
                        >
                          {passkeyLoading ? (
                            <div className="w-5 h-5 border-2 border-primary-container border-t-transparent rounded-full animate-spin" />
                          ) : (
                            <>
                              <Fingerprint size={18} className="text-on-surface-variant" />
                              Mit Passkey anmelden
                            </>
                          )}
                        </button>
                      )}
                    </div>
                  </>
                )}

                <div className="mt-6 text-center">
                  <Link
                    to="/forgot-password"
                    className="font-body-md text-body-md text-primary-container hover:text-primary-container/80 hover:underline transition-colors duration-150 ease-in-out"
                  >
                    Passwort vergessen?
                  </Link>
                </div>
              </>
            ) : (
              <>
                {/* TOTP-Schritt */}
                <div className="text-center mb-6">
                  <div className="inline-flex items-center justify-center w-12 h-12 bg-tertiary-container/20 dark:bg-tertiary-container rounded-full mb-3">
                    <ShieldCheck className="w-6 h-6 text-tertiary dark:text-on-tertiary-container" />
                  </div>
                  <h2 className="font-headline-md text-headline-md text-on-surface">Zwei-Faktor-Authentifizierung</h2>
                  <p className="font-body-md text-body-md text-on-surface-variant mt-1">
                    Gib den 6-stelligen Code aus deiner Authenticator-App ein.
                  </p>
                </div>

                <form onSubmit={handleTotpSubmit} className="flex flex-col gap-stack_md">
                  <input
                    ref={totpInputRef}
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={6}
                    value={totpCode}
                    onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ''))}
                    className={`${inputCls} text-center text-2xl tracking-[0.5em] font-mono`}
                    placeholder="000000"
                    autoComplete="one-time-code"
                  />

                  <button type="submit" disabled={loading || totpCode.length !== 6} className={`${primaryBtnCls} mt-2`}>
                    {loading ? (
                      <div className="w-5 h-5 border-2 border-on-primary-container border-t-transparent rounded-full animate-spin" />
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
                    onClick={() => { setStep('credentials'); setTempToken(''); setTotpCode(''); }}
                    className="inline-flex items-center gap-1 font-body-md text-body-md text-primary-container hover:text-primary-container/80 hover:underline transition-colors duration-150 ease-in-out"
                  >
                    <ArrowLeft size={16} />
                    Zurück zum Login
                  </button>
                </div>
              </>
            )}
          </div>

          {/* Bottom-Akzent */}
          <div className="h-1 w-full bg-primary-container" />
        </div>

        {/* Footer / Subtext + Server-URL (native App) */}
        <div className="mt-6 text-center">
          {isNativeApp() ? (
            <button
              onClick={() => setShowServerModal(true)}
              className="inline-flex items-center gap-1 font-body-md text-body-md text-on-primary-container/80 hover:text-on-primary-container"
            >
              <Server size={14} />
              Server: {getServerUrl() || getDefaultServerUrl()}
            </button>
          ) : (
            <p className="font-body-md text-body-md text-on-primary-container/80">Sichere Verbindung</p>
          )}
        </div>
      </div>

      {/* Server-Konfig-Modal */}
      {showServerModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-surface dark:bg-surface-container-high rounded-xl shadow-xl max-w-md w-full">
            <div className="p-5 border-b border-outline-variant/40 flex items-center gap-2">
              <Server size={20} className="text-primary-container" />
              <h3 className="font-headline-md text-headline-md text-on-surface">Server-URL konfigurieren</h3>
            </div>
            <div className="p-5 space-y-3">
              <p className="font-body-md text-body-md text-on-surface-variant">
                Adresse der Zeiterfassungs-Instanz, mit der sich diese App verbinden soll.
              </p>
              <input
                type="url"
                value={serverInput}
                onChange={(e) => setServerInput(e.target.value)}
                className={inputCls}
                placeholder="https://zeit.handy-insel.de"
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
              />
              <button
                type="button"
                onClick={() => setServerInput(getDefaultServerUrl())}
                className="font-body-md text-xs text-on-surface-variant hover:text-on-surface"
              >
                Auf Standard ({getDefaultServerUrl()}) zurücksetzen
              </button>
            </div>
            <div className="p-5 border-t border-outline-variant/40 flex justify-end gap-2">
              <button onClick={() => setShowServerModal(false)} className="btn btn-secondary">Abbrechen</button>
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
