import { useState } from 'react';
import { Link } from 'react-router-dom';
import { authApi } from '../lib/api';
import toast from 'react-hot-toast';
import { Clock, Mail, ArrowLeft } from 'lucide-react';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      await authApi.forgotPassword(email);
      setSent(true);
      toast.success('Falls ein Konto existiert, wurde ein Reset-Link gesendet.');
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Fehler beim Senden des Reset-Links');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-500 to-primary-700 p-4">
      <div className="w-full max-w-md">
        <div className="card p-8">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-primary-100 rounded-full mb-4">
              <Clock className="w-8 h-8 text-primary-600" />
            </div>
            <h1 className="text-2xl font-bold text-gray-900">Passwort vergessen</h1>
            <p className="text-gray-500 mt-2">
              Geben Sie Ihre E-Mail-Adresse ein, um einen Reset-Link zu erhalten.
            </p>
          </div>

          {sent ? (
            <div className="text-center space-y-4">
              <div className="inline-flex items-center justify-center w-16 h-16 bg-green-100 rounded-full">
                <Mail className="w-8 h-8 text-green-600" />
              </div>
              <p className="text-gray-700">
                Falls ein Konto mit <strong>{email}</strong> existiert, wurde ein Link zum
                Zurücksetzen des Passworts gesendet.
              </p>
              <p className="text-sm text-gray-500">
                Bitte prüfen Sie auch Ihren Spam-Ordner.
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-6">
              <div>
                <label htmlFor="email" className="label">
                  E-Mail-Adresse
                </label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="input"
                  placeholder="ihre@email.de"
                  required
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
                    <Mail size={20} />
                    Reset-Link senden
                  </>
                )}
              </button>
            </form>
          )}

          <div className="mt-6 text-center">
            <Link
              to="/login"
              className="inline-flex items-center gap-1 text-sm text-primary-600 hover:text-primary-700 hover:underline"
            >
              <ArrowLeft size={16} />
              Zurück zum Login
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
