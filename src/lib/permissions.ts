import type { Role } from '@prisma/client';

/**
 * Who may open which screen, and what they may do there.
 *
 * Every account carries one level per area. The role is only the starting
 * point - picking "Employee" fills in the template below - and the admin can
 * then move any single area up or down for that one person. What is stored is
 * the overrides, and `resolveAccess` lays them over the role's template, so an
 * area added here later arrives with a sensible default instead of "nothing".
 *
 * No `server-only`: the Employees screen draws the permission grid from this,
 * and the sidebar filters itself with it. The server is still the one that
 * enforces it (`requireAccess` in auth.ts) - the browser only hides what the
 * server would refuse anyway.
 *
 * Checking is a lookup in an object already attached to the session, so it
 * costs nothing: no query, no cache to go stale. A change made on the Employees
 * screen applies on that person's very next request.
 */

export type Level = 'NONE' | 'ASSIGNED' | 'VIEW' | 'EDIT';

export const AREAS = [
  'departments',
  'assets',
  'categories',
  'locations',
  'purchasing',
  'suppliers',
  'reports',
  'employees',
] as const;

export type Area = (typeof AREAS)[number];

export type Access = Record<Area, Level>;

const RANK: Record<Level, number> = { NONE: 0, ASSIGNED: 1, VIEW: 2, EDIT: 3 };

type AreaInfo = {
  label: string;
  /** The levels this area offers, lowest first. */
  levels: Level[];
  /** What each offered level lets someone do, in the words the grid shows. */
  says: Partial<Record<Level, string>>;
};

export const AREA_INFO: Record<Area, AreaInfo> = {
  departments: {
    label: 'Departments',
    levels: ['NONE', 'VIEW', 'EDIT'],
    says: {
      VIEW: 'See the department pages',
      EDIT: 'Add, rename and retire departments',
    },
  },
  assets: {
    label: 'Assets',
    levels: ['NONE', 'VIEW', 'EDIT'],
    says: {
      VIEW: 'Browse equipment and repair history',
      EDIT: 'Add, edit and remove assets, record repairs',
    },
  },
  categories: {
    label: 'Categories',
    levels: ['NONE', 'VIEW', 'EDIT'],
    says: { VIEW: 'See the category list', EDIT: 'Add, rename and retire categories' },
  },
  locations: {
    label: 'Locations',
    levels: ['NONE', 'VIEW', 'EDIT'],
    says: { VIEW: 'See the location list', EDIT: 'Add, rename and retire locations' },
  },
  purchasing: {
    label: 'Purchasing',
    levels: ['NONE', 'ASSIGNED', 'VIEW', 'EDIT'],
    says: {
      ASSIGNED: 'Only orders assigned to them - add what was bought and complete them',
      VIEW: 'See every order',
      EDIT: 'Create, assign and manage every order',
    },
  },
  suppliers: {
    label: 'Suppliers',
    levels: ['NONE', 'VIEW', 'EDIT'],
    says: { VIEW: 'See supplier details', EDIT: 'Add, edit and remove suppliers' },
  },
  reports: {
    label: 'Reports',
    levels: ['NONE', 'VIEW', 'EDIT'],
    says: { VIEW: 'Build and download reports', EDIT: 'Also save report setups for everyone' },
  },
  employees: {
    // Deliberately no EDIT. Whoever could change accounts could also change
    // their own access, so managing people stays with administrators.
    label: 'Employees',
    levels: ['NONE', 'VIEW'],
    says: { VIEW: 'See the staff list and contact details' },
  },
};

export const LEVEL_LABELS: Record<Level, string> = {
  NONE: 'No access',
  ASSIGNED: 'Assigned only',
  VIEW: 'View',
  EDIT: 'Edit',
};

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: 'Administrator',
  DEPT_HEAD: 'Department head',
  EMPLOYEE: 'Employee',
};

const FULL: Access = {
  departments: 'EDIT',
  assets: 'EDIT',
  categories: 'EDIT',
  locations: 'EDIT',
  purchasing: 'EDIT',
  suppliers: 'EDIT',
  reports: 'EDIT',
  employees: 'VIEW',
};

/**
 * Where each role starts. DEPT_HEAD reproduces exactly what a department head
 * could do before permissions existed, so nobody's screen changed the day this
 * shipped.
 */
export const ROLE_TEMPLATES: Record<Role, Access> = {
  ADMIN: FULL,
  DEPT_HEAD: {
    departments: 'VIEW',
    assets: 'EDIT',
    categories: 'EDIT',
    locations: 'NONE',
    purchasing: 'EDIT',
    suppliers: 'VIEW',
    reports: 'EDIT',
    employees: 'NONE',
  },
  EMPLOYEE: {
    departments: 'NONE',
    assets: 'NONE',
    categories: 'NONE',
    locations: 'NONE',
    purchasing: 'ASSIGNED',
    suppliers: 'VIEW',
    reports: 'NONE',
    employees: 'NONE',
  },
};

/**
 * The stored overrides laid over the role's template. Never throws: anything
 * unrecognised in the stored JSON is ignored, which is what keeps an old row
 * readable after an area or level changes here. An administrator always has
 * everything, whatever is stored - there is no way to lock one out by accident.
 */
export function resolveAccess(role: Role, stored: unknown): Access {
  if (role === 'ADMIN') return { ...FULL };
  const access = { ...ROLE_TEMPLATES[role] };
  if (stored && typeof stored === 'object') {
    for (const area of AREAS) {
      const level = (stored as Record<string, unknown>)[area];
      if (typeof level === 'string' && AREA_INFO[area].levels.includes(level as Level)) {
        access[area] = level as Level;
      }
    }
  }
  return access;
}

/** Only what differs from the role's template, so a template change reaches everyone who never had it overridden. */
export function accessOverrides(role: Role, access: Access): Partial<Access> {
  const template = ROLE_TEMPLATES[role];
  const out: Partial<Access> = {};
  for (const area of AREAS) {
    if (access[area] !== template[area]) out[area] = access[area];
  }
  return out;
}

/** At least this level in this area. */
export function can(access: Access, area: Area, level: Level): boolean {
  return RANK[access[area]] >= RANK[level];
}
