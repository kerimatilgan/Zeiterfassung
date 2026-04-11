import { PrismaClient } from '@prisma/client';
import { PrismaD1 } from '@prisma/adapter-d1';

export function createPrismaClient(d1: D1Database): PrismaClient {
  const adapter = new PrismaD1(d1);
  return new PrismaClient({ adapter } as any);
}
