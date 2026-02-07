import nodemailer from 'nodemailer';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface MailSettings {
  smtpHost: string | null;
  smtpPort: number | null;
  smtpUser: string | null;
  smtpPassword: string | null;
  smtpFromAddress: string | null;
  smtpFromName: string | null;
  smtpSecure: boolean;
}

interface SendMailOptions {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
}

/**
 * Lädt die SMTP-Einstellungen aus der Datenbank
 */
async function getMailSettings(): Promise<MailSettings | null> {
  const settings = await prisma.settings.findUnique({
    where: { id: 'default' },
  });

  if (!settings?.smtpHost || !settings?.smtpFromAddress) {
    return null;
  }

  return {
    smtpHost: settings.smtpHost,
    smtpPort: settings.smtpPort,
    smtpUser: settings.smtpUser,
    smtpPassword: settings.smtpPassword,
    smtpFromAddress: settings.smtpFromAddress,
    smtpFromName: settings.smtpFromName,
    smtpSecure: settings.smtpSecure,
  };
}

/**
 * Erstellt einen Nodemailer-Transporter mit den aktuellen Einstellungen
 */
async function createTransporter() {
  const settings = await getMailSettings();

  if (!settings) {
    throw new Error('Mail-Server nicht konfiguriert');
  }

  return nodemailer.createTransport({
    host: settings.smtpHost!,
    port: settings.smtpPort || 587,
    secure: settings.smtpSecure,
    auth: settings.smtpUser
      ? {
          user: settings.smtpUser,
          pass: settings.smtpPassword || '',
        }
      : undefined,
  });
}

/**
 * Sendet eine E-Mail
 */
export async function sendEmail(options: SendMailOptions): Promise<void> {
  const settings = await getMailSettings();

  if (!settings) {
    console.log('[EMAIL] Mail-Server nicht konfiguriert - E-Mail wird nicht gesendet');
    return;
  }

  const transporter = await createTransporter();

  const fromName = settings.smtpFromName || 'Zeiterfassung';
  const from = `"${fromName}" <${settings.smtpFromAddress}>`;

  await transporter.sendMail({
    from,
    to: Array.isArray(options.to) ? options.to.join(', ') : options.to,
    subject: options.subject,
    html: options.html,
    text: options.text,
  });

  console.log(`[EMAIL] E-Mail gesendet an: ${options.to}`);
}

/**
 * Testet die SMTP-Verbindung
 */
export async function testConnection(): Promise<{ success: boolean; error?: string }> {
  try {
    const transporter = await createTransporter();
    await transporter.verify();
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unbekannter Fehler',
    };
  }
}

/**
 * Sendet eine Test-E-Mail
 */
