import nodemailer from 'nodemailer';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// HTML-Escape für User-Input in Mail-Templates. Verhindert Injection
// (Phishing-Links in Reklamations-Text an Admin, etc.)
function h(s: string | null | undefined): string {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]!));
}

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
 * Sendet eine Passwort-Reset-E-Mail
 */
export async function sendPasswordResetEmail(
  to: string,
  firstName: string,
  resetUrl: string
): Promise<void> {
  await sendEmail({
    to,
    subject: 'Zeiterfassung - Passwort zurücksetzen',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #3B82F6;">Passwort zurücksetzen</h2>

        <p>Hallo ${h(firstName)},</p>
        <p>es wurde eine Anfrage zum Zurücksetzen Ihres Passworts gestellt.</p>

        <div style="text-align: center; margin: 30px 0;">
          <a href="${h(resetUrl)}"
             style="display: inline-block; background: #3B82F6; color: white; padding: 12px 30px;
                    text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 16px;">
            Neues Passwort setzen
          </a>
        </div>

        <p style="color: #6B7280; font-size: 14px;">
          Dieser Link ist <strong>1 Stunde</strong> gültig. Falls Sie diese Anfrage nicht gestellt haben,
          können Sie diese E-Mail ignorieren.
        </p>

        <p style="color: #9CA3AF; font-size: 12px; margin-top: 20px;">
          Falls der Button nicht funktioniert, kopieren Sie diesen Link in Ihren Browser:<br>
          <a href="${h(resetUrl)}" style="color: #3B82F6; word-break: break-all;">${h(resetUrl)}</a>
        </p>

        <hr style="border: none; border-top: 1px solid #E5E7EB; margin: 20px 0;">
        <p style="color: #6B7280; font-size: 12px;">
          Diese Nachricht wurde automatisch von der Zeiterfassung-Anwendung gesendet.
        </p>
      </div>
    `,
    text: `Hallo ${firstName},\n\nes wurde eine Anfrage zum Zurücksetzen Ihres Passworts gestellt.\n\nBitte öffnen Sie folgenden Link: ${resetUrl}\n\nDieser Link ist 1 Stunde gültig.\n\nFalls Sie diese Anfrage nicht gestellt haben, können Sie diese E-Mail ignorieren.`,
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
          <p style="margin: 0; font-weight: bold;">${h(employeeName)} hat einen Zeiteintrag reklamiert:</p>
        </div>

        <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
          <tr>
            <td style="padding: 10px; border-bottom: 1px solid #E5E7EB; color: #6B7280;">Mitarbeiter:</td>
            <td style="padding: 10px; border-bottom: 1px solid #E5E7EB; font-weight: bold;">${h(employeeName)}</td>
          </tr>
          <tr>
            <td style="padding: 10px; border-bottom: 1px solid #E5E7EB; color: #6B7280;">Datum:</td>
            <td style="padding: 10px; border-bottom: 1px solid #E5E7EB; font-weight: bold;">${h(dateStr)}</td>
          </tr>
          <tr>
            <td style="padding: 10px; border-bottom: 1px solid #E5E7EB; color: #6B7280;">Uhrzeit:</td>
            <td style="padding: 10px; border-bottom: 1px solid #E5E7EB; font-weight: bold;">${h(timeRange)}</td>
          </tr>
          <tr>
            <td style="padding: 10px; color: #6B7280; vertical-align: top;">Nachricht:</td>
            <td style="padding: 10px;">
              <div style="background: #F3F4F6; padding: 10px; border-radius: 5px;">
                ${h(complaintMessage).replace(/\n/g, '<br>')}
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
        <p style="margin: 0 0 10px 0; font-weight: bold; color: #1D4ED8;">Antwort von ${h(adminName)}:</p>
        <p style="margin: 0; color: #374151;">${h(adminResponse).replace(/\n/g, '<br>')}</p>
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

        <p>Hallo ${h(employeeName)},</p>
        <p>Ihre Reklamation zum Zeiteintrag vom <strong>${h(dateStr)}</strong> wurde von ${h(adminName)} bearbeitet.</p>

        <div style="background: #FEF3C7; border-left: 4px solid #F59E0B; padding: 15px; margin: 20px 0;">
          <p style="margin: 0 0 10px 0; font-weight: bold; color: #92400E;">Ihre ursprüngliche Nachricht:</p>
          <p style="margin: 0; color: #374151;">${h(originalComplaint).replace(/\n/g, '<br>')}</p>
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

// Liest die Frontend-URL für Links in Mails (mit Fallback)
function getFrontendUrl(): string {
  return (process.env.FRONTEND_URL || '').replace(/\/+$/, '');
}

// Doc-Notification: Mail wenn neues Dokument für MA bereitgestellt wurde
export async function sendDocumentNotification(
  employeeEmail: string,
  employeeName: string,
  documentTypeName: string,
  documentFilename: string,
): Promise<void> {
  const link = `${getFrontendUrl()}/dashboard/documents`;
  await sendEmail({
    to: employeeEmail,
    subject: `Zeiterfassung — Neues Dokument: ${documentTypeName}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #2563EB;">📄 Neues Dokument bereitgestellt</h2>
        <p>Hallo ${h(employeeName)},</p>
        <p>für dich wurde ein neues Dokument hinterlegt:</p>
        <table style="border-collapse: collapse; margin: 20px 0;">
          <tr>
            <td style="padding: 8px 16px 8px 0; color: #6B7280;">Typ:</td>
            <td style="padding: 8px 0; font-weight: bold;">${h(documentTypeName)}</td>
          </tr>
          <tr>
            <td style="padding: 8px 16px 8px 0; color: #6B7280;">Datei:</td>
            <td style="padding: 8px 0;">${h(documentFilename)}</td>
          </tr>
        </table>
        <p>
          <a href="${h(link)}"
             style="background: #2563EB; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
            Zu den Dokumenten
          </a>
        </p>
        <hr style="border: none; border-top: 1px solid #E5E7EB; margin: 20px 0;">
        <p style="color: #6B7280; font-size: 12px;">
          Diese Nachricht wurde automatisch gesendet.
        </p>
      </div>
    `,
    text: `Neues Dokument bereitgestellt\n\nHallo ${employeeName},\n\nfür dich wurde ein neues Dokument hinterlegt:\nTyp: ${documentTypeName}\nDatei: ${documentFilename}\n\nÖffnen: ${link}`,
  });
}

// Standort-Erinnerung: MA ist eingestempelt aber nicht mehr in der Nähe vom Laden.
// Wenn `complaintEntryId` gesetzt ist, kann der MA NICHT selbst per App
// ausstempeln — der Link führt direkt ins Reklamations-Formular für diesen Eintrag.
// Aus Datenschutzgründen wird die genaue Distanz NICHT in der Mail genannt.
export async function sendLocationReminderEmail(
  employeeEmail: string,
  employeeName: string,
  _distanceMeters: number,
  clockedInSinceText: string,
  complaintEntryId?: string | null,
): Promise<void> {
  const link = complaintEntryId
    ? `${getFrontendUrl()}/dashboard?openComplaint=${complaintEntryId}`
    : `${getFrontendUrl()}/dashboard`;

  const actionHtml = complaintEntryId
    ? `<p>Du kannst dich für diesen Eintrag nicht per App ausstempeln. Bitte melde deine korrekte Arbeitszeit, indem du eine Reklamation für diesen Eintrag stellst:</p>
       <p>
         <a href="${h(link)}"
            style="background: #F59E0B; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
           Reklamation stellen
         </a>
       </p>`
    : `<p>Falls du vergessen hast auszustempeln, kannst du das jetzt nachholen:</p>
       <p>
         <a href="${h(link)}"
            style="background: #F59E0B; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
           Zur Zeiterfassung
         </a>
       </p>`;

  const actionText = complaintEntryId
    ? `Du kannst dich für diesen Eintrag nicht per App ausstempeln. Bitte stelle eine Reklamation: ${link}`
    : `Falls du vergessen hast auszustempeln: ${link}`;

  await sendEmail({
    to: employeeEmail,
    subject: 'Zeiterfassung — Erinnerung: Du bist noch eingestempelt',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #F59E0B;">⏰ Du bist noch eingestempelt</h2>
        <p>Hallo ${h(employeeName)},</p>
        <p>laut deiner Zeiterfassung bist du seit <strong>${h(clockedInSinceText)}</strong> eingestempelt,
        aber du bist nicht mehr in der Nähe des Geschäfts.</p>
        ${actionHtml}
        <hr style="border: none; border-top: 1px solid #E5E7EB; margin: 20px 0;">
        <p style="color: #6B7280; font-size: 12px;">
          Wenn du dienstlich unterwegs bist, kannst du diese Nachricht ignorieren.
        </p>
      </div>
    `,
    text: `Du bist noch eingestempelt\n\nHallo ${employeeName},\n\nseit ${clockedInSinceText} bist du eingestempelt, aber nicht mehr in der Nähe des Geschäfts.\n\n${actionText}`,
  });
}
