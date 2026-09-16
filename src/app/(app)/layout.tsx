import Link from 'next/link';
import { config } from '@/lib/config';
import { requirePageUser } from '@/lib/page-auth';
import { NavLinks } from '@/components/NavLinks';
import { SignOutButton } from '@/components/SignOutButton';

export const dynamic = 'force-dynamic';

/** Every screen with a sidebar. The landing page sits outside this group. */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requirePageUser();
  const isAdmin = user.role === 'ADMIN';

  return (
    <div className="shell">
      <aside className="sidebar">
        <Link href="/" className="brand">
          <span className="brand-mark">
            {config.branding.companyName.slice(0, 2).toUpperCase()}
          </span>
          <span className="brand-name">Asset Manager</span>
        </Link>

        <NavLinks isAdmin={isAdmin} departmentId={user.departmentId} />

        <div className="sidebar-foot">
          <div className="user-chip">
            <span className="user-avatar" aria-hidden="true">
              {initials(user.name)}
            </span>
            <span className="user-meta">
              <strong>{user.name}</strong>
              <span className="user-sub">
                <span className="user-role">{isAdmin ? 'Admin' : 'Dept Head'}</span>
                {user.department ? <span className="user-dept">{user.department.name}</span> : null}
              </span>
            </span>
          </div>
          <SignOutButton />
        </div>
      </aside>

      <main className="page">{children}</main>
    </div>
  );
}

/** Up to two initials for the avatar; falls back to '?' rather than rendering empty. */
function initials(name: string): string {
  const letters = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]);

  return letters.length > 0 ? letters.join('').toUpperCase() : '?';
}
