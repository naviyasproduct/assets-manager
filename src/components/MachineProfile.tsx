'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { MachineStatus } from '@prisma/client';
import { api, uploadFixFile, uploadImage } from '@/lib/client';
import {
  MACHINE_STATUS_LABELS,
  MACHINE_STATUS_ORDER,
  formatBytes,
  formatDate,
  toDateInputValue,
} from '@/lib/format';
import type { FixFileRow, FixRow, MachineDetail } from '@/lib/machine-types';
import type { DepartmentOption, LocationOption } from '@/components/AssetManager';
import { Alert, BackButton, ConfirmDialog, Field, MachineStatusPill, Modal } from '@/components/ui';
import { Lightbox } from '@/components/PhotoThumb';
import { MachineForm } from '@/components/MachineList';

/**
 * One machine: its profile, and its repairs as a history of versions, newest
 * first - the way a code history reads. Each version keeps what was wrong,
 * what was done, who did it, and every video, photo and file that goes with
 * it, so the next person facing the same fault starts from the last one.
 */

const ACCEPT = 'video/*,image/*,.pdf,.doc,.docx,.xls,.xlsx,.mp4,.mov,.mkv,.avi,.webm,.3gp,.heic';

export function MachineProfile({
  machine,
  fixes,
  departments,
  locations,
  canEdit,
  linksArePublic,
}: {
  machine: MachineDetail;
  fixes: FixRow[];
  departments: DepartmentOption[];
  locations: LocationOption[];
  canEdit: boolean;
  linksArePublic: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [logging, setLogging] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const photoInput = useRef<HTMLInputElement>(null);

  async function changePhoto(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError('');
    const up = await uploadImage(`/api/machines/${machine.id}/photo`, file, 'PUT');
    setBusy(false);
    if (!up.ok) setError(up.error);
    router.refresh();
  }

  async function deleteMachine() {
    setBusy(true);
    const result = await api(`/api/machines/${machine.id}`, { method: 'DELETE' });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      setDeleting(false);
      return;
    }
    router.push('/machines');
    router.refresh();
  }

  const facts: Array<[string, string | null]> = [
    ['Machine number', machine.code],
    ['Model', machine.model],
    ['Maker', machine.manufacturer],
    ['Serial number', machine.serialNumber],
    ['Department', machine.departmentName],
    ['Location', machine.locationName],
    ['Installed', machine.installedAt ? formatDate(machine.installedAt) : null],
    ['Added', `${formatDate(machine.createdAt)}${machine.createdByName ? ` by ${machine.createdByName}` : ''}`],
  ];

  return (
    <>
      <div style={{ marginBottom: 12 }}>
        <BackButton fallback="/machines">← Back</BackButton>
      </div>

      <div className="machine-head">
        <div className="machine-head-photo">
          {machine.photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={machine.photoUrl} alt={`Photo of ${machine.name}`} />
          ) : (
            <div className="machine-head-photo-empty" aria-hidden="true">
              {machine.name[0]?.toUpperCase()}
            </div>
          )}
          {canEdit ? (
            <>
              <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => photoInput.current?.click()}>
                {machine.photoUrl ? 'Change photo' : 'Add photo'}
              </button>
              <input
                ref={photoInput}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                hidden
                onChange={(e) => {
                  void changePhoto(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
            </>
          ) : null}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="row" style={{ gap: 10, marginBottom: 2 }}>
            {machine.code ? <span className="mono muted">{machine.code}</span> : null}
            <MachineStatusPill status={machine.status} />
            {machine.version > 0 ? <span className="version-chip">Current v{machine.version}</span> : null}
          </div>
          <h1 style={{ margin: '2px 0 4px' }}>{machine.name}</h1>
          <p className="muted" style={{ margin: 0 }}>
            {[machine.model, machine.manufacturer].filter(Boolean).join(' · ') || 'Model not recorded'}
          </p>
        </div>
        {canEdit ? (
          <div className="row">
            <button type="button" className="btn btn-secondary" onClick={() => setEditing(true)}>
              Edit
            </button>
            <button type="button" className="btn btn-primary" onClick={() => setLogging(true)}>
              + Log a repair
            </button>
          </div>
        ) : null}
      </div>

      {error ? <Alert>{error}</Alert> : null}

      <div className="grid grid-3" style={{ margin: '16px 0' }}>
        <div className="stat">
          <div className="stat-label">Current version</div>
          <div className="stat-value">{machine.version > 0 ? `v${machine.version}` : '-'}</div>
          <div className="stat-note">{machine.version > 0 ? 'the latest repair' : 'no repairs yet'}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Repairs on record</div>
          <div className="stat-value">{machine.repairCount}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Last repair</div>
          <div className="stat-value" style={{ fontSize: 19 }}>
            {machine.lastRepairAt ? formatDate(machine.lastRepairAt) : '-'}
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-head">
          <h2>Details</h2>
        </div>
        <div className="card-body">
          <dl className="machine-facts">
            {facts.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value ?? <span className="muted">Not recorded</span>}</dd>
              </div>
            ))}
          </dl>
          {machine.notes ? (
            <>
              <div className="section-label" style={{ marginTop: 14 }}>
                Notes
              </div>
              <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{machine.notes}</p>
            </>
          ) : null}
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div>
            <h2>Repair history</h2>
            <p className="muted" style={{ margin: '3px 0 0', fontSize: 12.5 }}>
              Every repair is a version, newest first, with its videos, photos and files.
              {linksArePublic ? '' : ' Video links open inside the office network only.'}
            </p>
          </div>
        </div>
        <div className="card-body">
          {fixes.length === 0 ? (
            <div className="empty-state" style={{ padding: '28px 12px' }}>
              <h3>No repairs yet</h3>
              <p>Log the first repair so the next person does not start from scratch.</p>
              {canEdit ? (
                <button type="button" className="btn btn-primary" onClick={() => setLogging(true)}>
                  + Log a repair
                </button>
              ) : null}
            </div>
          ) : (
            <ol className="history">
              {fixes.map((fix, index) => (
                <FixCard key={fix.id} machineId={machine.id} fix={fix} latest={index === 0} canEdit={canEdit} />
              ))}
            </ol>
          )}
        </div>
      </div>

      {canEdit ? (
        <div style={{ marginTop: 20 }}>
          <button type="button" className="btn btn-danger btn-sm" onClick={() => setDeleting(true)}>
            Delete this machine
          </button>
        </div>
      ) : null}

      {editing ? (
        <MachineForm machine={machine} departments={departments} locations={locations} onClose={() => setEditing(false)} />
      ) : null}
      {logging ? (
        <FixDialog machineId={machine.id} nextVersion={machine.version + 1} onClose={() => setLogging(false)} />
      ) : null}
      {deleting ? (
        <ConfirmDialog
          title={`Delete ${machine.name}?`}
          confirmLabel="Delete machine"
          busy={busy}
          message={`The profile and all ${machine.repairCount} repair${machine.repairCount === 1 ? '' : 's'}, with every video, photo and file, are removed for good.`}
          onCancel={() => setDeleting(false)}
          onConfirm={deleteMachine}
        />
      ) : null}
    </>
  );
}

