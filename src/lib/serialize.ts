import type { Prisma } from '@prisma/client';

/**
 * Prisma hands back `Decimal` for money and `BigInt` for file sizes. Neither
 * survives JSON.stringify, and both break React server->client serialization.
 * Everything crossing a boundary goes through here first.
 */

export function decimalToNumber(value: Prisma.Decimal | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  return Number(value.toString());
}

export function bigIntToNumber(value: bigint | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  return Number(value);
}

/** Deeply converts Decimal/BigInt/Date into JSON-safe primitives. */
export function toPlain<T>(value: T): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'bigint') return Number(value);
  if (value instanceof Date) return value.toISOString();
  // Prisma.Decimal is a class with a toFixed method; duck-type it to avoid
  // importing the runtime into client-facing code.
  if (typeof value === 'object' && value !== null && 'toFixed' in value && 's' in value) {
    return Number(String(value));
  }
  if (Array.isArray(value)) return value.map(toPlain);
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = toPlain(v);
    }
    return out;
  }
  return value;
}
