'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/client';
import { NEW_DEPARTMENT_KEY, stashDraft } from '@/lib/form-draft';
import { Field, Alert } from '@/components/ui';

type FormState = { name: string; code: string; description: string; location: string };

/** First three letters/digits of the name - the code people would pick anyway. */
function suggestCode(name: string): string {
  return name.replace(/[^a-zA-Z0-9]/g, '').slice(0, 3).toUpperCase();
}

/**
 * A whole page rather than a dialog, because this is usually reached from the
 * middle of adding an asset: a dialog stacked on a dialog would leave no way to
 * tell which one Cancel was about to close.
 *
 * `returnTo` is where the person came from. The new department's id is left in
 * session storage on the way back so the asset form can select it without the
 * user hunting for it in a list.
 */
export function NewDepartmentForm({
  returnTo,
  returnLabel,
}: {
  returnTo: string;
  returnLabel: string;
}) {
  const router = useRouter();

  const [form, setForm] = useState<FormState>({
    name: '',
    code: '',
    description: '',
    location: '',
  });
  const [error, setError] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setFields({});

    const result = await api<{ department: { id: string } }>('/api/departments', {
      method: 'POST',
      json: form,
    });

    if (!result.ok) {
      setBusy(false);
      setError(result.error);
      setFields(result.fields ?? {});
      return;
    }

    stashDraft(NEW_DEPARTMENT_KEY, result.data.department.id);
    router.push(returnTo);
  }

  return (
    <div className="card" style={{ maxWidth: 640 }}>
      <div className="card-body">
        <form onSubmit={submit} noValidate>
          {error ? <Alert>{error}</Alert> : null}

          <div className="field-row">
            <Field label="Name" htmlFor="dept-name" error={fields.name}>
              <input
                id="dept-name"
                type="text"
                value={form.name}
                autoFocus
                onChange={(e) =>
                  setForm((current) => ({
                    name: e.target.value,
                    // Follows the name until the code is edited by hand.
                    code:
                      current.code === suggestCode(current.name)
                        ? suggestCode(e.target.value)
                        : current.code,
                    description: current.description,
                    location: current.location,
                  }))
                }
                required
              />
            </Field>

            <Field
              label="Code"
              htmlFor="dept-code"
              error={fields.code}
              hint="Starts every asset tag here, e.g. WRK → WRK-NUT-001."
            >
              <input
                id="dept-code"
                type="text"
                className="mono"
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                maxLength={10}
                required
              />
            </Field>
          </div>

          <Field label="Location" htmlFor="dept-location" error={fields.location}>
            <input
              id="dept-location"
              type="text"
              value={form.location}
              onChange={(e) => setForm({ ...form, location: e.target.value })}
              placeholder="Optional - e.g. Ground floor, west wing"
            />
          </Field>

          <Field label="Description" htmlFor="dept-description" error={fields.description}>
            <textarea
              id="dept-description"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Optional. Appears at the top of this department's report section."
            />
          </Field>

          <div className="row" style={{ marginTop: 4 }}>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? 'Creating…' : 'Create department'}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => router.push(returnTo)}
              disabled={busy}
            >
              {returnLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
