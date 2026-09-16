import Link from 'next/link';
import { requirePageUser } from '@/lib/page-auth';
import { config } from '@/lib/config';
import { navItems } from '@/lib/nav';
import { Icon } from '@/components/icons';
import { SignOutButton } from '@/components/SignOutButton';

export const dynamic = 'force-dynamic';

/**
 * The landing page: nothing but a way in to everything else.
 *
 * It lives at the app root rather than inside the (app) group on purpose - that
 * group's layout is what draws the sidebar, and here the tiles are the
 * navigation, so a sidebar beside them would just say the same thing twice.
 *
 * Deliberately queries nothing. The numbers it used to show were a summary
 * nobody acted on, and a launcher that waits on the database is a launcher that
 * feels slow.
 */
export default async function HomePage() {
  const user = await requirePageUser();
  const isAdmin = user.role === 'ADMIN';
  const items = navItems({ isAdmin, departmentId: user.departmentId });

  return (
    <main className="home">
      <header className="home-top">
        <div className="brand">
          <span className="brand-mark">
            {config.branding.companyName.slice(0, 2).toUpperCase()}
          </span>
          <span className="brand-name">Asset Manager</span>
        </div>
        <div className="home-top-right">
          <span className="home-user">
            <strong>{user.name}</strong>
            <span className="user-role">{isAdmin ? 'Admin' : 'Dept Head'}</span>
          </span>
          <SignOutButton />
        </div>
      </header>

      <nav className="home-grid" aria-label="Sections">
        {items.map((item) => (
          <Link key={item.href} href={item.href} className={`tile tile-${item.tint}`}>
            <span className="tile-icon" aria-hidden="true">
              <Icon name={item.icon} className="tile-glyph" />
            </span>
            <span className="tile-text">
              <span className="tile-label">{item.label}</span>
              <span className="tile-desc">{item.description}</span>
            </span>
          </Link>
        ))}
      </nav>
    </main>
  );
}
