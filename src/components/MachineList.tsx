'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { MachineStatus } from '@prisma/client';
import { api, uploadImage } from '@/lib/client';
import { MACHINE_STATUS_LABELS, MACHINE_STATUS_ORDER, formatDate, toDateInputValue } from '@/lib/format';
import type { MachineDetail, MachineSummary } from '@/lib/machine-types';
import type { DepartmentOption, LocationOption } from '@/components/AssetManager';
import { Alert, Field, MachineStatusPill, Modal } from '@/components/ui';
import { PhotoSwiper } from '@/components/PhotoSwiper';

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
                <PhotoSwiper photos={m.photos} name={m.name} className="machine-card-photo" />
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

/** A photo in the form: one already on the machine, or one picked and not yet sent. */
type PhotoItem =
  | { kind: 'saved'; key: string; id: string; url: string }
  | { kind: 'new'; key: string; file: File; url: string };

/** The same ceiling the photos route keeps. */
const PHOTO_LIMIT = 12;

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
  const [photos, setPhotos] = useState<PhotoItem[]>(() =>
    (machine?.photos ?? []).map((p) => ({ kind: 'saved', key: p.id, id: p.id, url: p.url })),
  );
  const [removed, setRemoved] = useState<string[]>([]);
  // Set once a new machine is saved, so a retry after a failed photo updates
  // that machine instead of adding a second one.
  const [savedId, setSavedId] = useState<string | null>(machine?.id ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));

  async function save() {
    setBusy(true);
    setError('');
    setFields({});
    const result = await api<{ machine: { id: string } }>(savedId ? `/api/machines/${savedId}` : '/api/machines', {
      method: savedId ? 'PATCH' : 'POST',
      json: form,
    });
    if (!result.ok) {
      setBusy(false);
      setError(result.error);
      setFields(result.fields ?? {});
      return;
    }
    const id = result.data.machine.id;
    setSavedId(id);

    // The photos follow the record, one request each, like every photo here.
    // Each one that goes up becomes a saved one, so a retry sends only the rest.
    const failed: string[] = [];
    for (const photoId of removed) {
      const gone = await api(`/api/machines/${id}/photos/${photoId}`, { method: 'DELETE' });
      if (!gone.ok) failed.push(gone.error);
    }
    setRemoved([]);
    const final: PhotoItem[] = [];
    for (const item of photos) {
      if (item.kind === 'saved') {
        final.push(item);
        continue;
      }
      const up = await uploadImage<{ photo: { id: string } }>(`/api/machines/${id}/photos`, item.file, 'POST');
      if (up.ok) final.push({ kind: 'saved', key: item.key, id: up.data.photo.id, url: item.url });
      else {
        final.push(item);
        failed.push(`${item.file.name}: ${up.error}`);
      }
    }
    setPhotos(final);
    // New photos land at the end, so the order only needs sending when it is
    // not already what the server has.
    const order = final.flatMap((p) => (p.kind === 'saved' ? [p.id] : []));
    const kept = (machine?.photos ?? []).map((p) => p.id).filter((p) => order.includes(p));
    const serverOrder = [...kept, ...order.filter((p) => !kept.includes(p))];
    if (failed.length === 0 && order.length > 1 && order.join() !== serverOrder.join()) {
      const ordered = await api(`/api/machines/${id}/photos`, { method: 'PUT', json: { order } });
      if (!ordered.ok) failed.push(ordered.error);
    }
    setBusy(false);

    if (failed.length > 0) {
      setError(`The machine is saved, but not every photo is. ${failed.join(' ')} Save again to retry.`);
      router.refresh();
      return;
    }
    onClose();
    if (machine) router.refresh();
    else router.push(`/machines/${id}`);
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
      <Field label="Photos" hint="The cover is the one the list shows first; the others swipe in behind it.">
        <MachinePhotosField
          photos={photos}
          disabled={busy}
          onChange={setPhotos}
          onRemoveSaved={(id) => setRemoved((r) => [...r, id])}
        />
      </Field>
    </Modal>
  );
}

function MachinePhotosField({
  photos,
  disabled,
  onChange,
  onRemoveSaved,
}: {
  photos: PhotoItem[];
  disabled: boolean;
  onChange: (photos: PhotoItem[]) => void;
  onRemoveSaved: (id: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const latest = useRef(photos);
  latest.current = photos;

  // The previews of picked files are object URLs; let them go with the form.
  useEffect(
    () => () => {
      for (const p of latest.current) if (p.kind === 'new') URL.revokeObjectURL(p.url);
    },
    [],
  );

  function add(files: File[]) {
    const room = Math.max(0, PHOTO_LIMIT - photos.length);
    const picked: PhotoItem[] = files
      .filter((f) => f.type.startsWith('image/'))
      .slice(0, room)
      .map((file, i) => ({ kind: 'new', key: `new-${Date.now()}-${i}`, file, url: URL.createObjectURL(file) }));
    onChange([...photos, ...picked]);
  }

  function remove(item: PhotoItem) {
    if (item.kind === 'saved') onRemoveSaved(item.id);
    else URL.revokeObjectURL(item.url);
    onChange(photos.filter((p) => p.key !== item.key));
  }

  return (
    <div className="photo-strip">
      {photos.map((item, i) => (
        <div key={item.key} className="photo-strip-item">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={item.url} alt="" />
          <button
            type="button"
            className="photo-strip-remove"
            aria-label="Remove this photo"
            disabled={disabled}
            onClick={() => remove(item)}
          >
            ✕
          </button>
          <div className="photo-strip-caption">
            {i === 0 ? (
              'Cover'
            ) : (
              <button
                type="button"
                className="photo-strip-cover"
                disabled={disabled}
                onClick={() => onChange([item, ...photos.filter((p) => p.key !== item.key)])}
              >
                Make cover
              </button>
            )}
          </div>
        </div>
      ))}
      {photos.length < PHOTO_LIMIT ? (
        <button type="button" className="photo-strip-add" disabled={disabled} onClick={() => input.current?.click()}>
          + Add photos
        </button>
      ) : null}
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        hidden
        onChange={(e) => {
          add(Array.from(e.target.files ?? []));
          e.target.value = '';
        }}
      />
    </div>
  );
}
