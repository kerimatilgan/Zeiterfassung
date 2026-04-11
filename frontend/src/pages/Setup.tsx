import { useState, useEffect } from 'react';
import { Building2, User, ArrowRight, ArrowLeft, Check, Loader2, Mail, Monitor } from 'lucide-react';
import api from '../lib/api';
import toast, { Toaster } from 'react-hot-toast';

const STEPS = ['Willkommen', 'Unternehmen', 'E-Mail', 'Administrator', 'Terminal', 'Fertig'];

export default function SetupWizard({ onComplete }: { onComplete: () => void }) {
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    companyName: '',
    companyAddress: '',
    companyPhone: '',
    companyEmail: '',
    // SMTP
    smtpHost: '',
    smtpPort: 587,
    smtpUser: '',
    smtpPassword: '',
    smtpFromAddress: '',
    smtpFromName: 'Zeiterfassung',
    smtpSecure: false,
    // Admin
    firstName: '',
    lastName: '',
    username: '',
    email: '',
    password: '',
    passwordConfirm: '',
  });
  const [_setupResult, setSetupResult] = useState<any>(null);
  const [_terminalKey, setTerminalKey] = useState('');
  const [terminalId, setTerminalId] = useState('');

  const update = (field: string, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const canProceed = () => {
    switch (step) {
      case 0: return true;
      case 1: return formData.companyName.trim().length > 0;
      case 2: return true; // E-Mail ist optional
      case 3: return (
        formData.firstName.trim().length > 0 &&
        formData.lastName.trim().length > 0 &&
        formData.username.trim().length >= 3 &&
        formData.password.length >= 6 &&
        formData.password === formData.passwordConfirm
      );
      case 4: return true; // Terminal ist info only
      default: return true;
    }
  };

  const handleNext = async () => {
    if (step < 3) {
      setStep(step + 1);
      return;
    }

    // Step 3 (Admin) → Setup ausführen
    if (step === 3) {
      if (formData.password !== formData.passwordConfirm) {
        toast.error('Passwörter stimmen nicht überein');
        return;
      }

      setLoading(true);
      try {
        const res = await api.post('/setup/complete', {
          companyName: formData.companyName,
          companyAddress: formData.companyAddress || undefined,
          companyPhone: formData.companyPhone || undefined,
          companyEmail: formData.companyEmail || undefined,
          smtpHost: formData.smtpHost || undefined,
          smtpPort: formData.smtpHost ? formData.smtpPort : undefined,
          smtpUser: formData.smtpUser || undefined,
          smtpPassword: formData.smtpPassword || undefined,
          smtpFromAddress: formData.smtpFromAddress || undefined,
          smtpFromName: formData.smtpFromName || undefined,
          smtpSecure: formData.smtpHost ? formData.smtpSecure : undefined,
          firstName: formData.firstName,
          lastName: formData.lastName,
          username: formData.username,
          email: formData.email || undefined,
          password: formData.password,
        });
        setSetupResult(res.data);

        // Terminal-Key laden
        try {
          const loginRes = await api.post('/auth/login', {
            username: formData.username,
            password: formData.password,
          });
          const token = loginRes.data.token;
          const terminalsRes = await api.get('/settings/terminals', {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (terminalsRes.data.length > 0) {
            setTerminalKey(terminalsRes.data[0].apiKey);
            setTerminalId(terminalsRes.data[0].id);
          }
        } catch {}

        setStep(4); // Terminal-Schritt
      } catch (error: any) {
        toast.error(error.response?.data?.error || 'Fehler bei der Einrichtung');
      }
      setLoading(false);
      return;
    }

    // Step 4 → Fertig
    if (step === 4) {
      setStep(5);
    }
  };

  const [backendUrl, setBackendUrl] = useState(window.location.origin);

  useEffect(() => {
    fetch('/api/health').then(r => r.json()).then(d => {
      if (d.baseUrl) setBackendUrl(d.baseUrl);
    }).catch(() => {});
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-blue-50 flex items-center justify-center p-4">
      <Toaster position="top-right" />
      <div className="w-full max-w-lg">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-600 rounded-2xl mb-4">
            <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/>
              <polyline points="12 6 12 12 16 14"/>
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Zeiterfassung</h1>
          <p className="text-gray-500 mt-1">Ersteinrichtung</p>
        </div>

        {/* Progress */}
        <div className="flex items-center justify-center gap-1.5 mb-8">
          {STEPS.map((label, i) => (
            <div key={label} className="flex items-center gap-1.5">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium transition-all ${
                i < step ? 'bg-green-500 text-white' :
                i === step ? 'bg-blue-600 text-white' :
                'bg-gray-200 text-gray-500'
              }`}>
                {i < step ? <Check size={14} /> : i + 1}
              </div>
              {i < STEPS.length - 1 && (
                <div className={`w-6 h-0.5 ${i < step ? 'bg-green-500' : 'bg-gray-200'}`} />
              )}
            </div>
          ))}
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-xl border border-gray-100 overflow-hidden">
          {/* Step 0: Willkommen */}
          {step === 0 && (
            <div className="p-8 text-center">
              <div className="w-20 h-20 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-6">
                <Building2 className="w-10 h-10 text-blue-600" />
              </div>
              <h2 className="text-xl font-bold text-gray-900 mb-3">Willkommen!</h2>
              <p className="text-gray-600 mb-2">Richte deine Zeiterfassung in wenigen Schritten ein.</p>
              <p className="text-sm text-gray-500">
                Unternehmen, E-Mail-Server, Administrator und Terminal – alles wird automatisch konfiguriert.
                Feiertage und Abwesenheitstypen werden ebenfalls eingerichtet.
              </p>
            </div>
          )}

          {/* Step 1: Unternehmen */}
          {step === 1 && (
            <div className="p-8">
              <div className="flex items-center gap-3 mb-6">
                <div className="p-2.5 bg-blue-100 rounded-lg"><Building2 className="w-5 h-5 text-blue-600" /></div>
                <div>
                  <h2 className="text-lg font-bold text-gray-900">Unternehmen</h2>
                  <p className="text-sm text-gray-500">Feiertage werden anhand der PLZ automatisch ermittelt</p>
                </div>
              </div>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Firmenname <span className="text-red-500">*</span></label>
                  <input type="text" value={formData.companyName} onChange={e => update('companyName', e.target.value)}
                    className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="z.B. Handy-Insel GmbH" autoFocus />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Adresse <span className="text-xs text-gray-400">(mit PLZ für automatische Feiertage)</span>
                  </label>
                  <input type="text" value={formData.companyAddress} onChange={e => update('companyAddress', e.target.value)}
                    className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="Musterstraße 1, 83714 Miesbach" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Telefon</label>
                    <input type="tel" value={formData.companyPhone} onChange={e => update('companyPhone', e.target.value)}
                      className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">E-Mail</label>
                    <input type="email" value={formData.companyEmail} onChange={e => update('companyEmail', e.target.value)}
                      className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Step 2: E-Mail-Server */}
          {step === 2 && (
            <div className="p-8">
              <div className="flex items-center gap-3 mb-6">
                <div className="p-2.5 bg-blue-100 rounded-lg"><Mail className="w-5 h-5 text-blue-600" /></div>
                <div>
                  <h2 className="text-lg font-bold text-gray-900">E-Mail-Server</h2>
                  <p className="text-sm text-gray-500">Optional – für Benachrichtigungen und Passwort-Reset</p>
                </div>
              </div>
              <div className="space-y-4">
                <div className="grid grid-cols-3 gap-4">
                  <div className="col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-1">SMTP-Server</label>
                    <input type="text" value={formData.smtpHost} onChange={e => update('smtpHost', e.target.value)}
                      className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      placeholder="smtp.gmail.com" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Port</label>
                    <input type="number" value={formData.smtpPort} onChange={e => update('smtpPort', parseInt(e.target.value) || 587)}
                      className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Benutzername</label>
                    <input type="text" value={formData.smtpUser} onChange={e => update('smtpUser', e.target.value)}
                      className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Passwort</label>
                    <input type="password" value={formData.smtpPassword} onChange={e => update('smtpPassword', e.target.value)}
                      className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Absender-Adresse</label>
                    <input type="email" value={formData.smtpFromAddress} onChange={e => update('smtpFromAddress', e.target.value)}
                      className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      placeholder="noreply@firma.de" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Absender-Name</label>
                    <input type="text" value={formData.smtpFromName} onChange={e => update('smtpFromName', e.target.value)}
                      className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
                  </div>
                </div>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={formData.smtpSecure} onChange={e => update('smtpSecure', e.target.checked)} className="rounded" />
                  <span className="text-sm text-gray-700">SSL/TLS verwenden (Port 465)</span>
                </label>
                {!formData.smtpHost && (
                  <p className="text-sm text-gray-400 bg-gray-50 p-3 rounded-lg">
                    Du kannst diesen Schritt überspringen und den E-Mail-Server später in den Einstellungen konfigurieren.
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Step 3: Administrator */}
          {step === 3 && (
            <div className="p-8">
              <div className="flex items-center gap-3 mb-6">
                <div className="p-2.5 bg-blue-100 rounded-lg"><User className="w-5 h-5 text-blue-600" /></div>
                <div>
                  <h2 className="text-lg font-bold text-gray-900">Administrator</h2>
                  <p className="text-sm text-gray-500">Dein Admin-Zugang</p>
                </div>
              </div>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Vorname <span className="text-red-500">*</span></label>
                    <input type="text" value={formData.firstName} onChange={e => update('firstName', e.target.value)}
                      className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500" autoFocus />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Nachname <span className="text-red-500">*</span></label>
                    <input type="text" value={formData.lastName} onChange={e => update('lastName', e.target.value)}
                      className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Benutzername <span className="text-red-500">*</span></label>
                  <input type="text" value={formData.username} onChange={e => update('username', e.target.value)}
                    className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="z.B. admin.firma" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">E-Mail</label>
                  <input type="email" value={formData.email} onChange={e => update('email', e.target.value)}
                    className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Passwort <span className="text-red-500">*</span></label>
                    <input type="password" value={formData.password} onChange={e => update('password', e.target.value)}
                      className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      placeholder="Min. 6 Zeichen" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Bestätigen <span className="text-red-500">*</span></label>
                    <input type="password" value={formData.passwordConfirm} onChange={e => update('passwordConfirm', e.target.value)}
                      className={`w-full px-4 py-2.5 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                        formData.passwordConfirm && formData.password !== formData.passwordConfirm ? 'border-red-300 bg-red-50' : 'border-gray-300'
                      }`} />
                  </div>
                </div>
                {formData.passwordConfirm && formData.password !== formData.passwordConfirm && (
                  <p className="text-sm text-red-600">Passwörter stimmen nicht überein</p>
                )}
              </div>
            </div>
          )}

          {/* Step 4: Terminal */}
          {step === 4 && (
            <div className="p-8">
              <div className="flex items-center gap-3 mb-6">
                <div className="p-2.5 bg-blue-100 rounded-lg"><Monitor className="w-5 h-5 text-blue-600" /></div>
                <div>
                  <h2 className="text-lg font-bold text-gray-900">Stempelterminal</h2>
                  <p className="text-sm text-gray-500">Raspberry Pi Terminal einrichten (optional)</p>
                </div>
              </div>
              <div className="space-y-4">
                <p className="text-sm text-gray-600">
                  Ein Stempelterminal wurde automatisch erstellt. Führe folgenden Befehl auf dem Raspberry Pi aus um das Terminal zu installieren:
                </p>
                {terminalId ? (
                  <>
                    <div className="bg-gray-900 text-gray-100 rounded-lg p-4 font-mono text-sm overflow-x-auto">
                      <span className="text-gray-400">$</span> curl -sL {backendUrl}/api/setup/terminal-install/{terminalId} | bash
                    </div>
                    <button onClick={() => {
                      navigator.clipboard.writeText(`curl -sL ${backendUrl}/api/setup/terminal-install/${terminalId} | bash`);
                      toast.success('Befehl kopiert!');
                    }} className="text-sm text-blue-600 hover:text-blue-700 font-medium">
                      Befehl in Zwischenablage kopieren
                    </button>
                  </>
                ) : (
                  <div className="bg-gray-50 p-3 rounded-lg text-sm text-gray-500">
                    Terminal wird erstellt...
                  </div>
                )}
                <p className="text-xs text-gray-400 bg-gray-50 p-3 rounded-lg">
                  Das Script installiert alle Abhängigkeiten, lädt die Software herunter und richtet den Autostart ein.
                  Du kannst weitere Terminals später in den Einstellungen hinzufügen.
                </p>
              </div>
            </div>
          )}

          {/* Step 5: Fertig */}
          {step === 5 && (
            <div className="p-8 text-center">
              <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
                <Check className="w-10 h-10 text-green-600" />
              </div>
              <h2 className="text-xl font-bold text-gray-900 mb-3">Einrichtung abgeschlossen!</h2>
              <p className="text-gray-600 mb-4">Deine Zeiterfassung ist bereit.</p>
              <div className="bg-gray-50 rounded-lg p-4 text-left text-sm space-y-2">
                <p className="font-medium text-gray-900">Was wurde eingerichtet:</p>
                <ul className="space-y-1 text-gray-600">
                  <li className="flex items-center gap-2"><Check size={14} className="text-green-500" /> Administrator-Account</li>
                  <li className="flex items-center gap-2"><Check size={14} className="text-green-500" /> Abwesenheitstypen (Urlaub, Krank, etc.)</li>
                  <li className="flex items-center gap-2"><Check size={14} className="text-green-500" /> Feiertage (automatisch erkannt)</li>
                  <li className="flex items-center gap-2"><Check size={14} className="text-green-500" /> Stempelterminal</li>
                  <li className="flex items-center gap-2"><Check size={14} className="text-green-500" /> Dokumenttypen</li>
                  {formData.smtpHost && (
                    <li className="flex items-center gap-2"><Check size={14} className="text-green-500" /> E-Mail-Server</li>
                  )}
                </ul>
              </div>
              <div className="bg-blue-50 rounded-lg p-4 text-left text-sm mt-4">
                <p className="text-gray-500">Anmeldedaten:</p>
                <p className="font-medium text-gray-900 mt-1">Benutzername: {formData.username}</p>
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="px-8 pb-8 flex items-center justify-between">
            {step > 0 && step < 5 ? (
              <button onClick={() => setStep(step - 1)} disabled={step === 4}
                className="flex items-center gap-2 px-4 py-2.5 text-gray-600 hover:bg-gray-100 rounded-lg transition disabled:opacity-30">
                <ArrowLeft size={16} /> Zurück
              </button>
            ) : <div />}

            {step < 5 ? (
              <button onClick={handleNext} disabled={!canProceed() || loading}
                className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition font-medium">
                {loading ? (
                  <><Loader2 size={16} className="animate-spin" /> Wird eingerichtet...</>
                ) : step === 3 ? (
                  <><Check size={16} /> Einrichtung starten</>
                ) : (
                  <><ArrowRight size={16} /> Weiter</>
                )}
              </button>
            ) : (
              <button onClick={onComplete}
                className="flex items-center gap-2 px-6 py-2.5 bg-green-600 text-white rounded-lg hover:bg-green-700 transition font-medium mx-auto">
                <ArrowRight size={16} /> Zur Anmeldung
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
