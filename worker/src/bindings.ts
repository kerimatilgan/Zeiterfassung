import { PrismaClient } from '@prisma/client';

export interface Env {
  DB: D1Database;
  UPLOADS: R2Bucket;
  KV: KVNamespace;
  JWT_SECRET: string;
  ENVIRONMENT: string;
  FRONTEND_URL: string;
  DOCUMENT_ENCRYPTION_KEY?: string;
  TERMINAL_API_KEY?: string;
}

export type Variables = {
  prisma: PrismaClient;
  employee: {
    id: string;
    employeeNumber: string;
    firstName: string;
    lastName: string;
    isAdmin: boolean;
  };
  terminalId?: string;
};
