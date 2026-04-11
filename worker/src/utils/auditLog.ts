import { Context } from 'hono';
import { PrismaClient } from '@prisma/client';
import type { Env, Variables } from '../bindings.js';

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
  | 'COMPLAINT_RESOLVE'
  | 'PASSWORD_RESET_REQUESTED'
  | 'PASSWORD_RESET'
  | 'ADMIN_PASSWORD_RESET'
  | 'RFID_LOOKUP'
  | 'UPLOAD'
  | 'DOWNLOAD';

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
  | 'Terminal'
  | 'Document'
  | 'DocumentType';

interface AuditLogParams {
  c?: Context<{ Bindings: Env; Variables: Variables }>;
  prisma: PrismaClient;
  userId?: string;
  userName?: string;
  action: AuditAction;
  entityType: EntityType;
  entityId?: string;
  oldValues?: any;
  newValues?: any;
  note?: string;
}

export async function createAuditLog(params: AuditLogParams): Promise<void> {
  const { c, prisma, userId, userName, action, entityType, entityId, oldValues, newValues, note } = params;

  const ipAddress = c
    ? c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || 'unknown'
    : undefined;
  const userAgent = c ? c.req.header('user-agent') : undefined;

  try {
    await prisma.auditLog.create({
      data: {
        userId,
        userName,
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
    console.error('Fehler beim Erstellen des Audit-Logs:', error);
  }
}

export function getChangedFields(oldObj: any, newObj: any): { old: any; new: any } | null {
  const changedOld: any = {};
  const changedNew: any = {};
  let hasChanges = false;
  const allKeys = new Set([...Object.keys(oldObj || {}), ...Object.keys(newObj || {})]);

  for (const key of allKeys) {
    if (['createdAt', 'updatedAt', 'passwordHash'].includes(key)) continue;
    const oldVal = oldObj?.[key];
    const newVal = newObj?.[key];
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
