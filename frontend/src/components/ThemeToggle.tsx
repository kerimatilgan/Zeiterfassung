import { Sun, Moon, Monitor } from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { employeesApi } from '../lib/api';
import { applyTheme, getStoredThemePref, type ThemePref } from '../lib/theme';

const OPTIONS: { value: ThemePref; icon: typeof Sun; label: string }[] = [
  { value: 'light', icon: Sun, label: 'Hell' },
  { value: 'dark', icon: Moon, label: 'Dunkel' },
  { value: 'system', icon: Monitor, label: 'System' },
];

export default function ThemeToggle() {
  const { employee, isAuthenticated, updateEmployee } = useAuthStore();
  const current: ThemePref = (employee?.theme as ThemePref) ?? getStoredThemePref();

  const choose = (value: ThemePref) => {
    if (value === current) return;
    applyTheme(value);
    if (isAuthenticated) {
      updateEmployee({ theme: value });
      employeesApi.setTheme(value).catch(() => {
        /* still applied lokal; nächster /auth/me-Refresh korrigiert ggf. */
      });
    }
  };

  return (
    <div className="inline-flex items-center gap-1 p-1 rounded-lg bg-gray-100 dark:bg-gray-800">
      {OPTIONS.map(({ value, icon: Icon, label }) => {
        const active = value === current;
        return (
          <button
            key={value}
            type="button"
            onClick={() => choose(value)}
            title={label}
            aria-label={`Theme: ${label}`}
            aria-pressed={active}
            className={`flex items-center justify-center w-8 h-8 rounded-md transition-colors ${
              active
                ? 'bg-white dark:bg-gray-700 text-primary-600 dark:text-primary-400 shadow-sm'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
            }`}
          >
            <Icon size={16} />
          </button>
        );
      })}
    </div>
  );
}
