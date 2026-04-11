-- CreateTable: Employee
CREATE TABLE "Employee" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "employeeNumber" TEXT NOT NULL,
    "username" TEXT,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "photoUrl" TEXT,
    "qrCode" TEXT NOT NULL,
    "rfidCard" TEXT,
    "pin" TEXT,
    "startDate" DATETIME,
    "endDate" DATETIME,
    "weeklyHours" REAL NOT NULL DEFAULT 40.0,
    "vacationDaysPerYear" INTEGER NOT NULL DEFAULT 30,
    "carryOverVacationDays" INTEGER NOT NULL DEFAULT 0,
    "workDays" TEXT NOT NULL DEFAULT '1,2,3,4,5',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isAdmin" BOOLEAN NOT NULL DEFAULT false,
    "passwordHash" TEXT,
    "passwordResetToken" TEXT,
    "passwordResetExpires" DATETIME,
    "totpSecret" TEXT,
    "totpEnabled" BOOLEAN NOT NULL DEFAULT false,
    "workCategoryId" TEXT,
    "defaultClockOut" TEXT,
    "canClockInPwa" BOOLEAN NOT NULL DEFAULT false,
    "canClockOutPwa" BOOLEAN NOT NULL DEFAULT false,
    "initialOvertimeBalance" REAL NOT NULL DEFAULT 0,
    "initialVacationDaysUsed" INTEGER NOT NULL DEFAULT 0,
    "initialSickDays" INTEGER NOT NULL DEFAULT 0,
    "initialBalanceYear" INTEGER,
    "initialBalanceMonth" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Employee_workCategoryId_fkey" FOREIGN KEY ("workCategoryId") REFERENCES "WorkCategory" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "Employee_employeeNumber_key" ON "Employee"("employeeNumber");
CREATE UNIQUE INDEX "Employee_username_key" ON "Employee"("username");
CREATE UNIQUE INDEX "Employee_email_key" ON "Employee"("email");
CREATE UNIQUE INDEX "Employee_qrCode_key" ON "Employee"("qrCode");
CREATE UNIQUE INDEX "Employee_rfidCard_key" ON "Employee"("rfidCard");

-- CreateTable: Passkey
CREATE TABLE "Passkey" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "employeeId" TEXT NOT NULL,
    "credentialId" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "counter" INTEGER NOT NULL DEFAULT 0,
    "deviceName" TEXT,
    "transports" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Passkey_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "Passkey_credentialId_key" ON "Passkey"("credentialId");

-- CreateTable: TimeEntry
CREATE TABLE "TimeEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "employeeId" TEXT NOT NULL,
    "clockIn" DATETIME NOT NULL,
    "clockOut" DATETIME,
    "breakMinutes" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "isManual" BOOLEAN NOT NULL DEFAULT false,
    "editedBy" TEXT,
    "clockInViaPwa" BOOLEAN NOT NULL DEFAULT false,
    "clockOutViaPwa" BOOLEAN NOT NULL DEFAULT false,
    "clockInLatitude" REAL,
    "clockInLongitude" REAL,
    "clockOutLatitude" REAL,
    "clockOutLongitude" REAL,
    "pwaClockInReasonId" TEXT,
    "pwaClockInReasonText" TEXT,
    "pwaClockOutReasonId" TEXT,
    "pwaClockOutReasonText" TEXT,
    "complaintMessage" TEXT,
    "complaintAt" DATETIME,
    "complaintResolvedAt" DATETIME,
    "complaintResolvedBy" TEXT,
    "complaintResponse" TEXT,
    "complaintOriginalClockIn" DATETIME,
    "complaintOriginalClockOut" DATETIME,
    "complaintOriginalBreakMinutes" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TimeEntry_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable: MonthlyReport
CREATE TABLE "MonthlyReport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "employeeId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "totalHours" REAL NOT NULL,
    "targetHours" REAL NOT NULL,
    "overtimeHours" REAL NOT NULL,
    "previousOvertimeBalance" REAL NOT NULL DEFAULT 0,
    "cumulativeOvertimeBalance" REAL NOT NULL DEFAULT 0,
    "vacationDaysUsed" INTEGER NOT NULL DEFAULT 0,
    "vacationDaysRemaining" INTEGER NOT NULL DEFAULT 0,
    "vacationDeductionDays" INTEGER NOT NULL DEFAULT 0,
    "vacationDeductionHours" REAL NOT NULL DEFAULT 0,
    "vacationDeductionNote" TEXT,
    "sickDaysThisMonth" INTEGER NOT NULL DEFAULT 0,
    "sickDaysTotal" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "pdfPath" TEXT,
    "notes" TEXT,
    "createdBy" TEXT NOT NULL,
    "finalizedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MonthlyReport_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "MonthlyReport_employeeId_year_month_key" ON "MonthlyReport"("employeeId", "year", "month");

