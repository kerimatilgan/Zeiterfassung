import cron from 'node-cron';
import { PrismaClient } from '@prisma/client';
import { runBackup, cleanupOldBackups } from './index.js';

const prisma = new PrismaClient();
let currentTask: ReturnType<typeof cron.schedule> | null = null;

function buildCronExpression(frequency: string, time: string, weekday: number): string {
  const [hour, minute] = time.split(':').map(Number);
  const h = isNaN(hour) ? 2 : hour;
  const m = isNaN(minute) ? 0 : minute;

  switch (frequency) {
    case 'hourly':
      return `${m} * * * *`;
    case 'weekly':
      return `${m} ${h} * * ${weekday}`;
    case 'daily':
    default:
      return `${m} ${h} * * *`;
  }
}

function frequencyLabel(frequency: string, time: string, weekday: number): string {
  const days = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
  switch (frequency) {
    case 'hourly': return `stündlich (Minute ${time.split(':')[1] || '00'})`;
    case 'weekly': return `wöchentlich (${days[weekday] || 'Mo'} um ${time} Uhr)`;
    default: return `täglich um ${time} Uhr`;
  }
}

export async function startBackupScheduler(): Promise<void> {
  try {
    const settings = await prisma.settings.findUnique({ where: { id: 'default' } });
    const frequency = (settings as any)?.backupFrequency || 'daily';
    const time = (settings as any)?.backupTime || '02:00';
    const weekday = (settings as any)?.backupWeekday ?? 1;

    const cronExpr = buildCronExpression(frequency, time, weekday);
    const label = frequencyLabel(frequency, time, weekday);

    // Alten Task stoppen falls vorhanden
    if (currentTask) {
      currentTask.stop();
      currentTask = null;
    }

    currentTask = cron.schedule(cronExpr, async () => {
      console.log('🔄 Starte geplantes Backup...');
      try {
        const results = await runBackup('scheduled');
        const successful = results.filter((r: any) => r?.status === 'success').length;
        console.log(`✅ Backup abgeschlossen: ${successful}/${results.length} Ziele erfolgreich`);
        await cleanupOldBackups();
        console.log('🧹 Alte Backups bereinigt');
      } catch (error) {
        console.error('❌ Geplantes Backup fehlgeschlagen:', error);
      }
    });

    console.log(`⏰ Backup-Scheduler gestartet (${label})`);
  } catch (error) {
    // Fallback: täglich um 02:00
    currentTask = cron.schedule('0 2 * * *', async () => {
      try {
        await runBackup('scheduled');
        await cleanupOldBackups();
      } catch {}
    });
    console.log('⏰ Backup-Scheduler gestartet (Fallback: täglich um 02:00 Uhr)');
  }
}

// Scheduler neu laden (nach Einstellungsänderung aufrufen)
export async function reloadBackupScheduler(): Promise<void> {
  await startBackupScheduler();
}
