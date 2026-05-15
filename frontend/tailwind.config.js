/** @type {import('tailwindcss').Config} */
//
// Zeiterfassung-Design-System ("Chronos Precision", aus Stitch übernommen).
//
// Zwei Color-Systeme nebeneinander, beide aktiv:
//   1) primary-50..900 — der alte Tailwind-Scale. Wird von Bestandsseiten
//      genutzt und bleibt funktional, bis die jeweilige Seite migriert wird.
//   2) Material-3-Tokens (surface, on-surface, primary-container, …) als
//      rgb(var(--m3-*) / <alpha-value>)-Referenzen. So flippen `bg-surface`,
//      `text-on-surface` etc. automatisch zwischen Light- und Dark-Mode.
//      Die konkreten Variablenwerte stehen in src/index.css.
//
// Achtung — Konflikt-Vermeidung: M3 hat ein flaches Token `primary`, der
// bestehende Scale auch (primary.50..900). Wir registrieren M3 `primary` daher
// NICHT — wenn ein Stitch-HTML `bg-primary` referenziert, mappen wir das beim
// Port auf `primary-600`. `secondary`, `tertiary`, `error` und `background`
// haben keinen Konflikt und werden direkt registriert.
const v = (name) => `rgb(var(${name}) / <alpha-value>)`;

export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Bestandsfarben — bleiben für nicht-migrierte Seiten.
        primary: {
          50: '#eff6ff',
          100: '#dbeafe',
          200: '#bfdbfe',
          300: '#93c5fd',
          400: '#60a5fa',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
          800: '#1e40af',
          900: '#1e3a8a',
        },
        // Material-3-Tokens (flippen Light/Dark via CSS-Variablen)
        background: v('--m3-background'),
        surface: v('--m3-surface'),
        'surface-dim': v('--m3-surface-dim'),
        'surface-bright': v('--m3-surface-bright'),
        'surface-container-lowest': v('--m3-surface-container-lowest'),
        'surface-container-low': v('--m3-surface-container-low'),
        'surface-container': v('--m3-surface-container'),
        'surface-container-high': v('--m3-surface-container-high'),
        'surface-container-highest': v('--m3-surface-container-highest'),
        'surface-variant': v('--m3-surface-variant'),
        'on-surface': v('--m3-on-surface'),
        'on-surface-variant': v('--m3-on-surface-variant'),
        'on-background': v('--m3-on-background'),
        'on-primary': v('--m3-on-primary'),
        'primary-container': v('--m3-primary-container'),
        'on-primary-container': v('--m3-on-primary-container'),
        secondary: v('--m3-secondary'),
        'on-secondary': v('--m3-on-secondary'),
        'secondary-container': v('--m3-secondary-container'),
        'on-secondary-container': v('--m3-on-secondary-container'),
        tertiary: v('--m3-tertiary'),
        'on-tertiary': v('--m3-on-tertiary'),
        'tertiary-container': v('--m3-tertiary-container'),
        'on-tertiary-container': v('--m3-on-tertiary-container'),
        error: v('--m3-error'),
        'on-error': v('--m3-on-error'),
        'error-container': v('--m3-error-container'),
        'on-error-container': v('--m3-on-error-container'),
        outline: v('--m3-outline'),
        'outline-variant': v('--m3-outline-variant'),
        'inverse-surface': v('--m3-inverse-surface'),
        'inverse-on-surface': v('--m3-inverse-on-surface'),
        'inverse-primary': v('--m3-inverse-primary'),
        // Fixed-Tokens (gleich in Light + Dark)
        'primary-fixed': v('--m3-primary-fixed'),
        'primary-fixed-dim': v('--m3-primary-fixed-dim'),
        'on-primary-fixed': v('--m3-on-primary-fixed'),
        'on-primary-fixed-variant': v('--m3-on-primary-fixed-variant'),
        'secondary-fixed': v('--m3-secondary-fixed'),
        'secondary-fixed-dim': v('--m3-secondary-fixed-dim'),
        'on-secondary-fixed': v('--m3-on-secondary-fixed'),
        'on-secondary-fixed-variant': v('--m3-on-secondary-fixed-variant'),
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto', 'sans-serif'],
        display: ['Inter', 'sans-serif'],
        'headline-lg': ['Inter', 'sans-serif'],
        'headline-md': ['Inter', 'sans-serif'],
        'body-lg': ['Inter', 'sans-serif'],
        'body-md': ['Inter', 'sans-serif'],
        'label-md': ['Inter', 'sans-serif'],
        'stat-number': ['Inter', 'sans-serif'],
      },
      fontSize: {
        display: ['36px', { lineHeight: '44px', letterSpacing: '-0.02em', fontWeight: '700' }],
        'headline-lg': ['24px', { lineHeight: '32px', letterSpacing: '-0.01em', fontWeight: '600' }],
        'headline-md': ['20px', { lineHeight: '28px', fontWeight: '600' }],
        'body-lg': ['16px', { lineHeight: '24px', fontWeight: '400' }],
        'body-md': ['14px', { lineHeight: '20px', fontWeight: '400' }],
        'label-md': ['12px', { lineHeight: '16px', letterSpacing: '0.05em', fontWeight: '500' }],
        'stat-number': ['32px', { lineHeight: '40px', letterSpacing: '-0.02em', fontWeight: '700' }],
      },
      spacing: {
        stack_sm: '8px',
        stack_md: '16px',
        stack_lg: '24px',
        gutter: '16px',
        sidebar_width: '256px',
        container_padding: '24px',
      },
      borderRadius: {
        lg: '0.5rem',  // 8 px — Buttons, Inputs
        xl: '0.75rem', // 12 px — Cards, Modals
      },
    },
  },
  plugins: [],
}
