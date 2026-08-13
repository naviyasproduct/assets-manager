import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { config } from '@/lib/config';
import { ChangePasswordForm } from './ChangePasswordForm';

export const dynamic = 'force-dynamic';

export default async function ChangePasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const { next } = await searchParams;
  const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : '/';

  return (
    <main className="login-page">
      <div className="login-card">
        <div className="login-brand">
          <div className="brand-mark">
            {config.branding.companyName.slice(0, 2).toUpperCase()}
          </div>
          <h1>Set a new password</h1>
          <p>
            {user.mustChangePassword
              ? 'Your account was created with a temporary password. Choose your own before continuing.'
              : 'Update the password for your account.'}
          </p>
        </div>

        <div className="card">
          <div className="card-body">
            <ChangePasswordForm next={safeNext} canSkip={!user.mustChangePassword} />
          </div>
        </div>
      </div>
    </main>
  );
}
