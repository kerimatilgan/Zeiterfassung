import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { settingsApi } from '../../lib/api';
import toast from 'react-hot-toast';
import { KeyRound, Copy, Check } from 'lucide-react';

interface SsoConfig {
  oidcEnabled: boolean;
  oidcIssuer: string;
  oidcClientId: string;
  oidcClientSecretSet: boolean;
  oidcButtonLabel: string;
  redirectUri: string;
}

export default function SsoSettings() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['sso-settings'],
    queryFn: () => settingsApi.getSso().then((r) => r.data as SsoConfig),
  });

  const [enabled, setEnabled] = useState(false);
  const [issuer, setIssuer] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState(''); // leer = unverändert (wenn schon gesetzt)
  const [clearSecret, setClearSecret] = useState(false);
  const [buttonLabel, setButtonLabel] = useState('Mit Authentik anmelden');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (data) {
      setEnabled(data.oidcEnabled);
      setIssuer(data.oidcIssuer || '');
      setClientId(data.oidcClientId || '');
      setButtonLabel(data.oidcButtonLabel || 'Mit Authentik anmelden');
      setClientSecret('');
      setClearSecret(false);
    }
  }, [data]);

  const secretIsSet = !!data?.oidcClientSecretSet;

  const saveMutation = useMutation({
    mutationFn: () => {
      let oidcClientSecret: string | undefined;
      if (clearSecret) oidcClientSecret = '';
      else if (clientSecret.trim()) oidcClientSecret = clientSecret.trim();
      else oidcClientSecret = secretIsSet ? '********' : '';
      return settingsApi.updateSso({
        oidcEnabled: enabled,
        oidcIssuer: issuer.trim(),
        oidcClientId: clientId.trim(),
        oidcClientSecret,
        oidcButtonLabel: buttonLabel.trim(),
      });
    },
    onSuccess: () => {
      toast.success('SSO-Einstellungen gespeichert');
      queryClient.invalidateQueries({ queryKey: ['sso-settings'] });
      queryClient.invalidateQueries({ queryKey: ['public-branding'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Speichern fehlgeschlagen'),
  });

  const copyRedirect = async () => {
    try {
      await navigator.clipboard.writeText(data?.redirectUri || '');
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="card">
      <div className="p-6 border-b border-gray-100 dark:border-gray-800">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
          <KeyRound size={20} />
          Single Sign-On (OIDC / Authentik)
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Anmeldung über einen OpenID-Connect-Provider. Es werden nur Nutzerinfos (E-Mail, Name) übernommen —
          keine Rollen/Berechtigungen. Ein bestehender Nutzer wird anhand seiner E-Mail-Adresse erkannt und beim
          ersten SSO-Login verknüpft. <strong>Neue Nutzer können sich nicht selbst registrieren.</strong>
        </p>
      </div>

      <div className="p-6 space-y-5">
        {isLoading ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">Laden…</p>
        ) : (
          <>
            <label className="flex items-center gap-3 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
                className="w-4 h-4"
              />
              <span className="text-sm font-medium text-gray-900 dark:text-gray-100">SSO aktivieren</span>
            </label>

            <div className="rounded-lg bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 p-3 text-sm text-blue-800 dark:text-blue-300">
              <div className="font-medium mb-1">Redirect-URI für den OIDC-Client (in Authentik eintragen):</div>
              <div className="flex items-center gap-2">
                <code className="flex-1 break-all bg-white/60 dark:bg-gray-900/60 rounded px-2 py-1 text-xs">
                  {data?.redirectUri || '— (FRONTEND_URL nicht gesetzt)'}
                </code>
                <button
                  type="button"
                  onClick={copyRedirect}
                  disabled={!data?.redirectUri}
                  className="btn btn-secondary text-xs flex items-center gap-1 shrink-0"
                >
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                  {copied ? 'Kopiert' : 'Kopieren'}
                </button>
              </div>
              <div className="mt-2 text-xs">
                Scopes: <code>openid email profile</code> · Client-Typ: vertraulich (Confidential) · Auth-Code-Flow mit PKCE.
              </div>
            </div>

            <div>
              <label className="label">Issuer-URL (Discovery)</label>
              <input
                type="url"
                value={issuer}
                onChange={(e) => setIssuer(e.target.value)}
                placeholder="https://auth.example.com/application/o/zeiterfassung/"
                className="input"
              />
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                Die Basis-URL des Providers (ohne <code>/.well-known/...</code>). Bei Authentik: „OpenID Configuration Issuer" aus dem Provider.
              </p>
            </div>

            <div>
              <label className="label">Client-ID</label>
              <input
                type="text"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                placeholder="z.B. zeiterfassung"
                className="input"
              />
            </div>

            <div>
              <label className="label">Client-Secret</label>
              <input
                type="password"
                value={clientSecret}
                onChange={(e) => { setClientSecret(e.target.value); if (e.target.value) setClearSecret(false); }}
                placeholder={secretIsSet ? '•••••••• (gespeichert — leer lassen = unverändert)' : 'Client-Secret eingeben'}
                disabled={clearSecret}
                className="input"
                autoComplete="new-password"
              />
              {secretIsSet && (
                <label className="flex items-center gap-2 mt-2 text-xs text-gray-500 dark:text-gray-400 cursor-pointer">
                  <input type="checkbox" checked={clearSecret} onChange={(e) => setClearSecret(e.target.checked)} className="w-3.5 h-3.5" />
                  Gespeichertes Secret entfernen
                </label>
              )}
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Wird verschlüsselt gespeichert und nie wieder angezeigt.</p>
            </div>

            <div>
              <label className="label">Beschriftung des Login-Buttons</label>
              <input
                type="text"
                value={buttonLabel}
                onChange={(e) => setButtonLabel(e.target.value)}
                placeholder="Mit Authentik anmelden"
                maxLength={80}
                className="input"
              />
            </div>

            <div className="pt-2">
              <button
                onClick={() => saveMutation.mutate()}
                disabled={saveMutation.isPending}
                className="btn btn-primary text-sm"
              >
                {saveMutation.isPending ? 'Speichere…' : 'Speichern'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
