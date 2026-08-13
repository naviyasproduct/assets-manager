import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getCurrentUser } from '@/lib/auth';
import { config } from '@/lib/config';
import { NavLinks } from '@/components/NavLinks';
import { SignOutButton } from '@/components/SignOutButton';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  // Middleware only checks that a cookie exists. This is the real gate, and it
  // also blocks the app until a temporary password has been replaced.
  if (user.mustChangePassword) redirect('/change-password');

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
