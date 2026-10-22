import crypto from 'node:crypto';
import { prisma } from '@/lib/db';
import { hashPassword, requireAccess } from '@/lib/auth';
import { machinePersonSchema } from '@/lib/validation';
import { ok, fail, handleRouteError, readJson } from '@/lib/api';

export const runtime = 'nodejs';

/** The made-up addresses of people with no login, as the old-CRM import makes them. */
const NO_LOGIN_DOMAIN = 'staff.local';

/**
 * POST - an employee added from the repair form, so whoever did a repair can
 * be picked even when they are new. Open to machines Edit rather than only to
 * an admin because it grants nothing: the record is made the way the imported
 * staff were - deactivated, with a password nobody knows - so it is a name and
 * a face in the directory, never a way in. Giving them a login is still an
 * admin's job on the Employees screen (set a password, reactivate).
 */
export async function POST(request: Request) {
  try {
    await requireAccess('machines', 'EDIT');
    const body = machinePersonSchema.parse(await readJson(request));

    // Two "Mr. Prabath"s would split one person's repairs across two records.
    const same = await prisma.user.findFirst({
      where: { name: { equals: body.name, mode: 'insensitive' } },
      select: { id: true },
    });
    if (same) {
      return fail('There is already an employee with that name.', 409, {
        name: 'Already an employee - pick them from the list.',
      });
    }

    const slug =
      body.name
        .toLowerCase()
        .replace(/^(mr|mrs|ms|miss|dr)\.?\s*/, '')
        .replace(/[^a-z0-9]+/g, '.')
        .replace(/^\.|\.$/g, '') || 'person';
    const taken = new Set(
      (
        await prisma.user.findMany({
          where: { email: { startsWith: slug, mode: 'insensitive' } },
          select: { email: true },
        })
      ).map((u) => u.email.toLowerCase()),
    );
    let email = `${slug}@${NO_LOGIN_DOMAIN}`;
    for (let n = 2; taken.has(email); n++) email = `${slug}${n}@${NO_LOGIN_DOMAIN}`;

    const person = await prisma.user.create({
      data: {
        name: body.name,
        email,
        passwordHash: await hashPassword(crypto.randomBytes(24).toString('hex')),
        role: 'EMPLOYEE',
        isActive: false,
        mustChangePassword: true,
        jobTitle: body.jobTitle ?? null,
        phone: body.phone ?? null,
      },
      select: { id: true, name: true, role: true, jobTitle: true, isActive: true },
    });
    return ok({ person }, 201);
  } catch (error) {
    return handleRouteError(error);
  }
}
