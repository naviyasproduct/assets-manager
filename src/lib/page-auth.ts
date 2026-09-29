import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, getCurrentUser, type SessionUser } from '@/lib/auth';
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

  if (!user) {
    // A cookie that no longer resolves to a session is the dangerous case, not
    // the absent one: middleware lets it through on sight, so plain /login
    // would bounce straight back here and loop. ?stale tells middleware to drop
    // it. A server component cannot clear a cookie itself.
    const stale = (await cookies()).has(SESSION_COOKIE);
    redirect(stale ? '/login?stale=1' : '/login');
  }

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
