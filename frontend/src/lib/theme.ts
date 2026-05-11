// Theme-Handling: "light" | "dark" | "system".
// - System-Präferenz wird über matchMedia('(prefers-color-scheme: dark)') gelesen.
// - Bei eingeloggten Nutzern ist die Quelle der Wahrheit employee.theme (in der DB).
// - Vor dem Login (oder bis der Store hydriert ist) dient localStorage 'theme-pref'
//   als Fallback, damit es keinen Flash gibt (siehe auch das Inline-Script in index.html).

export type ThemePref = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'theme-pref';

export function getStoredThemePref(): ThemePref {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'light' || v === 'dark' || v === 'system') return v;
  } catch {
    /* ignore */
  }
  return 'system';
}

export function setStoredThemePref(pref: ThemePref) {
  try {
    localStorage.setItem(STORAGE_KEY, pref);
  } catch {
    /* ignore */
  }
}

function prefersDark(): boolean {
  return typeof window !== 'undefined'
    && window.matchMedia
    && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function resolveDark(pref: ThemePref): boolean {
  return pref === 'dark' || (pref === 'system' && prefersDark());
}

let currentPref: ThemePref = getStoredThemePref();

export function applyTheme(pref: ThemePref) {
  currentPref = pref;
  setStoredThemePref(pref);
  const root = document.documentElement;
  if (resolveDark(pref)) {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }
}

// Auf Wechsel der System-Präferenz reagieren, solange "system" aktiv ist.
if (typeof window !== 'undefined' && window.matchMedia) {
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const onChange = () => {
    if (currentPref === 'system') applyTheme('system');
  };
  if (mq.addEventListener) mq.addEventListener('change', onChange);
  else if ((mq as any).addListener) (mq as any).addListener(onChange);
}
