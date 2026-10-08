'use client';

import { useState } from 'react';
import { api } from '@/lib/client';
import { Alert, Modal } from '@/components/ui';
import type { ImportReport } from '@/lib/asset-import';

/**
 * "Import from Excel" on the Assets screen: hand out the blank sheet, check a
 * filled one, then add it.
 *
 * Choosing a file checks it straight away - nothing is written until the
 * check has passed and the Add button is pressed, and then every row goes in
 * or none does. To correct a sheet, fix it in Excel and choose it again: a
 * browser keeps its own copy of a chosen file and may not see later saves.
 */
export function AssetImport({
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported: (tags: string[]) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<'' | 'check' | 'import'>('');

  async function send(chosen: File, mode: 'check' | 'import') {
    const body = new FormData();
    body.set('file', chosen);
    body.set('mode', mode);
    return api<{ report: ImportReport } & { created: number; tags: string[] }>(
      '/api/assets/import',
      { method: 'POST', body },
    );
  }

  async function choose(chosen: File | null) {
    setFile(chosen);
    setReport(null);
    setError('');
    if (!chosen) return;

    setBusy('check');
    const result = await send(chosen, 'check');
    setBusy('');
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setReport(result.data.report);
  }

  async function add() {
    if (!file) return;
    setBusy('import');
    setError('');
    const result = await send(file, 'import');
    setBusy('');
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onImported(result.data.tags);
  }

  const bad = report?.rows.filter((row) => row.problems.length > 0) ?? [];
  const good = report?.rows.filter((row) => row.problems.length === 0) ?? [];
  const warned = report?.rows.filter((row) => row.warnings.length > 0) ?? [];
  const ready = report !== null && report.problemCount === 0;

  return (
    <Modal
      title="Import assets from Excel"
      onClose={busy ? () => undefined : onClose}
      wide
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={!!busy}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={add}
            disabled={!ready || !!busy}
          >
            {busy === 'import'
              ? 'Adding…'
              : ready
                ? `Add ${good.length} asset${good.length === 1 ? '' : 's'}`
                : 'Add assets'}
          </button>
        </>
      }
    >
      <div className="stack">
        <ol className="import-steps">
          <li>
            <a className="btn btn-secondary btn-sm" href="/api/assets/import" download>
              Download the blank sheet
            </a>{' '}
            <span className="muted">
              Its dropdowns hold today&apos;s departments, categories and locations.
            </span>
          </li>
          <li>Fill in one row per asset on its &quot;Assets&quot; sheet and save it.</li>
          <li>
            {/* A label rather than the bare input, whose own "No file chosen"
                text contradicts the name shown beside it once value is reset. */}
            <label className={`btn btn-primary btn-sm${busy ? ' is-disabled' : ''}`}>
              {file ? 'Choose another sheet' : 'Choose the filled-in sheet'}
              <input
                type="file"
                hidden
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={(e) => {
                  void choose(e.target.files?.[0] ?? null);
                  // Lets the same file be chosen again after fixing it.
                  e.target.value = '';
                }}
                disabled={!!busy}
              />
            </label>
            {file ? <span className="muted"> {file.name}</span> : null}
          </li>
        </ol>

        <p className="muted" style={{ margin: 0 }}>
          Photos are not part of the sheet. Once the assets are in, open each one and add its photo.
        </p>

        {busy === 'check' ? <Alert kind="info">Checking the sheet…</Alert> : null}
        <Alert>{error}</Alert>

        {report && bad.length > 0 ? (
          <>
            <Alert>
              {bad.length} row{bad.length === 1 ? ' needs' : 's need'} correcting before anything can
              be added. Fix {bad.length === 1 ? 'it' : 'them'} in Excel, save, and choose the file
              again.
            </Alert>
            <div className="table-wrap import-table">
              <table className="grid-table">
                <thead>
                  <tr>
                    <th className="num">Row</th>
                    <th>Asset name</th>
                    <th>What is wrong</th>
                  </tr>
                </thead>
                <tbody>
                  {bad.map((row) => (
                    <tr key={row.row}>
                      <td className="num">{row.row}</td>
                      <td>{row.name || <span className="muted">(no name)</span>}</td>
                      <td>
                        {row.problems.map((problem) => (
                          <div key={problem}>{problem}</div>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}

        {ready ? (
          <Alert kind="ok">
            All {good.length} row{good.length === 1 ? ' is' : 's are'} ready.{' '}
            {warned.length > 0
              ? 'Read the warnings below - they do not stop the import - then press Add.'
              : 'Check the list below, then press Add.'}
          </Alert>
        ) : null}

        {report && report.newCategories.length > 0 ? (
          <Alert kind="info">
            <strong>New categories</strong> will be made:{' '}
            {report.newCategories
              .map((c) => `${c.name} in ${c.department} (code ${c.code})`)
              .join(', ')}
            . If one is a misspelling of an existing category, fix it in the sheet.
          </Alert>
        ) : null}

        {report && report.newLocations.length > 0 ? (
          <Alert kind="info">
            <strong>New locations</strong> will be made: {report.newLocations.join(', ')}.
          </Alert>
        ) : null}

        {warned.length > 0 ? (
          <Alert kind="warn">
            {warned.map((row) =>
              row.warnings.map((warning) => (
                <div key={`${row.row}-${warning}`}>
                  Row {row.row}: {warning}
                </div>
              )),
            )}
          </Alert>
        ) : null}

        {report && good.length > 0 ? (
          <>
            <div className="section-label">
              {ready ? 'To be added' : `Rows that are fine (${good.length})`}
            </div>
            <div className="table-wrap import-table">
              <table className="grid-table">
                <thead>
                  <tr>
                    <th className="num">Row</th>
                    <th>Tag</th>
                    <th>Asset name</th>
                    <th className="num">Qty</th>
                    <th>Department</th>
                    <th>Category</th>
                    <th>Location</th>
                  </tr>
                </thead>
                <tbody>
                  {good.map((row) => (
                    <tr key={row.row}>
                      <td className="num">{row.row}</td>
                      <td className="mono nowrap">{row.assetTag}</td>
                      <td>{row.name}</td>
                      <td className="num">{row.quantity}</td>
                      <td>{row.department}</td>
                      <td>{row.category}</td>
                      <td>{row.location || <span className="muted">-</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </div>
    </Modal>
  );
}
