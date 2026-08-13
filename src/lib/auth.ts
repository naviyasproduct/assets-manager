import 'server-only';
import { cookies, headers } from 'next/headers';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { Role, User, Department } from '@prisma/client';
import { prisma } from '@/lib/db';
import { config } from '@/lib/config';

export const SESSION_COOKIE = 'am_session';
const SESSION_TTL_DAYS = 14;
const BCRYPT_ROUNDS = 12;

export type SessionUser = Omit<User, 'passwordHash'> & {
  department: Department | null;
};

// ---------------------------------------------------------------------------
// Passwords
// ---------------------------------------------------------------------------

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

// ---------------------------------------------------------------------------
// Session tokens
//
// The cookie carries a raw 32-byte random token. The database stores only its
// HMAC, so a stolen database dump cannot be turned into a live session without
// also having SESSION_SECRET.
// ---------------------------------------------------------------------------

function hashToken(token: string): string {
  return crypto.createHmac('sha256', config.sessionSecret).update(token).digest('hex');
}

export async function createSession(userId: string): Promise<void> {
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);

  const headerList = await headers();

  await prisma.session.create({
    data: {
      tokenHash: hashToken(token),
      userId,
      expiresAt,
      userAgent: headerList.get('user-agent')?.slice(0, 255) ?? null,
      ipAddress:
        headerList.get('x-forwarded-for')?.split(',')[0]?.trim().slice(0, 64) ?? null,
    },
  });

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    // The office LAN is plain HTTP (http://192.168.x.x:3000). A `secure` cookie
    // would silently never be sent, so login would appear to succeed and then
    // immediately bounce back to the login page. Keep this false.
    secure: false,
    path: '/',
    expires: expiresAt,
  });
}

export async function destroySession(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;

  if (token) {
    // deleteMany, not delete: an already-expired/purged session must not throw.
    await prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } });
  }

  cookieStore.delete(SESSION_COOKIE);
}

/** Returns the signed-in user, or null. Never throws. */
export async function getCurrentUser(): Promise<SessionUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: { include: { department: true } } },
  });

  if (!session) return null;

  if (session.expiresAt < new Date()) {
    await prisma.session.deleteMany({ where: { id: session.id } });
    return null;
  }

  // A deactivated account must lose access immediately, without waiting for the
  // session to expire.
  if (!session.user.isActive) return null;

  const { passwordHash: _passwordHash, ...safeUser } = session.user;
  return safeUser as SessionUser;
}

/** Housekeeping: drop expired rows. Called opportunistically on login. */
export async function purgeExpiredSessions(): Promise<void> {
  await prisma.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
}

/** Invalidate every session for a user (password change, deactivation). */
export async function revokeAllSessions(userId: string): Promise<void> {
  await prisma.session.deleteMany({ where: { userId } });
}

// ---------------------------------------------------------------------------
// Authorization
// ---------------------------------------------------------------------------

export class AuthError extends Error {
  constructor(
    message: string,
    public readonly status: 401 | 403,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) throw new AuthError('You must be signed in.', 401);
  return user;
}

export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== 'ADMIN') {
    throw new AuthError('This action is restricted to administrators.', 403);
  }
  return user;
}

export function isAdmin(user: { role: Role }): boolean {
  return user.role === 'ADMIN';
}

/**
 * The core scoping rule for the whole app: an ADMIN may touch any department,
 * a DEPT_HEAD only their own.
 */
export function canAccessDepartment(user: SessionUser, departmentId: string): boolean {
  if (user.role === 'ADMIN') return true;
  return user.departmentId === departmentId;
}

export function assertDepartmentAccess(user: SessionUser, departmentId: string): void {
  if (!canAccessDepartment(user, departmentId)) {
    throw new AuthError('You do not have access to that department.', 403);
  }
}

/**
 * Departments this user may read.
 * `null` means "no restriction" (admin) and is meant to be spread into a Prisma
 * `where` clause as nothing at all.
 */
export function departmentScopeFilter(user: SessionUser): { departmentId: string } | Record<string, never> {
  if (user.role === 'ADMIN') return {};
  // A department head with no department assigned can see nothing. Using an
  // impossible id is safer than returning {} and accidentally granting all.
  return { departmentId: user.departmentId ?? '__none__' };
}
