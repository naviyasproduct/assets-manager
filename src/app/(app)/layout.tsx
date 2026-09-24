import Link from 'next/link';
import { config } from '@/lib/config';
import { requirePageUser } from '@/lib/page-auth';
import { seesAllDepartments } from '@/lib/auth';
import { ROLE_LABELS } from '@/lib/permissions';
import { NavLinks } from '@/components/NavLinks';
import { SignOutButton } from '@/components/SignOutButton';

export const dynamic = 'force-dynamic';

/** Every screen with a sidebar. The landing page sits outside this group. */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requirePageUser();

  return (
    <div className="shell">
      <aside className="sidebar">
        <Link href="/" className="brand">
          <span className="brand-mark">
            {config.branding.companyName.slice(0, 2).toUpperCase()}
          </span>
          <span className="brand-name">Asset Manager</span>
        </Link>

        <NavLinks
          access={user.access}
          allDepartments={seesAllDepartments(user)}
          departmentId={user.departmentId}
        />

        <div className="sidebar-foot">
          <div className="user-chip">
            {user.photoRelativePath ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                className="user-avatar user-avatar-photo"
                src={`/api/users/${user.id}/photo?v=${user.photoUploadedAt?.getTime() ?? 0}`}
                alt=""
              />
            ) : (
              <span className="user-avatar" aria-hidden="true">
                {initials(user.name)}
              </span>
            )}
            <span className="user-meta">
              <strong>{user.name}</strong>
              <span className="user-sub">
                <span className="user-role">{ROLE_LABELS[user.role]}</span>
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
