import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  // Standard-Einstellungen
  await prisma.settings.upsert({
    where: { id: 'default' },
    update: {},
    create: {
      id: 'default',
      companyName: 'Handy-Insel',
      companyAddress: 'Musterstraße 1, 12345 Musterstadt',
      companyPhone: '01234 567890',
      companyEmail: 'info@handy-insel.de',
      defaultBreakMinutes: 30,
      overtimeThreshold: 40,
    },
  });

  // Admin-Benutzer erstellen
  const adminPassword = await bcrypt.hash('admin123', 12);

  const admin = await prisma.employee.upsert({
    where: { employeeNumber: 'ADMIN' },
    update: {},
    create: {
      employeeNumber: 'ADMIN',
      firstName: 'Admin',
      lastName: 'Handy-Insel',
      email: 'admin@handy-insel.de',
      qrCode: `HI-ADMIN-${uuidv4().substring(0, 8)}`,
      weeklyHours: 40,
      vacationDaysPerYear: 30,
      workDays: '1,2,3,4,5',
      isAdmin: true,
      passwordHash: adminPassword,
    },
  });

  console.log('Admin erstellt:', admin.employeeNumber);

  // Demo-Mitarbeiter erstellen
  const demoPassword = await bcrypt.hash('demo123', 12);

  const employees = [
    { number: '001', firstName: 'Max', lastName: 'Mustermann' },
    { number: '002', firstName: 'Erika', lastName: 'Musterfrau' },
    { number: '003', firstName: 'Hans', lastName: 'Schmidt' },
  ];

  for (const emp of employees) {
    await prisma.employee.upsert({
      where: { employeeNumber: emp.number },
      update: {},
      create: {
        employeeNumber: emp.number,
        firstName: emp.firstName,
        lastName: emp.lastName,
        email: `${emp.firstName.toLowerCase()}.${emp.lastName.toLowerCase()}@handy-insel.de`,
        qrCode: `HI-${emp.number}-${uuidv4().substring(0, 8)}`,
        weeklyHours: 40,
        vacationDaysPerYear: 30,
        workDays: '1,2,3,4,5',
        isAdmin: false,
        passwordHash: demoPassword,
      },
    });
    console.log(`Mitarbeiter erstellt: ${emp.firstName} ${emp.lastName}`);
  }

  // Gesetzliche Feiertage 2024 (NRW als Beispiel)
  const holidays2024 = [
    { date: '2024-01-01', name: 'Neujahr' },
    { date: '2024-03-29', name: 'Karfreitag' },
    { date: '2024-04-01', name: 'Ostermontag' },
    { date: '2024-05-01', name: 'Tag der Arbeit' },
    { date: '2024-05-09', name: 'Christi Himmelfahrt' },
    { date: '2024-05-20', name: 'Pfingstmontag' },
    { date: '2024-05-30', name: 'Fronleichnam' },
    { date: '2024-10-03', name: 'Tag der Deutschen Einheit' },
    { date: '2024-11-01', name: 'Allerheiligen' },
    { date: '2024-12-25', name: '1. Weihnachtstag' },
    { date: '2024-12-26', name: '2. Weihnachtstag' },
  ];

  for (const holiday of holidays2024) {
    await prisma.holiday.upsert({
      where: { id: holiday.date },
      update: {},
      create: {
        id: holiday.date,
        date: new Date(holiday.date),
        name: holiday.name,
        isRecurring: false,
      },
    });
  }

  console.log('Feiertage erstellt');

  console.log('\n=== Setup abgeschlossen ===');
  console.log('Admin-Login: ADMIN / admin123');
  console.log('Demo-Mitarbeiter: 001, 002, 003 / demo123');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
