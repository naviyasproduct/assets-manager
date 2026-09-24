import 'server-only';
import { redirect } from 'next/navigation';
import { getCurrentUser, type SessionUser } from '@/lib/auth';
import { can, type Area, type Level } from '@/lib/permissions';

/**
 * The gate in front of every signed-in screen.
 *
 * Middleware only checks that a cookie exists. This resolves the session for
 * real, and holds the app closed until a temporary password has been replaced.
 *
 * The landing page sits outside the (app) group so it can render without the
 * sidebar, which means two layouts need this check - hence one function rather
 * than the same three lines in both.
 */
export async function requirePageUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (user.mustChangePassword) redirect('/change-password');
  return user;
}

/**
 * A screen this person has no access to sends them home rather than to an
 * error: the launcher only shows what they may open, so it is the useful place
 * to land after following an old link.
 */
export async function requirePageAccess(area: Area, level: Level): Promise<SessionUser> {
  const user = await requirePageUser();
  if (!can(user.access, area, level)) redirect('/');
  return user;
}
