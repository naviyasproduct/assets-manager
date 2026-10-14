'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { MachineStatus } from '@prisma/client';
import { api } from '@/lib/client';
import { MACHINE_STATUS_LABELS, MACHINE_STATUS_ORDER, formatDate, toDateInputValue } from '@/lib/format';
import type { MachineDetail, MachineSummary } from '@/lib/machine-types';
import type { DepartmentOption, LocationOption } from '@/components/AssetManager';
import { Alert, Field, MachineStatusPill, Modal } from '@/components/ui';

/**
 * Every machine, as cards: what it is, where it stands, whether it is running,
 * and how far its repair history has got. The history itself is on each
 * machine's own page.
 */
export function MachineList({
  machines,
  departments,
  locations,
  canEdit,
  showDepartment,
  defaultDepartmentId,
}: {
  machines: MachineSummary[];
  departments: DepartmentOption[];
  locations: LocationOption[];
  canEdit: boolean;
  showDepartment: boolean;
  defaultDepartmentId: string | null;
}) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<MachineStatus | 'ALL'>('ALL');
  const [adding, setAdding] = useState(false);

  const counts = useMemo(() => {
    const out: Record<MachineStatus, number> = { RUNNING: 0, UNDER_REPAIR: 0, STOPPED: 0 };
    for (const m of machines) out[m.status] += 1;
    return out;
  }, [machines]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return machines.filter((m) => {
      if (filter !== 'ALL' && m.status !== filter) return false;
      if (!q) return true;
      return [m.name, m.code, m.model, m.manufacturer, m.departmentName, m.locationName]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(q);
    });
  }, [machines, query, filter]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Machines</h1>
          <p>Each machine&apos;s profile and every repair done on it, numbered like versions.</p>
        </div>
        {canEdit ? (
          <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
            + Add machine
          </button>
        ) : null}
      </div>

      <div className="card">
        <div className="toolbar">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, number, model…"
            aria-label="Search machines"
          />
          <div className="tabs" role="tablist" aria-label="Machine status">
            <button
              type="button"
              role="tab"
              aria-selected={filter === 'ALL'}
              className={filter === 'ALL' ? 'is-on' : undefined}
              onClick={() => setFilter('ALL')}
            >
              All <span className="tab-count">{machines.length}</span>
            </button>
            {MACHINE_STATUS_ORDER.map((status) => (
              <button
                key={status}
                type="button"
                role="tab"
                aria-selected={filter === status}
                className={filter === status ? 'is-on' : undefined}
                onClick={() => setFilter(status)}
              >
                {MACHINE_STATUS_LABELS[status]} <span className="tab-count">{counts[status]}</span>
              </button>
            ))}
          </div>
        </div>

        {machines.length === 0 ? (
          <div className="empty-state">
            <h3>No machines yet</h3>
            <p>Add a machine to give it a profile and start keeping its repair history.</p>
            {canEdit ? (
              <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
                + Add machine
              </button>
            ) : null}
          </div>
        ) : shown.length === 0 ? (
          <div className="empty-state">
            <p style={{ margin: 0 }}>Nothing matches.</p>
          </div>
        ) : (
          <div className="machine-grid">
            {shown.map((m) => (
              <Link key={m.id} href={`/machines/${m.id}`} className="machine-card">
                {m.photoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className="machine-card-photo" src={m.photoUrl} alt="" />
                ) : (
                  <div className="machine-card-photo machine-card-photo-empty" aria-hidden="true">
                    {m.name[0]?.toUpperCase()}
                  </div>
                )}
                <div className="machine-card-body">
                  <div className="row" style={{ gap: 8, justifyContent: 'space-between' }}>
                    <span className="mono muted" style={{ fontSize: 12 }}>
                      {m.code ?? 'No number'}
                    </span>
                    <MachineStatusPill status={m.status} />
                  </div>
                  <div className="machine-card-name">{m.name}</div>
                  <div className="cell-sub">
                    {[m.model, m.manufacturer].filter(Boolean).join(' · ') || 'Model not recorded'}
                  </div>
                  <div className="cell-sub">
                    {[showDepartment ? m.departmentName : null, m.locationName].filter(Boolean).join(' · ')}
                  </div>
                  <div className="machine-card-foot">
                    {m.version > 0 ? (
                      <>
                        <span className="version-chip">v{m.version}</span>
                        {m.repairCount} repair{m.repairCount === 1 ? '' : 's'}
                        {m.lastRepairAt ? ` · last ${formatDate(m.lastRepairAt)}` : ''}
                      </>
                    ) : (
                      <span className="muted">No repairs yet</span>
                    )}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      {adding ? (
        <MachineForm
          departments={departments}
          locations={locations}
          defaultDepartmentId={defaultDepartmentId}
          onClose={() => setAdding(false)}
        />
      ) : null}
    </>
  );
}

type FormState = {
  name: string;
  code: string;
  model: string;
  manufacturer: string;
  serialNumber: string;
  status: MachineStatus;
  departmentId: string;
  locationId: string;
  installedAt: string;
  notes: string;
};

/** Adding a machine, or editing one when `machine` is given. */
export function MachineForm({
  machine,
  departments,
  locations,
  defaultDepartmentId,
  onClose,
}: {
  machine?: MachineDetail;
  departments: DepartmentOption[];
  locations: LocationOption[];
  defaultDepartmentId?: string | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [form, setForm] = useState<FormState>({
    name: machine?.name ?? '',
    code: machine?.code ?? '',
    model: machine?.model ?? '',
    manufacturer: machine?.manufacturer ?? '',
    serialNumber: machine?.serialNumber ?? '',
    status: machine?.status ?? 'RUNNING',
    departmentId: machine?.departmentId ?? defaultDepartmentId ?? departments[0]?.id ?? '',
    locationId: machine?.locationId ?? '',
    installedAt: toDateInputValue(machine?.installedAt ?? null),
    notes: machine?.notes ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));

  async function save() {
    setBusy(true);
    setError('');
    setFields({});
    const result = await api<{ machine: { id: string } }>(machine ? `/api/machines/${machine.id}` : '/api/machines', {
      method: machine ? 'PATCH' : 'POST',
      json: form,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      setFields(result.fields ?? {});
      return;
    }
    onClose();
    if (machine) router.refresh();
    else router.push(`/machines/${result.data.machine.id}`);
  }

  return (
    <Modal
      title={machine ? `Edit ${machine.name}` : 'Add a machine'}
      onClose={onClose}
      wide
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={busy}>
            {busy ? 'Saving…' : machine ? 'Save' : 'Add machine'}
          </button>
        </>
      }
    >
      {error ? <Alert>{error}</Alert> : null}
      <div className="field-row field-row-auto">
        <Field label="Name" htmlFor="m-name" error={fields.name}>
          <input id="m-name" type="text" value={form.name} autoFocus onChange={(e) => set('name', e.target.value)} placeholder="e.g. Injection moulder 3" />
        </Field>
        <Field label="Machine number" htmlFor="m-code" error={fields.code} hint="The number on the machine, if it has one.">
          <input id="m-code" type="text" value={form.code} onChange={(e) => set('code', e.target.value)} />
        </Field>
      </div>
      <div className="field-row field-row-auto">
        <Field label="Model" htmlFor="m-model" error={fields.model}>
          <input id="m-model" type="text" value={form.model} onChange={(e) => set('model', e.target.value)} />
        </Field>
        <Field label="Maker" htmlFor="m-maker" error={fields.manufacturer}>
          <input id="m-maker" type="text" value={form.manufacturer} onChange={(e) => set('manufacturer', e.target.value)} />
        </Field>
        <Field label="Serial number" htmlFor="m-serial" error={fields.serialNumber}>
          <input id="m-serial" type="text" value={form.serialNumber} onChange={(e) => set('serialNumber', e.target.value)} />
        </Field>
      </div>
      <div className="field-row field-row-auto">
        <Field label="Department" htmlFor="m-dept" error={fields.departmentId}>
          <select id="m-dept" value={form.departmentId} onChange={(e) => set('departmentId', e.target.value)}>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Location" htmlFor="m-loc" error={fields.locationId}>
          <select id="m-loc" value={form.locationId} onChange={(e) => set('locationId', e.target.value)}>
            <option value="">Not recorded</option>
            {locations
              .filter((l) => l.isActive || l.id === form.locationId)
              .map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
          </select>
        </Field>
        <Field label="Status" htmlFor="m-status" error={fields.status}>
          <select id="m-status" value={form.status} onChange={(e) => set('status', e.target.value as MachineStatus)}>
            {MACHINE_STATUS_ORDER.map((s) => (
              <option key={s} value={s}>
                {MACHINE_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Installed" htmlFor="m-installed" error={fields.installedAt}>
          <input id="m-installed" type="date" value={form.installedAt} onChange={(e) => set('installedAt', e.target.value)} />
        </Field>
      </div>
      <Field label="Notes" htmlFor="m-notes" error={fields.notes} hint="Anything worth knowing: settings, quirks, who to call.">
        <textarea id="m-notes" rows={4} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
      </Field>
    </Modal>
  );
}
