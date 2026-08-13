'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/client';
import { Field, Alert } from '@/components/ui';

type LoginResponse = { user: { mustChangePassword: boolean } };

export function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setFields({});

    const result = await api<LoginResponse>('/api/auth/login', {
      method: 'POST',
      json: { email, password },
    });

    if (!result.ok) {
      setError(result.error);
      setFields(result.fields ?? {});
      setBusy(false);
      return;
    }

    // Admin-created accounts start with a password the admin knows, so the
    // holder is sent straight to a change-password screen.
    const destination = result.data.user.mustChangePassword
      ? `/change-password?next=${encodeURIComponent(next)}`
      : next;

    // refresh() so the server components re-render with the new session before
    // navigating, otherwise the shell can flash the signed-out state.
    router.replace(destination);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      {error ? <Alert>{error}</Alert> : null}

      <Field label="Email" htmlFor="email" error={fields.email}>
        <input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="username"
          autoFocus
          required
          aria-invalid={fields.email ? true : undefined}
        />
      </Field>

      <Field label="Password" htmlFor="password" error={fields.password}>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
          aria-invalid={fields.password ? true : undefined}
        />
      </Field>

      <button
        type="submit"
        className="btn btn-primary"
        style={{ width: '100%', marginTop: 4 }}
        disabled={busy}
      >
        {busy ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}
