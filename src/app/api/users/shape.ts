import type { Prisma, Role } from '@prisma/client';
import { accessOverrides, resolveAccess, type Access } from '@/lib/permissions';

/** What the Employees screen gets back for one person. */
export const userSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  isActive: true,
  mustChangePassword: true,
  lastLoginAt: true,
  allDepartments: true,
  jobTitle: true,
  phone: true,
  permissions: true,
  photoRelativePath: true,
  photoUploadedAt: true,
  department: { select: { id: true, name: true } },
} satisfies Prisma.UserSelect;

export type SelectedUser = Prisma.UserGetPayload<{ select: typeof userSelect }>;

export function toUserJson(user: SelectedUser) {
  const { permissions, photoRelativePath, photoUploadedAt, ...rest } = user;
  return {
    ...rest,
    access: resolveAccess(user.role, permissions),
    photoUrl: photoRelativePath
      ? `/api/users/${user.id}/photo?v=${photoUploadedAt?.getTime() ?? 0}`
      : null,
  };
}

/**
 * Turns the grid the screen sent into what is stored: only the areas that
 * differ from the role's template. Running it through resolveAccess first
 * drops any level the area does not offer (EDIT on employees, say), so what is
 * stored is always something the grid could have shown.
 */
export function storedPermissions(role: Role, access: Partial<Access> | undefined) {
  return accessOverrides(role, resolveAccess(role, access ?? {})) as Prisma.InputJsonValue;
}

/**
 * An admin sees everything anyway, so their row is written to say so rather
 * than keep a department that would mislead whoever reads it next. Seeing all
 * departments and being tied to one are exclusive for everyone else.
 */
export function scopeFor(
  role: Role,
  allDepartments: boolean,
  departmentId: string | null | undefined,
) {
  if (role === 'ADMIN') return { allDepartments: true, departmentId: null };
  if (allDepartments) return { allDepartments: true, departmentId: null };
  return { allDepartments: false, departmentId: departmentId ?? null };
}
