'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon } from '@/components/icons';
import { navItems } from '@/lib/nav';

/**
 * The sidebar, shown on every screen except the landing page - that one is the
 * launcher itself, so it carries no nav beside itself.
 *
 * Destinations come from `navItems` so this list and the landing page's tiles
 * cannot drift apart. Home is prepended here only: as a tile it would point at
 * the page you are already on.
 */
export function NavLinks({
  isAdmin,
  departmentId,
}: {
  isAdmin: boolean;
  departmentId: string | null;
}) {
  const pathname = usePathname();

  const links = [
    { href: '/', label: 'Home', icon: 'home' as const },
    ...navItems({ isAdmin, departmentId }),
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
          </Link>
        );
      })}
    </nav>
  );
}
