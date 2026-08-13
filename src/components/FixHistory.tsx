'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, uploadVideo } from '@/lib/client';
import { formatDate, formatBytes, toDateInputValue } from '@/lib/format';
import { Field, Alert, Modal, ConfirmDialog, EmptyState } from '@/components/ui';

export type FixRow = {
  id: string;
  title: string;
  description: string;
  symptom: string | null;
  fixedByName: string;
  fixedAt: string;
  recordedByName: string;
  videoUrl: string | null;
  videoOriginalName: string | null;
  videoSizeBytes: number | null;
};

type FormState = {
  title: string;
  description: string;
  symptom: string;
  fixedByName: string;
  fixedAt: string;
};

function blankForm(): FormState {
  return {
    title: '',
    description: '',
    symptom: '',
    fixedByName: '',
    fixedAt: toDateInputValue(new Date()),
  };
}

/**
 * Repair history for one machine.
 *
 * The point of the module: when the same machine fails the same way again,
 * whoever is standing in front of it can watch how it was fixed last time
 * instead of working it out from scratch.
 */
export function FixHistory({
  assetId,
  assetName,
  fixes,
  videoLinksArePublic,
}: {
  assetId: string;
  assetName: string;
  fixes: FixRow[];
  videoLinksArePublic: boolean;
}) {
  const router = useRouter();

  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<FormState>(blankForm());
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);

  const [deleting, setDeleting] = useState<FixRow | null>(null);
  const [deleteError, setDeleteError] = useState('');
  const [copied, setCopied] = useState<string | null>(null);

  // Attaching a video to a fix that already exists - either because it was
  // logged without one, or because the upload failed the first time.
  const attachInputRef = useRef<HTMLInputElement>(null);
  const [attachTarget, setAttachTarget] = useState<FixRow | null>(null);
  const [attachProgress, setAttachProgress] = useState<number | null>(null);
  const [attachError, setAttachError] = useState('');

  function pickVideoFor(fix: FixRow) {
    setAttachError('');
    setAttachTarget(fix);
    // Reset so choosing the same file twice still fires onChange.
    if (attachInputRef.current) attachInputRef.current.value = '';
    attachInputRef.current?.click();
  }

  async function onAttachFileChosen(event: React.ChangeEvent<HTMLInputElement>) {
    const chosen = event.target.files?.[0];
    const target = attachTarget;
    if (!chosen || !target) return;

    setAttachProgress(0);
    const result = await uploadVideo(target.id, chosen, setAttachProgress);
    setAttachProgress(null);
    setAttachTarget(null);

    if (!result.ok) {
      setAttachError(`${target.title}: ${result.error}`);
      return;
    }

    router.refresh();
  }

  function open() {
    setForm(blankForm());
    setFile(null);
    setError('');
    setFields({});
    setProgress(null);
    setAdding(true);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setFields({});

    // Step 1: create the record. Step 2: stream the video to it. Split so a
    // large upload never blocks the text being saved - if the upload fails, the
    // write-up survives and the video can be attached later.
    const created = await api<{ fix: { id: string } }>(`/api/assets/${assetId}/fixes`, {
      method: 'POST',
      json: form,
    });

    if (!created.ok) {
      setError(created.error);
      setFields(created.fields ?? {});
      setBusy(false);
      return;
    }

    if (file) {
      setProgress(0);
      const uploaded = await uploadVideo(created.data.fix.id, file, setProgress);

      if (!uploaded.ok) {
        setBusy(false);
        setProgress(null);
        setError(
          `${uploaded.error} The written record was saved - use “Add video” on it in the list below to try the upload again.`,
        );
        router.refresh();
        return;
      }
    }

    setBusy(false);
    setProgress(null);
    setAdding(false);
    router.refresh();
  }

  async function confirmDelete() {
    if (!deleting) return;
    setBusy(true);
    setDeleteError('');

    const result = await api(`/api/fixes/${deleting.id}`, { method: 'DELETE' });
    setBusy(false);

    if (!result.ok) {
      setDeleteError(result.error);
      return;
    }

    setDeleting(null);
    router.refresh();
  }

  async function copyLink(url: string, id: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(id);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      // Clipboard access needs a secure context; over plain-HTTP LAN it can be
      // blocked. Fall back to letting the user copy it by hand.
      window.prompt('Copy this link:', url);
    }
  }

  return (
    <>
      {/* One shared input, driven by whichever fix's button was pressed. */}
      <input
        ref={attachInputRef}
        type="file"
        accept="video/*"
        onChange={onAttachFileChosen}
        style={{ display: 'none' }}
      />

      <div className="card">
        <div className="card-head">
          <div>
            <h2>Repair history</h2>
            <p className="muted" style={{ margin: '3px 0 0', fontSize: 12.5 }}>
              Past fixes for this machine, newest first. Attach a video so the next person can
              follow what was done.
            </p>
          </div>
          <button type="button" className="btn btn-primary btn-sm" onClick={open}>
            Log a repair
          </button>
        </div>

        {attachError ? (
          <div style={{ padding: '14px 18px 0' }}>
            <Alert>{attachError}</Alert>
          </div>
        ) : null}

        {!videoLinksArePublic && fixes.some((f) => f.videoUrl) ? (
          <div style={{ padding: '14px 18px 0' }}>
            <Alert kind="warn">
              Video links currently point at the office network address, so they will not open from
              outside the building. Set <code>PUBLIC_VIDEO_BASE_URL</code> once the Cloudflare Tunnel
              is running.
            </Alert>
          </div>
        ) : null}

        {fixes.length === 0 ? (
          <EmptyState
            title="No repairs logged yet"
            message={`Nothing has been recorded for ${assetName}. Log the next repair so it is not relearned from scratch.`}
            action={
              <button type="button" className="btn btn-primary" onClick={open}>
                Log a repair
              </button>
            }
          />
        ) : (
          <div className="card-body stack">
            {fixes.map((fix) => (
              <div
                key={fix.id}
                style={{
                  border: '1px solid var(--rule)',
                  borderRadius: 'var(--radius)',
                  padding: 16,
                }}
              >
                <div className="row" style={{ justifyContent: 'space-between', gap: 12 }}>
                  <div>
                    <h3>{fix.title}</h3>
                    <div className="cell-sub">
                      Fixed by <strong>{fix.fixedByName}</strong> on {formatDate(fix.fixedAt)} ·
                      logged by {fix.recordedByName}
                    </div>
                  </div>
                  <div className="row" style={{ gap: 6 }}>
                    {fix.videoUrl ? (
                      <>
                        <a
                          href={fix.videoUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="btn btn-secondary btn-sm"
                        >
                          Watch video
                        </a>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => copyLink(fix.videoUrl!, fix.id)}
                        >
                          {copied === fix.id ? 'Copied' : 'Copy link'}
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => pickVideoFor(fix)}
                          disabled={attachProgress !== null}
                        >
                          Replace
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => pickVideoFor(fix)}
                        disabled={attachProgress !== null}
                      >
                        {attachProgress !== null && attachTarget?.id === fix.id
                          ? `Uploading ${attachProgress}%`
                          : 'Add video'}
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn btn-danger btn-sm"
                      onClick={() => {
                        setDeleteError('');
                        setDeleting(fix);
                      }}
                    >
                      Remove
                    </button>
                  </div>
                </div>

                {fix.symptom ? (
                  <p style={{ margin: '12px 0 0', fontSize: 13 }}>
                    <span className="section-label" style={{ display: 'inline', marginRight: 6 }}>
                      Symptom
                    </span>
                    {fix.symptom}
                  </p>
                ) : null}

                <p style={{ margin: '10px 0 0', whiteSpace: 'pre-wrap', fontSize: 13.5 }}>
                  {fix.description}
                </p>

                {fix.videoOriginalName ? (
                  <div className="cell-sub" style={{ marginTop: 10 }}>
                    {fix.videoOriginalName} · {formatBytes(fix.videoSizeBytes)}
                  </div>
                ) : null}

                {attachProgress !== null && attachTarget?.id === fix.id ? (
                  <div className="progress">
                    <div className="progress-fill" style={{ width: `${attachProgress}%` }} />
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>

      {adding ? (
        <Modal
          wide
          title={`Log a repair - ${assetName}`}
          onClose={() => (busy ? null : setAdding(false))}
          footer={
            <>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setAdding(false)}
                disabled={busy}
              >
                Cancel
              </button>
              <button type="submit" form="fix-form" className="btn btn-primary" disabled={busy}>
                {progress !== null
                  ? `Uploading ${progress}%`
                  : busy
                    ? 'Saving…'
                    : 'Save repair'}
              </button>
            </>
          }
        >
          <form id="fix-form" onSubmit={submit} noValidate>
            {error ? <Alert>{error}</Alert> : null}

            <Field
              label="What was fixed"
              htmlFor="fix-title"
              error={fields.title}
              hint="A short title someone would recognise later, e.g. “Replaced wire feed motor”."
            >
              <input
                id="fix-title"
                type="text"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                autoFocus
                required
              />
            </Field>

            <Field
              label="Symptom"
              htmlFor="fix-symptom"
              error={fields.symptom}
              hint="Optional. What went wrong - this is what someone will search for next time."
            >
              <input
                id="fix-symptom"
                type="text"
                value={form.symptom}
                onChange={(e) => setForm({ ...form, symptom: e.target.value })}
              />
            </Field>

            <Field
              label="What was done"
              htmlFor="fix-description"
              error={fields.description}
              hint="Enough detail that the next person can follow it without asking."
            >
              <textarea
                id="fix-description"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                rows={5}
                required
              />
            </Field>

            <div className="field-row">
              <Field label="Fixed by" htmlFor="fix-by" error={fields.fixedByName}>
                <input
                  id="fix-by"
                  type="text"
                  value={form.fixedByName}
                  onChange={(e) => setForm({ ...form, fixedByName: e.target.value })}
                  placeholder="Name of whoever did the repair"
                  required
                />
              </Field>

              <Field label="Date of repair" htmlFor="fix-date" error={fields.fixedAt}>
                <input
                  id="fix-date"
                  type="date"
                  value={form.fixedAt}
                  onChange={(e) => setForm({ ...form, fixedAt: e.target.value })}
                />
              </Field>
            </div>

            <Field
              label="Repair video"
              htmlFor="fix-video"
              hint="Optional. MP4, MOV, MKV, WEBM or AVI. Stored on the office PC and shareable by link."
            >
              <input
                id="fix-video"
                type="file"
                accept="video/*"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                disabled={busy}
              />
            </Field>

            {file ? (
              <div className="cell-sub">
                {file.name} · {formatBytes(file.size)}
              </div>
            ) : null}

            {progress !== null ? (
              <div className="progress">
                <div className="progress-fill" style={{ width: `${progress}%` }} />
              </div>
            ) : null}
          </form>
        </Modal>
      ) : null}

      {deleting ? (
        <ConfirmDialog
          title="Remove this repair record?"
          confirmLabel="Remove record"
          busy={busy}
          error={deleteError}
          message={
            <>
              This removes <strong>{deleting.title}</strong>
              {deleting.videoUrl ? ' and permanently deletes the uploaded video' : ''}. Any links
              already shared will stop working.
            </>
          }
          onCancel={() => setDeleting(null)}
          onConfirm={confirmDelete}
        />
      ) : null}
    </>
  );
}
