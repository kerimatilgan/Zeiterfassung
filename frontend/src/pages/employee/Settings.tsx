import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { authApi } from '../../lib/api';
import { useAuthStore } from '../../store/authStore';
import { Lock, Eye, EyeOff, Save } from 'lucide-react';
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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (formData.newPassword !== formData.confirmPassword) {
      toast.error('Die neuen Passwörter stimmen nicht überein');
      return;
    }

    if (formData.newPassword.length < 6) {
      toast.error('Das neue Passwort muss mindestens 6 Zeichen haben');
      return;
    }

    changePasswordMutation.mutate();
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
          <div>
            <label className="label">Wochenstunden</label>
            <p className="text-gray-900">{employee?.weeklyHours} h</p>
          </div>
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

        <form onSubmit={handleSubmit} className="space-y-4 max-w-md">
          <div>
            <label className="label">Aktuelles Passwort</label>
            <div className="relative">
              <input
                type={showCurrentPassword ? 'text' : 'password'}
                value={formData.currentPassword}
                onChange={(e) =>
                  setFormData({ ...formData, currentPassword: e.target.value })
                }
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
                onChange={(e) =>
                  setFormData({ ...formData, newPassword: e.target.value })
                }
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
                onChange={(e) =>
                  setFormData({ ...formData, confirmPassword: e.target.value })
                }
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
    </div>
  );
}
