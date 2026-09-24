import type { IconName } from '@/components/icons';
import { can, type Access, type Area } from '@/lib/permissions';

/**
 * The one list of destinations in the app.
 *
 * Both the sidebar and the landing page read it, so a screen can never appear
 * in one and be missing from the other. Home is deliberately not in here: the
 * landing page would otherwise show a tile pointing at itself.
 *
 * Each entry names the area that opens it, and is only listed for someone with
 * at least view access there (or "assigned only", for Purchasing). The screens
 * enforce the same rule server-side; this just keeps dead links off the page.
 */
export type NavItem = {
  href: string;
  label: string;
  icon: IconName;
  /** The line under the label on the landing page. The sidebar ignores it. */
  description: string;
  /** Picks the tile's pastel from the --tile-* pairs in globals.css. */
  tint: string;
};

type Entry = NavItem & { area: Area };

/**
 * Someone scoped to one department has no use for the departments list - they
 * only ever have one - so their entry points straight at their own department.
 */
export function navItems({
  access,
  allDepartments,
  departmentId,
}: {
  access: Access;
  allDepartments: boolean;
  departmentId: string | null;
}): NavItem[] {
  const entries: Entry[] = [
    allDepartments
      ? {
          area: 'departments',
          href: '/departments',
          label: 'Departments',
          icon: 'departments',
          description: 'Every department and the equipment it holds.',
          tint: 'blue',
        }
      : {
          area: 'departments',
          href: departmentId ? `/departments/${departmentId}` : '/assets',
          label: 'My department',
          icon: 'departments',
          description: 'Your department and the equipment it holds.',
          tint: 'blue',
        },
    {
      area: 'assets',
      href: '/assets',
      label: 'Assets',
      icon: 'assets',
      description: 'Every machine on record, its condition and repair history.',
      tint: 'teal',
    },
    {
      area: 'categories',
      href: '/categories',
      label: 'Categories',
      icon: 'categories',
      description: 'The kinds of equipment an asset can be filed under.',
      tint: 'violet',
    },
    {
      area: 'locations',
      href: '/locations',
      label: 'Locations',
      icon: 'locations',
      description: 'The rooms and sites equipment stands in.',
      tint: 'amber',
    },
    {
      area: 'purchasing',
      href: '/purchasing',
      label: 'Purchasing',
      icon: 'purchases',
      description: 'Purchase orders, from the written list to what was bought.',
      tint: 'green',
    },
    {
      area: 'suppliers',
      href: '/suppliers',
      label: 'Suppliers',
      icon: 'suppliers',
      description: 'Local and international suppliers and how to reach them.',
      tint: 'amber',
    },
    {
      area: 'reports',
      href: '/reports',
      label: 'Reports',
      icon: 'reports',
      description: 'Build a PDF of equipment and spending to hand upwards.',
      tint: 'slate',
    },
    {
      area: 'employees',
      href: '/employees',
      label: 'Employees',
      icon: 'users',
      description: 'The people here, their roles and what each can open.',
      tint: 'rose',
    },
  ];

  return entries
    .filter((entry) =>
      can(access, entry.area, entry.area === 'purchasing' ? 'ASSIGNED' : 'VIEW'),
    )
    .map(({ area: _area, ...item }) => item);
}
