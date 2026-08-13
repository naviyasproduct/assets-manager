import 'server-only';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { AuthError } from '@/lib/auth';
import { toFieldErrors } from '@/lib/validation';
import { toPlain } from '@/lib/serialize';

/**
 * One error shape for every API route so the client only has to understand a
 * single contract: { error: string, fields?: { [field]: message } }.
 */

export function ok(data: unknown, status = 200): NextResponse {
  return NextResponse.json(toPlain(data), { status });
}

export function fail(message: string, status = 400, fields?: Record<string, string>) {
  return NextResponse.json({ error: message, ...(fields ? { fields } : {}) }, { status });
}

/**
 * Wraps a route handler so thrown auth/validation/Prisma errors become clean
 * responses instead of a 500 with a stack trace.
 */
export function handleRouteError(error: unknown): NextResponse {
  if (error instanceof AuthError) {
    return fail(error.message, error.status);
  }

  if (error instanceof z.ZodError) {
    return fail('Please correct the highlighted fields.', 422, toFieldErrors(error));
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    switch (error.code) {
      case 'P2002': {
        const target = (error.meta?.target as string[] | undefined)?.join(', ') ?? 'value';
        return fail(`That ${target} is already in use.`, 409);
      }
      case 'P2003':
        return fail('That change references a record that does not exist.', 400);
      case 'P2025':
        return fail('Record not found.', 404);
      case 'P2014':
        return fail(
          'That record is still referenced by other data and cannot be removed.',
          409,
        );
      default:
        break;
    }
  }

  console.error('[api] unhandled error:', error);
  return fail('Something went wrong. Check the server logs.', 500);
}

/** Parses a JSON body, turning malformed JSON into a clean 400. */
export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new z.ZodError([
      {
        code: z.ZodIssueCode.custom,
        path: ['_form'],
        message: 'Request body was not valid JSON.',
      },
    ]);
  }
}
