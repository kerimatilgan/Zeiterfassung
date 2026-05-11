import { useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import api from '../lib/api';

// Landet hier, nachdem das Backend den OIDC-Login abgeschlossen und ein App-JWT
// per ?token=... übergeben hat. Holt das Profil über /auth/me und loggt ein.
export default function SsoCallback() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    const token = searchParams.get('token');
    if (!token) {
      navigate('/login?sso_error=' + encodeURIComponent('SSO-Anmeldung fehlgeschlagen.'), { replace: true });
      return;
    }

    // Token vorab in den Store legen, damit der Axios-Interceptor ihn mitschickt.
    useAuthStore.setState({ token });
    api
      .get('/auth/me')
      .then((res) => {
        useAuthStore.getState().login(token, res.data);
        navigate(res.data?.isAdmin ? '/admin' : '/dashboard', { replace: true });
      })
      .catch(() => {
        useAuthStore.getState().logout();
        navigate('/login?sso_error=' + encodeURIComponent('SSO-Anmeldung fehlgeschlagen.'), { replace: true });
      });
  }, [searchParams, navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100 dark:bg-gray-950">
      <div className="flex flex-col items-center gap-3 text-gray-600 dark:text-gray-300">
        <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
        <p>Anmeldung läuft…</p>
      </div>
    </div>
  );
}
