'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/client';
import { Icon } from '@/components/icons';

export function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  return (
    <button
      type="button"
      className="btn btn-ghost btn-sm btn-signout"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await api('/api/auth/logout', { method: 'POST' });
        router.replace('/login');
        router.refresh();
      }}
    >
      <Icon name="signout" />
      <span>{busy ? 'Signing out…' : 'Sign out'}</span>
    </button>
  );
}
