'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon } from '@/components/icons';
import { navItems } from '@/lib/nav';
import type { Access } from '@/lib/permissions';

/**
 * The sidebar, shown on every screen except the landing page - that one is the
 * launcher itself, so it carries no nav beside itself.
 *
 * Destinations come from `navItems` so this list and the landing page's tiles
 * cannot drift apart. Home is prepended here only: as a tile it would point at
 * the page you are already on.
 */
export function NavLinks({
  access,
  allDepartments,
  departmentId,
  badges,
}: {
  access: Access;
  allDepartments: boolean;
  departmentId: string | null;
  /** A red count beside a link, keyed by its href - items needing attention. */
  badges?: Record<string, number>;
}) {
  const pathname = usePathname();

  const links = [
    { href: '/', label: 'Home', icon: 'home' as const },
    ...navItems({ access, allDepartments, departmentId }),
  ];

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
            {badges?.[link.href] ? (
              <span className="nav-badge" title={`${badges[link.href]} need attention`}>
                {badges[link.href]}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
