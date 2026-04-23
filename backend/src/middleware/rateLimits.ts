import rateLimit from 'express-rate-limit';

// Basis-Config für alle Auth-bezogenen Limiter
const baseOpts = {
  standardHeaders: 'draft-7' as const,  // RateLimit-* Headers (RFC draft)
  legacyHeaders: false,                 // kein X-RateLimit-* (älter)
  skipSuccessfulRequests: false,
};

// Login: 10 Versuche / 15 min pro IP
export const loginLimiter = rateLimit({
  ...baseOpts,
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Zu viele Login-Versuche. Bitte in 15 Minuten erneut versuchen.' },
});

// Passwort-Reset-Anforderung: 5 / Stunde pro IP (verhindert Mail-Spam + User-Enumeration-Massencheck)
export const forgotPasswordLimiter = rateLimit({
  ...baseOpts,
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: { error: 'Zu viele Reset-Anfragen. Bitte in einer Stunde erneut versuchen.' },
});

// Passwort-Reset-Submit: 10 / 15 min pro IP (Token-Brute-Force)
export const resetPasswordLimiter = rateLimit({
  ...baseOpts,
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Zu viele Reset-Versuche. Bitte in 15 Minuten erneut versuchen.' },
});

// 2FA-Codes (TOTP / WebAuthn): 5 / 15 min pro IP (6-stelliger Code sonst in Stunden bruteforcebar)
export const twoFactorLimiter = rateLimit({
  ...baseOpts,
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Zu viele 2FA-Versuche. Bitte in 15 Minuten erneut versuchen.' },
});

// Terminal-PIN: 20 / 15 min pro IP (4-stelliger PIN sonst schnell bruteforcebar)
export const pinLimiter = rateLimit({
  ...baseOpts,
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Zu viele PIN-Versuche. Bitte warten.' },
});
