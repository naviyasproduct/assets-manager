'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon, type IconName } from '@/components/icons';

/**
 * A department head has no use for the departments list - they only ever have
 * one - so their nav points straight at their own department's assets.
 */
export function NavLinks({
  isAdmin,
  departmentId,
}: {
  isAdmin: boolean;
  departmentId: string | null;
}) {
  const pathname = usePathname();

  const links: Array<{ href: string; label: string; icon: IconName }> = [
    { href: '/', label: 'Overview', icon: 'overview' },
    isAdmin
      ? { href: '/departments', label: 'Departments', icon: 'departments' }
      : {
          href: departmentId ? `/departments/${departmentId}` : '/',
          label: 'My department',
          icon: 'departments',
        },
    { href: '/assets', label: 'Assets', icon: 'assets' },
    { href: '/categories', label: 'Categories', icon: 'categories' },
    // Locations are site-wide and only an admin may edit them, so the screen
    // would be read-only for everyone else. A department head reaches the same
    // information by filtering the assets table by location.
    ...(isAdmin
      ? ([{ href: '/locations', label: 'Locations', icon: 'locations' }] as const)
      : []),
    { href: '/purchases', label: 'Purchase planning', icon: 'purchases' },
    { href: '/reports', label: 'Reports', icon: 'reports' },
  ];

  if (isAdmin) links.push({ href: '/users', label: 'Users', icon: 'users' });

  return (
    <nav className="nav" aria-label="Main">
      {links.map((link) => {
        const active =
          link.href === '/'
            ? pathname === '/'
            : pathname === link.href || pathname.startsWith(`${link.href}/`);

        return (
          <Link
            key={link.href}
            href={link.href}
            className={active ? 'active' : undefined}
            aria-current={active ? 'page' : undefined}
          >
            <Icon name={link.icon} className="nav-icon" />
            <span className="nav-label">{link.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