/** One version in the history. */
function FixCard({
  machineId,
  fix,
  latest,
  canEdit,
}: {
  machineId: string;
  fix: FixRow;
  latest: boolean;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [confirm, setConfirm] = useState<null | 'fix' | FixFileRow>(null);
  const [photo, setPhoto] = useState<FixFileRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const videos = fix.files.filter((f) => f.kind === 'VIDEO');
  const photos = fix.files.filter((f) => f.kind === 'PHOTO');
  const documents = fix.files.filter((f) => f.kind === 'DOCUMENT');

  async function remove() {
    if (!confirm) return;
    setBusy(true);
    const url =
      confirm === 'fix' ? `/api/machines/${machineId}/fixes/${fix.id}` : `/api/machines/${machineId}/files/${confirm.id}`;
    const result = await api(url, { method: 'DELETE' });
    setBusy(false);
    setConfirm(null);
    if (!result.ok) setError(result.error);
    router.refresh();
  }

  return (
    <li className="history-item">
      <div className={`history-badge${latest ? ' is-latest' : ''}`}>v{fix.version}</div>
      <div className="history-body">
        <div className="history-top">
          <div style={{ minWidth: 0 }}>
            <div className="history-title">{fix.title}</div>
            <div className="cell-sub">
              {formatDate(fix.fixedAt)} · fixed by {fix.fixedByName}
              {fix.recordedByName !== fix.fixedByName ? ` · recorded by ${fix.recordedByName}` : ''}
            </div>
          </div>
          <div className="row" style={{ gap: 6 }}>
            {latest ? <span className="pill pill-accent">Latest</span> : null}
            {fix.statusAfter ? (
              <span className="cell-sub nowrap">
                Left <MachineStatusPill status={fix.statusAfter} />
              </span>
            ) : null}
          </div>
        </div>

        {error ? <Alert>{error}</Alert> : null}

        {fix.symptom ? (
          <div className="history-block">
            <div className="section-label">What was wrong</div>
            <p>{fix.symptom}</p>
          </div>
        ) : null}
        <div className="history-block">
          <div className="section-label">What was done</div>
          <p>{fix.description}</p>
        </div>

        {videos.length > 0 ? (
          <div className="history-videos">
            {videos.map((video) => (
              <figure key={video.id} className="history-video">
                <video controls preload="metadata" playsInline src={video.url} />
                <figcaption>
                  <span className="history-file-name">{video.fileName}</span>
                  <span className="muted"> · {formatBytes(video.sizeBytes)}</span>
                  {video.watchUrl ? (
                    <>
                      {' · '}
                      <a href={video.watchUrl} target="_blank" rel="noreferrer">
                        Share link
                      </a>
                    </>
                  ) : null}
                  {canEdit ? (
                    <button type="button" className="history-file-x" onClick={() => setConfirm(video)} aria-label={`Remove ${video.fileName}`}>
                      Remove
                    </button>
                  ) : null}
                </figcaption>
              </figure>
            ))}
          </div>
        ) : null}

        {photos.length > 0 ? (
          <div className="photo-strip" style={{ marginTop: 10 }}>
            {photos.map((p) => (
              <div key={p.id} className="photo-strip-item">
                <button type="button" className="photo-strip-open" onClick={() => setPhoto(p)} aria-label={`Open ${p.fileName}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.url} alt="" loading="lazy" />
                </button>
                {canEdit ? (
                  <button type="button" className="photo-strip-remove" aria-label={`Remove ${p.fileName}`} onClick={() => setConfirm(p)}>
                    ✕
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}

        {documents.length > 0 ? (
          <ul className="doc-list" style={{ marginTop: 8 }}>
            {documents.map((d) => (
              <li key={d.id}>
                <span className="doc-kind">{d.fileName.split('.').pop()?.toUpperCase()}</span>
                <div className="doc-text">
                  <a href={d.url} target="_blank" rel="noreferrer">
                    {d.fileName}
                  </a>
                  <div className="cell-sub">{formatBytes(d.sizeBytes)}</div>
                </div>
                {canEdit ? (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirm(d)}>
                    Remove
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}

        {canEdit ? (
          <div className="row" style={{ gap: 6, marginTop: 12 }}>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setAdding(true)}>
              + Add files
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(true)}>
              Edit
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirm('fix')}>
              Delete
            </button>
          </div>
        ) : null}
      </div>

      {photo ? <Lightbox src={photo.url} name={photo.fileName} onClose={() => setPhoto(null)} /> : null}
      {editing ? <FixDialog machineId={machineId} fix={fix} onClose={() => setEditing(false)} /> : null}
      {adding ? <AddFilesDialog machineId={machineId} fix={fix} onClose={() => setAdding(false)} /> : null}
      {confirm ? (
        <ConfirmDialog
          title={confirm === 'fix' ? `Delete v${fix.version}?` : `Remove ${confirm.fileName}?`}
          confirmLabel={confirm === 'fix' ? 'Delete repair' : 'Remove'}
          busy={busy}
          message={
            confirm === 'fix'
              ? `"${fix.title}" and its ${fix.files.length} file${fix.files.length === 1 ? '' : 's'} are removed for good. The number v${fix.version} is not used again.`
              : 'The file is removed from this repair for good.'
          }
          onCancel={() => setConfirm(null)}
          onConfirm={remove}
        />
      ) : null}
    </li>
  );
}

type Upload = { name: string; percent: number; error?: string; done?: boolean };

/** Sends files one at a time, so each has its own progress and one failure does not stop the rest. */
async function uploadAll(
  machineId: string,
  fixId: string,
  files: File[],
  onChange: (uploads: Upload[]) => void,
): Promise<boolean> {
  const uploads: Upload[] = files.map((f) => ({ name: f.name, percent: 0 }));
  onChange([...uploads]);
  let allOk = true;
  for (const [i, file] of files.entries()) {
    const result = await uploadFixFile(machineId, fixId, file, (percent) => {
      uploads[i] = { ...uploads[i], percent };
      onChange([...uploads]);
    });
    uploads[i] = result.ok ? { ...uploads[i], percent: 100, done: true } : { ...uploads[i], error: result.error };
    if (!result.ok) allOk = false;
    onChange([...uploads]);
  }
  return allOk;
}

function UploadList({ uploads }: { uploads: Upload[] }) {
  if (uploads.length === 0) return null;
  return (
    <ul className="upload-list">
      {uploads.map((u, i) => (
        <li key={`${u.name}-${i}`}>
          <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
            <span className="history-file-name">{u.name}</span>
            <span className={u.error ? 'err' : 'muted'} style={{ fontSize: 12 }}>
              {u.error ?? (u.done ? 'Done' : `${u.percent}%`)}
            </span>
          </div>
          <div className="progress">
            <div className="progress-fill" style={{ width: `${u.error ? 100 : u.percent}%`, background: u.error ? 'var(--bad)' : undefined }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function FilePicker({ files, onChange }: { files: File[]; onChange: (files: File[]) => void }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div>
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => input.current?.click()}>
        Choose videos, photos or files…
      </button>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        accept={ACCEPT}
        onChange={(e) => {
          onChange([...files, ...Array.from(e.target.files ?? [])]);
          e.target.value = '';
        }}
      />
      {files.length > 0 ? (
        <ul className="picked-files">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`}>
              <span className="history-file-name">{f.name}</span>
              <span className="muted"> · {formatBytes(f.size)}</span>
              <button type="button" className="history-file-x" onClick={() => onChange(files.filter((_, j) => j !== i))}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** Logging a new repair (with its files), or correcting the write-up of one. */
function FixDialog({
  machineId,
  fix,
  nextVersion,
  onClose,
}: {
  machineId: string;
  fix?: FixRow;
  nextVersion?: number;
  onClose: () => void;
}) {
  const router = useRouter();
  const [form, setForm] = useState({
    title: fix?.title ?? '',
    symptom: fix?.symptom ?? '',
    description: fix?.description ?? '',
    fixedByName: fix?.fixedByName ?? '',
    fixedAt: toDateInputValue(fix?.fixedAt ?? new Date().toISOString()),
    statusAfter: (fix?.statusAfter ?? '') as MachineStatus | '',
  });
  const [files, setFiles] = useState<File[]>([]);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});

  const set = (key: keyof typeof form, value: string) => setForm((f) => ({ ...f, [key]: value }));

  async function save() {
    setBusy(true);
    setError('');
    setFields({});
    const result = await api<{ fix: { id: string } }>(
      fix ? `/api/machines/${machineId}/fixes/${fix.id}` : `/api/machines/${machineId}/fixes`,
      { method: fix ? 'PATCH' : 'POST', json: { ...form, statusAfter: form.statusAfter || null } },
    );
    if (!result.ok) {
      setBusy(false);
      setError(result.error);
      setFields(result.fields ?? {});
      return;
    }
    // The record is saved before any file goes up: a dropped connection on a
    // big video loses that video, never the write-up.
    const fixId = fix?.id ?? result.data.fix.id;
    const allOk = files.length === 0 || (await uploadAll(machineId, fixId, files, setUploads));
    setBusy(false);
    router.refresh();
    if (allOk) onClose();
    else setError('The repair is saved, but some files did not upload. Close this and use "Add files" to try them again.');
  }

  return (
    <Modal
      title={fix ? `Edit v${fix.version}` : `Log a repair - v${nextVersion}`}
      onClose={busy ? () => {} : onClose}
      wide
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
            {uploads.length > 0 && !busy ? 'Close' : 'Cancel'}
          </button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={busy || uploads.length > 0}>
            {busy ? (uploads.length > 0 ? 'Uploading…' : 'Saving…') : fix ? 'Save' : 'Save repair'}
          </button>
        </>
      }
    >
      {error ? <Alert>{error}</Alert> : null}
      <Field label="What was fixed" htmlFor="f-title" error={fields.title} hint="A short title, e.g. Replaced heater band on barrel zone 2.">
        <input id="f-title" type="text" value={form.title} autoFocus onChange={(e) => set('title', e.target.value)} />
      </Field>
      <Field label="What was wrong" htmlFor="f-symptom" error={fields.symptom} hint="The fault as it showed up. Optional.">
        <textarea id="f-symptom" rows={2} value={form.symptom} onChange={(e) => set('symptom', e.target.value)} />
      </Field>
      <Field label="What was done" htmlFor="f-desc" error={fields.description} hint="Steps, parts used, settings changed - what the next person needs.">
        <textarea id="f-desc" rows={5} value={form.description} onChange={(e) => set('description', e.target.value)} />
      </Field>
      <div className="field-row field-row-auto">
        <Field label="Fixed by" htmlFor="f-by" error={fields.fixedByName}>
          <input id="f-by" type="text" value={form.fixedByName} onChange={(e) => set('fixedByName', e.target.value)} />
        </Field>
        <Field label="Date" htmlFor="f-date" error={fields.fixedAt}>
          <input id="f-date" type="date" value={form.fixedAt} onChange={(e) => set('fixedAt', e.target.value)} />
        </Field>
        <Field label="Machine left" htmlFor="f-status" error={fields.statusAfter}>
          <select id="f-status" value={form.statusAfter} onChange={(e) => set('statusAfter', e.target.value)}>
            <option value="">{fix ? 'Not recorded' : 'No change'}</option>
            {MACHINE_STATUS_ORDER.map((s) => (
              <option key={s} value={s}>
                {MACHINE_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {fix ? null : (
        <Field label="Videos, photos and files">
          {uploads.length > 0 ? <UploadList uploads={uploads} /> : <FilePicker files={files} onChange={setFiles} />}
        </Field>
      )}
    </Modal>
  );
}

function AddFilesDialog({ machineId, fix, onClose }: { machineId: string; fix: FixRow; onClose: () => void }) {
  const router = useRouter();
  const [files, setFiles] = useState<File[]>([]);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function upload() {
    setBusy(true);
    setError('');
    const allOk = await uploadAll(machineId, fix.id, files, setUploads);
    setBusy(false);
    router.refresh();
    if (allOk) onClose();
    else setError('Some files did not upload - see below.');
  }

  return (
    <Modal
      title={`Add files to v${fix.version}`}
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
            {uploads.length > 0 && !busy ? 'Close' : 'Cancel'}
          </button>
          <button type="button" className="btn btn-primary" onClick={upload} disabled={busy || files.length === 0 || uploads.length > 0}>
            {busy ? 'Uploading…' : 'Upload'}
          </button>
        </>
      }
    >
      {error ? <Alert>{error}</Alert> : null}
      {uploads.length > 0 ? <UploadList uploads={uploads} /> : <FilePicker files={files} onChange={setFiles} />}
    </Modal>
  );
}