export async function sendTestEmail(to: string): Promise<void> {
  await sendEmail({
    to,
    subject: 'Zeiterfassung - Test-E-Mail',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #3B82F6;">✓ E-Mail-Konfiguration erfolgreich!</h2>
        <p>Diese Test-E-Mail bestätigt, dass die Mail-Server-Einstellungen korrekt konfiguriert sind.</p>
        <hr style="border: none; border-top: 1px solid #E5E7EB; margin: 20px 0;">
        <p style="color: #6B7280; font-size: 12px;">
          Gesendet von der Zeiterfassung-Anwendung
        </p>
      </div>
    `,
    text: 'E-Mail-Konfiguration erfolgreich! Diese Test-E-Mail bestätigt, dass die Mail-Server-Einstellungen korrekt konfiguriert sind.',
  });
}

/**
 * Holt alle Admin-E-Mail-Adressen
 */
async function getAdminEmails(): Promise<string[]> {
  const admins = await prisma.employee.findMany({
    where: {
      isAdmin: true,
      isActive: true,
      email: { not: null },
    },
    select: { email: true },
  });

  return admins.map((a) => a.email!).filter(Boolean);
}

/**
 * Sendet eine Reklamations-Benachrichtigung an alle Admins
 */
export async function sendComplaintNotification(
  employeeName: string,
  entryDate: Date,
  clockIn: string,
  clockOut: string | null,
  complaintMessage: string
): Promise<void> {
  const adminEmails = await getAdminEmails();

  if (adminEmails.length === 0) {
    console.log('[EMAIL] Keine Admin-E-Mail-Adressen hinterlegt');
    return;
  }

  const dateStr = entryDate.toLocaleDateString('de-DE', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const timeRange = clockOut ? `${clockIn} - ${clockOut}` : `${clockIn} (noch aktiv)`;

  await sendEmail({
    to: adminEmails,
    subject: `Zeiterfassung - Reklamation von ${employeeName}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #F59E0B;">⚠️ Neue Reklamation</h2>

        <div style="background: #FEF3C7; border-left: 4px solid #F59E0B; padding: 15px; margin: 20px 0;">
          <p style="margin: 0; font-weight: bold;">${employeeName} hat einen Zeiteintrag reklamiert:</p>
        </div>

        <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
          <tr>
            <td style="padding: 10px; border-bottom: 1px solid #E5E7EB; color: #6B7280;">Mitarbeiter:</td>
            <td style="padding: 10px; border-bottom: 1px solid #E5E7EB; font-weight: bold;">${employeeName}</td>
          </tr>
          <tr>
            <td style="padding: 10px; border-bottom: 1px solid #E5E7EB; color: #6B7280;">Datum:</td>
            <td style="padding: 10px; border-bottom: 1px solid #E5E7EB; font-weight: bold;">${dateStr}</td>
          </tr>
          <tr>
            <td style="padding: 10px; border-bottom: 1px solid #E5E7EB; color: #6B7280;">Uhrzeit:</td>
            <td style="padding: 10px; border-bottom: 1px solid #E5E7EB; font-weight: bold;">${timeRange}</td>
          </tr>
          <tr>
            <td style="padding: 10px; color: #6B7280; vertical-align: top;">Nachricht:</td>
            <td style="padding: 10px;">
              <div style="background: #F3F4F6; padding: 10px; border-radius: 5px;">
                ${complaintMessage.replace(/\n/g, '<br>')}
              </div>
            </td>
          </tr>
        </table>

        <p>Bitte prüfen Sie den Eintrag in der Zeiterfassung-Anwendung.</p>

        <hr style="border: none; border-top: 1px solid #E5E7EB; margin: 20px 0;">
        <p style="color: #6B7280; font-size: 12px;">
          Diese Nachricht wurde automatisch von der Zeiterfassung-Anwendung gesendet.
        </p>
      </div>
    `,
    text: `Neue Reklamation von ${employeeName}\n\nMitarbeiter: ${employeeName}\nDatum: ${dateStr}\nUhrzeit: ${timeRange}\n\nNachricht:\n${complaintMessage}`,
  });
}

/**
 * Sendet eine Bestätigung an den Mitarbeiter, dass seine Reklamation bearbeitet wurde
 */
export async function sendComplaintResolvedNotification(
  employeeEmail: string,
  employeeName: string,
  adminName: string,
  entryDate: Date,
  originalComplaint: string,
  adminResponse: string | null,
  changes: {
    oldClockIn: string;
    oldClockOut: string | null;
    newClockIn: string;
    newClockOut: string | null;
    oldBreakMinutes: number;
    newBreakMinutes: number;
  }
): Promise<void> {
  const dateStr = entryDate.toLocaleDateString('de-DE', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  // Prüfen ob es Änderungen gab
  const hasChanges =
    changes.oldClockIn !== changes.newClockIn ||
    changes.oldClockOut !== changes.newClockOut ||
    changes.oldBreakMinutes !== changes.newBreakMinutes;

  // Änderungs-HTML erstellen
  let changesHtml = '';
  let changesText = '';

  if (hasChanges) {
    const oldTime = changes.oldClockOut
      ? `${changes.oldClockIn} - ${changes.oldClockOut}`
      : `${changes.oldClockIn} (noch aktiv)`;
    const newTime = changes.newClockOut
      ? `${changes.newClockIn} - ${changes.newClockOut}`
      : `${changes.newClockIn} (noch aktiv)`;

    changesHtml = `
      <div style="background: #ECFDF5; border-left: 4px solid #10B981; padding: 15px; margin: 20px 0;">
        <p style="margin: 0 0 10px 0; font-weight: bold; color: #059669;">Änderungen am Zeiteintrag:</p>
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="padding: 5px 10px; color: #6B7280;">Vorher:</td>
            <td style="padding: 5px 10px; text-decoration: line-through; color: #9CA3AF;">${oldTime}${changes.oldBreakMinutes > 0 ? ` (${changes.oldBreakMinutes} min Pause)` : ''}</td>
          </tr>
          <tr>
            <td style="padding: 5px 10px; color: #6B7280;">Nachher:</td>
            <td style="padding: 5px 10px; font-weight: bold; color: #059669;">${newTime}${changes.newBreakMinutes > 0 ? ` (${changes.newBreakMinutes} min Pause)` : ''}</td>
          </tr>
        </table>
      </div>
    `;
    changesText = `\n\nÄnderungen am Zeiteintrag:\nVorher: ${oldTime}${changes.oldBreakMinutes > 0 ? ` (${changes.oldBreakMinutes} min Pause)` : ''}\nNachher: ${newTime}${changes.newBreakMinutes > 0 ? ` (${changes.newBreakMinutes} min Pause)` : ''}`;
  } else {
    changesHtml = `
      <div style="background: #F3F4F6; border-left: 4px solid #9CA3AF; padding: 15px; margin: 20px 0;">
        <p style="margin: 0; color: #6B7280;">Keine Änderungen am Zeiteintrag vorgenommen.</p>
      </div>
    `;
    changesText = '\n\nKeine Änderungen am Zeiteintrag vorgenommen.';
  }

  // Admin-Antwort HTML
  const responseHtml = adminResponse
    ? `
      <div style="background: #EFF6FF; border-left: 4px solid #3B82F6; padding: 15px; margin: 20px 0;">
        <p style="margin: 0 0 10px 0; font-weight: bold; color: #1D4ED8;">Antwort von ${adminName}:</p>
        <p style="margin: 0; color: #374151;">${adminResponse.replace(/\n/g, '<br>')}</p>
      </div>
    `
    : '';
  const responseText = adminResponse ? `\n\nAntwort von ${adminName}:\n${adminResponse}` : '';

  await sendEmail({
    to: employeeEmail,
    subject: `Zeiterfassung - Ihre Reklamation wurde bearbeitet`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #10B981;">✓ Reklamation bearbeitet</h2>

        <p>Hallo ${employeeName},</p>
        <p>Ihre Reklamation zum Zeiteintrag vom <strong>${dateStr}</strong> wurde von ${adminName} bearbeitet.</p>

        <div style="background: #FEF3C7; border-left: 4px solid #F59E0B; padding: 15px; margin: 20px 0;">
          <p style="margin: 0 0 10px 0; font-weight: bold; color: #92400E;">Ihre ursprüngliche Nachricht:</p>
          <p style="margin: 0; color: #374151;">${originalComplaint.replace(/\n/g, '<br>')}</p>
        </div>

        ${responseHtml}

        ${changesHtml}

        <hr style="border: none; border-top: 1px solid #E5E7EB; margin: 20px 0;">
        <p style="color: #6B7280; font-size: 12px;">
          Diese Nachricht wurde automatisch von der Zeiterfassung-Anwendung gesendet.
        </p>
      </div>
    `,
    text: `Reklamation bearbeitet\n\nHallo ${employeeName},\n\nIhre Reklamation zum Zeiteintrag vom ${dateStr} wurde von ${adminName} bearbeitet.\n\nIhre ursprüngliche Nachricht:\n${originalComplaint}${responseText}${changesText}`,
  });
}