-- CreateTable: Settings
CREATE TABLE "Settings" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'default',
    "companyName" TEXT NOT NULL DEFAULT 'Handy-Insel',
    "companyAddress" TEXT,
    "companyPhone" TEXT,
    "companyEmail" TEXT,
    "defaultBreakMinutes" INTEGER NOT NULL DEFAULT 30,
    "overtimeThreshold" REAL NOT NULL DEFAULT 40.0,
    "backupFrequency" TEXT NOT NULL DEFAULT 'daily',
    "backupTime" TEXT NOT NULL DEFAULT '02:00',
    "backupWeekday" INTEGER NOT NULL DEFAULT 1,
    "backupRetentionDays" INTEGER NOT NULL DEFAULT 30,
    "smtpHost" TEXT,
    "smtpPort" INTEGER DEFAULT 587,
    "smtpUser" TEXT,
    "smtpPassword" TEXT,
    "smtpFromAddress" TEXT,
    "smtpFromName" TEXT DEFAULT 'Zeiterfassung',
    "smtpSecure" BOOLEAN NOT NULL DEFAULT false,
    "pdfShowWorkCategory" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable: Holiday
CREATE TABLE "Holiday" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" DATETIME NOT NULL,
    "name" TEXT NOT NULL,
    "isRecurring" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable: AbsenceType
CREATE TABLE "AbsenceType" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "shortName" TEXT NOT NULL,
    "requiredHours" REAL NOT NULL DEFAULT 0,
    "color" TEXT NOT NULL DEFAULT '#3B82F6',
    "countsAsVacation" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable: EmployeeAbsence
CREATE TABLE "EmployeeAbsence" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "employeeId" TEXT NOT NULL,
    "absenceTypeId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "EmployeeAbsence_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "EmployeeAbsence_absenceTypeId_fkey" FOREIGN KEY ("absenceTypeId") REFERENCES "AbsenceType" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "EmployeeAbsence_employeeId_date_key" ON "EmployeeAbsence"("employeeId", "date");

-- CreateTable: WorkCategory
CREATE TABLE "WorkCategory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "earliestClockIn" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable: AuditLog
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT,
    "userName" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "oldValues" TEXT,
    "newValues" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "note" TEXT
);

-- CreateTable: DocumentType
CREATE TABLE "DocumentType" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "shortName" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#6366F1',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable: Document
CREATE TABLE "Document" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "employeeId" TEXT NOT NULL,
    "documentTypeId" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "mimeType" TEXT NOT NULL,
    "year" INTEGER,
    "month" INTEGER,
    "note" TEXT,
    "uploadedBy" TEXT NOT NULL,
    "uploadedByName" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Document_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Document_documentTypeId_fkey" FOREIGN KEY ("documentTypeId") REFERENCES "DocumentType" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable: VacationDeduction
CREATE TABLE "VacationDeduction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "employeeId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "daysDeducted" INTEGER NOT NULL DEFAULT 1,
    "hoursCompensated" REAL NOT NULL,
    "overtimeBalanceBefore" REAL NOT NULL,
    "overtimeBalanceAfter" REAL NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VacationDeduction_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable: VacationAdjustment
CREATE TABLE "VacationAdjustment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "employeeId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "days" REAL NOT NULL,
    "reason" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VacationAdjustment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable: PwaClockReason
CREATE TABLE "PwaClockReason" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable: BackupTarget
CREATE TABLE "BackupTarget" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "config" TEXT NOT NULL,
    "lastTestAt" DATETIME,
    "lastTestOk" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable: BackupRecord
CREATE TABLE "BackupRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "targetId" TEXT,
    "filename" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "errorMessage" TEXT,
    "trigger" TEXT NOT NULL DEFAULT 'scheduled',
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    "expiresAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BackupRecord_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "BackupTarget" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable: Terminal
CREATE TABLE "Terminal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "apiKey" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastSeen" DATETIME,
    "ipAddress" TEXT,
    "version" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
CREATE UNIQUE INDEX "Terminal_apiKey_key" ON "Terminal"("apiKey");
