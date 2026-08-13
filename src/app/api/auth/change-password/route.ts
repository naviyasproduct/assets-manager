import { prisma } from '@/lib/db';
import {
  requireUser,
  verifyPassword,
  hashPassword,
  revokeAllSessions,
  createSession,
} from '@/lib/auth';
import { changePasswordSchema } from '@/lib/validation';
import { ok, fail, handleRouteError, readJson } from '@/lib/api';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = changePasswordSchema.parse(await readJson(request));

    const record = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { passwordHash: true },
    });

    if (!(await verifyPassword(body.currentPassword, record.passwordHash))) {
      return fail('Your current password is incorrect.', 400, {
        currentPassword: 'Your current password is incorrect.',
      });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await hashPassword(body.newPassword),
        mustChangePassword: false,
      },
    });

    // Changing a password should kick out anyone holding an old session, then
    // re-issue one for the browser doing the change so they stay signed in.
    await revokeAllSessions(user.id);
    await createSession(user.id);

    return ok({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
