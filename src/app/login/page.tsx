import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { config } from '@/lib/config';
import { LoginForm } from './LoginForm';

export const dynamic = 'force-dynamic';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const user = await getCurrentUser();
  if (user) redirect('/');

  const { next } = await searchParams;

  // Only allow same-site redirects, so a crafted ?next= cannot bounce someone
  // off to another host after they sign in.
  const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : '/';

  return (
    <main className="login-page">
      <div className="login-card">
        <div className="login-brand">
          <div className="brand-mark">
            {config.branding.companyName.slice(0, 2).toUpperCase()}
          </div>
          <h1>{config.branding.companyName}</h1>
          <p>Asset &amp; purchase planning</p>
        </div>

        <div className="card">
          <div className="card-body">
            <LoginForm next={safeNext} />
          </div>
        </div>

        <p
          style={{
            textAlign: 'center',
            marginTop: 18,
            fontSize: 12.5,
            color: 'var(--ink-muted)',
          }}
        >
          Internal system · office network only
        </p>
      </div>
    </main>
  );
}
