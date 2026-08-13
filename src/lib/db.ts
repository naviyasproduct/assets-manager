import { PrismaClient } from '@prisma/client';

/**
 * Single Prisma instance.
 *
 * Next.js hot-reloads modules in dev, which would otherwise open a new pool on
 * every edit and exhaust Postgres connections. Stash it on globalThis.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
