'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/client';
import { Field, Alert } from '@/components/ui';

export function ChangePasswordForm({ next, canSkip }: { next: string; canSkip: boolean }) {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setFields({});

    const result = await api('/api/auth/change-password', {
      method: 'POST',
      json: { currentPassword, newPassword, confirmPassword },
    });

    if (!result.ok) {
      setError(result.error);
      setFields(result.fields ?? {});
      setBusy(false);
      return;
    }

    router.replace(next);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      {error ? <Alert>{error}</Alert> : null}

      <Field label="Current password" htmlFor="current" error={fields.currentPassword}>
        <input
          id="current"
          type="password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          autoComplete="current-password"
          autoFocus
          required
        />
      </Field>

      <Field
        label="New password"
        htmlFor="new"
        error={fields.newPassword}
        hint="At least 10 characters."
      >
        <input
          id="new"
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          autoComplete="new-password"
          required
        />
      </Field>

      <Field label="Confirm new password" htmlFor="confirm" error={fields.confirmPassword}>
        <input
          id="confirm"
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          autoComplete="new-password"
          required
        />
      </Field>

      <div className="row" style={{ marginTop: 4 }}>
        <button type="submit" className="btn btn-primary" disabled={busy} style={{ flex: 1 }}>
          {busy ? 'Saving…' : 'Save password'}
        </button>
        {canSkip ? (
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => router.push(next)}
            disabled={busy}
          >
            Cancel
          </button>
        ) : null}
      </div>
    </form>
  );
}
