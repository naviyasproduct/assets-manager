import type { IconName } from '@/components/icons';

/**
 * The one list of destinations in the app.
 *
 * Both the sidebar and the landing page read it, so a screen can never appear
 * in one and be missing from the other. Home is deliberately not in here: the
 * landing page would otherwise show a tile pointing at itself.
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

/**
 * A department head has no use for the departments list - they only ever have
 * one - so their entry points straight at their own department.
 */
export function navItems({
  isAdmin,
  departmentId,
}: {
  isAdmin: boolean;
  departmentId: string | null;
}): NavItem[] {
  const items: NavItem[] = [
    isAdmin
      ? {
          href: '/departments',
          label: 'Departments',
          icon: 'departments',
          description: 'Every department and the equipment it holds.',
          tint: 'blue',
        }
      : {
          href: departmentId ? `/departments/${departmentId}` : '/assets',
          label: 'My department',
          icon: 'departments',
          description: 'Your department and the equipment it holds.',
          tint: 'blue',
        },
    {
      href: '/assets',
      label: 'Assets',
      icon: 'assets',
      description: 'Every machine on record, its condition and repair history.',
      tint: 'teal',
    },
    {
      href: '/categories',
      label: 'Categories',
      icon: 'categories',
      description: 'The kinds of equipment an asset can be filed under.',
      tint: 'violet',
    },
  ];

  // Locations are site-wide and only an admin may edit them, so the screen
  // would be read-only for everyone else. A department head reaches the same
  // information by filtering the assets table by location.
  if (isAdmin) {
    items.push({
      href: '/locations',
      label: 'Locations',
      icon: 'locations',
      description: 'The rooms and sites equipment stands in.',
      tint: 'amber',
    });
  }

  items.push(
    {
      href: '/purchases',
      label: 'Purchase needs',
      icon: 'purchases',
      description: 'What each department has asked to buy, and what is pending.',
      tint: 'green',
    },
    {
      href: '/reports',
      label: 'Reports',
      icon: 'reports',
      description: 'Build a PDF of equipment and spending to hand upwards.',
      tint: 'slate',
    },
  );

  if (isAdmin) {
    items.push({
      href: '/users',
      label: 'Users',
      icon: 'users',
      description: 'Accounts, roles and which department each one can see.',
      tint: 'rose',
    });
  }

  return items;
}
