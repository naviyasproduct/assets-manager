import { prisma } from '@/lib/db';
import {
  verifyPassword,
  createSession,
  purgeExpiredSessions,
  hashPassword,
} from '@/lib/auth';
import { loginSchema } from '@/lib/validation';
import { ok, fail, handleRouteError, readJson } from '@/lib/api';

export const runtime = 'nodejs';

/**
 * Dummy hash compared against when the email does not exist, so a wrong email
 * and a wrong password take the same amount of time. Without this, response
 * timing tells an attacker which addresses are real accounts.
 */
let dummyHashPromise: Promise<string> | null = null;
function getDummyHash(): Promise<string> {
  dummyHashPromise ??= hashPassword('not-a-real-password-placeholder');
  return dummyHashPromise;
}

export async function POST(request: Request) {
  try {
    const body = loginSchema.parse(await readJson(request));

    const user = await prisma.user.findUnique({
      where: { email: body.email },
      include: { department: true },
    });

    if (!user) {
      await verifyPassword(body.password, await getDummyHash());
      return fail('Incorrect email or password.', 401);
    }

    const passwordValid = await verifyPassword(body.password, user.passwordHash);
    if (!passwordValid) {
      return fail('Incorrect email or password.', 401);
    }

    if (!user.isActive) {
      return fail('This account has been deactivated. Contact an administrator.', 403);
    }

    await createSession(user.id);

    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    // Cheap housekeeping on a naturally infrequent endpoint.
    void purgeExpiredSessions().catch(() => {});

    return ok({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        departmentId: user.departmentId,
        departmentName: user.department?.name ?? null,
        mustChangePassword: user.mustChangePassword,
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
