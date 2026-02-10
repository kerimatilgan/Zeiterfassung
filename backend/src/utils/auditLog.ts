import { prisma } from '../index.js';
import { Request } from 'express';

export type AuditAction =
  | 'LOGIN'
  | 'LOGOUT'
  | 'LOGIN_FAILED'
  | 'CLOCK_IN'
  | 'CLOCK_OUT'
  | 'CREATE'
  | 'UPDATE'
  | 'DELETE'
  | 'FINALIZE'
  | 'PASSWORD_CHANGE'
  | 'DB_BACKUP'
  | 'DB_RESTORE'
  | 'MAIL_TEST'
  | 'COMPLAINT_CREATE'
  | 'COMPLAINT_UPDATE'
  | 'COMPLAINT_DELETE'
  | 'COMPLAINT_RESOLVE';

export type EntityType =
  | 'Employee'
  | 'TimeEntry'
  | 'MonthlyReport'
  | 'Settings'
  | 'Holiday'
  | 'AbsenceType'
  | 'EmployeeAbsence'
  | 'Database'
  | 'WorkCategory'
  | 'MailSettings'
  | 'Terminal';

interface AuditLogParams {
  req?: Request;
  userId?: string;
  userName?: string;
  action: AuditAction;
  entityType: EntityType;
  entityId?: string;
  oldValues?: any;
  newValues?: any;
  note?: string;
}

/**
 * Erstellt einen Audit-Log-Eintrag
 */
export async function createAuditLog(params: AuditLogParams): Promise<void> {
  const {
    req,
    userId,
    userName,
    action,
    entityType,
    entityId,
    oldValues,
    newValues,
    note,
  } = params;

  // IP-Adresse und User-Agent aus Request extrahieren
  const ipAddress = req
    ? (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || 'unknown'
    : undefined;
  const userAgent = req ? (req.headers['user-agent'] as string) : undefined;

  // User-Info aus Request extrahieren falls nicht übergeben
  const resolvedUserId = userId || (req as any)?.user?.id;
  const resolvedUserName =
    userName ||
    ((req as any)?.user
      ? `${(req as any).user.firstName} ${(req as any).user.lastName}`
      : undefined);

  try {
    await prisma.auditLog.create({
      data: {
        userId: resolvedUserId,
        userName: resolvedUserName,
        action,
        entityType,
        entityId,
        oldValues: oldValues ? JSON.stringify(oldValues) : undefined,
        newValues: newValues ? JSON.stringify(newValues) : undefined,
        ipAddress,
        userAgent,
        note,
      },
    });
  } catch (error) {
    // Logging-Fehler sollten die Hauptaktion nicht blockieren
    console.error('Fehler beim Erstellen des Audit-Logs:', error);
  }
}

/**
 * Helper-Funktion um Änderungen zwischen zwei Objekten zu finden
 */
export function getChangedFields(oldObj: any, newObj: any): { old: any; new: any } | null {
  const changedOld: any = {};
  const changedNew: any = {};
  let hasChanges = false;

  // Alle Keys aus beiden Objekten sammeln
  const allKeys = new Set([...Object.keys(oldObj || {}), ...Object.keys(newObj || {})]);

  for (const key of allKeys) {
    // Timestamps und interne Felder ignorieren
    if (['createdAt', 'updatedAt', 'passwordHash'].includes(key)) continue;

    const oldVal = oldObj?.[key];
    const newVal = newObj?.[key];

    // Werte vergleichen (einfacher Vergleich, komplexe Objekte werden als JSON verglichen)
    const oldValStr = typeof oldVal === 'object' ? JSON.stringify(oldVal) : oldVal;
    const newValStr = typeof newVal === 'object' ? JSON.stringify(newVal) : newVal;

    if (oldValStr !== newValStr) {
      changedOld[key] = oldVal;
      changedNew[key] = newVal;
      hasChanges = true;
    }
  }

  return hasChanges ? { old: changedOld, new: changedNew } : null;
}

/**
 * Formatiert eine Aktion für die Anzeige
 */
export function formatAction(action: string): string {
  const actionMap: Record<string, string> = {
    LOGIN: 'Anmeldung',
    LOGOUT: 'Abmeldung',
    LOGIN_FAILED: 'Fehlgeschlagene Anmeldung',
    CLOCK_IN: 'Einstempeln',
    CLOCK_OUT: 'Ausstempeln',
    CREATE: 'Erstellt',
    UPDATE: 'Bearbeitet',
    DELETE: 'Gelöscht',
    FINALIZE: 'Abgeschlossen',
    PASSWORD_CHANGE: 'Passwort geändert',
    DB_BACKUP: 'Datenbank-Backup',
    DB_RESTORE: 'Datenbank wiederhergestellt',
  };
  return actionMap[action] || action;
}

/**
 * Formatiert einen Entity-Typ für die Anzeige
 */
export function formatEntityType(entityType: string): string {
  const entityMap: Record<string, string> = {
    Employee: 'Mitarbeiter',
    TimeEntry: 'Zeiteintrag',
    MonthlyReport: 'Monatsabrechnung',
    Settings: 'Einstellungen',
    Holiday: 'Feiertag',
    AbsenceType: 'Abwesenheitstyp',
    EmployeeAbsence: 'Abwesenheit',
    Database: 'Datenbank',
    WorkCategory: 'Arbeitskategorie',
    MailSettings: 'Mail-Einstellungen',
    Terminal: 'Terminal',
  };
  return entityMap[entityType] || entityType;
}
