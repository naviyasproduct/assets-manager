'use client';

import { useState } from 'react';
import type { AssetStatus } from '@prisma/client';
import { downloadReport } from '@/lib/client';
import { ASSET_STATUS_LABELS, ASSET_STATUS_ORDER } from '@/lib/format';
import { Field, Alert } from '@/components/ui';
import type { DepartmentOption } from '@/components/AssetManager';

export function ReportBuilder({
  departments,
  isAdmin,
  initialDepartmentId,
  videoLinksArePublic,
}: {
  departments: DepartmentOption[];
  isAdmin: boolean;
  initialDepartmentId: string;
  videoLinksArePublic: boolean;
}) {
  const [departmentId, setDepartmentId] = useState(initialDepartmentId);
  const [includeAssets, setIncludeAssets] = useState(true);
  const [includePurchases, setIncludePurchases] = useState(true);
  const [includeFixes, setIncludeFixes] = useState(true);
  const [statuses, setStatuses] = useState<AssetStatus[]>([]);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  function toggleStatus(status: AssetStatus) {
    setStatuses((current) =>
      current.includes(status) ? current.filter((s) => s !== status) : [...current, status],
    );
  }

  async function generate() {
    setBusy(true);
    setError('');
    setDone(false);

    const result = await downloadReport({
      departmentId,
      includeAssets,
      includePurchases,
      includeFixes,
      // An empty list means "no filter"; sending [] would be ambiguous.
      ...(statuses.length > 0 ? { statuses } : {}),
    });

    setBusy(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    setDone(true);
    setTimeout(() => setDone(false), 5000);
  }

  return (
    <div className="grid grid-2">
      <div className="card">
        <div className="card-head">
          <h2>Report options</h2>
        </div>
        <div className="card-body">
          {error ? <Alert>{error}</Alert> : null}
          {done ? <Alert kind="ok">Report generated and downloaded.</Alert> : null}

          <Field
            label="Scope"
            htmlFor="report-scope"
            hint={
              isAdmin
                ? 'The company-wide report opens with a roll-up, then one section per department.'
                : 'You can generate reports for your own department.'
            }
          >
            <select
              id="report-scope"
              value={departmentId}
              onChange={(e) => setDepartmentId(e.target.value)}
            >
              {isAdmin ? <option value="ALL">All departments (company-wide)</option> : null}
              {departments.map((department) => (
                <option key={department.id} value={department.id}>
                  {department.name}
                </option>
              ))}
            </select>
          </Field>

          <div className="divider" />

          <div className="section-label">Sections to include</div>

          <label className="checkbox" style={{ marginBottom: 10 }}>
            <input
              type="checkbox"
              checked={includeAssets}
              onChange={(e) => setIncludeAssets(e.target.checked)}
            />
            Asset list with status
          </label>

          <label className="checkbox" style={{ marginBottom: 10 }}>
            <input
              type="checkbox"
              checked={includePurchases}
              onChange={(e) => setIncludePurchases(e.target.checked)}
            />
            Flagged purchase needs
          </label>

          <label className="checkbox" style={{ marginBottom: 10 }}>
            <input
              type="checkbox"
              checked={includeFixes}
              onChange={(e) => setIncludeFixes(e.target.checked)}
            />
            Repair history with video links
          </label>

          <div className="divider" />

          <div className="section-label">Limit assets to</div>
          <p className="muted" style={{ fontSize: 12.5, margin: '0 0 10px' }}>
            Leave all unticked to include every asset.
          </p>

          {ASSET_STATUS_ORDER.map((status) => (
            <label key={status} className="checkbox" style={{ marginBottom: 8 }}>
              <input
                type="checkbox"
                checked={statuses.includes(status)}
                onChange={() => toggleStatus(status)}
              />
              {ASSET_STATUS_LABELS[status]}
            </label>
          ))}

          <button
            type="button"
            className="btn btn-primary"
            onClick={generate}
            disabled={busy || !departmentId}
            style={{ width: '100%', marginTop: 18 }}
          >
            {busy ? 'Generating PDF…' : 'Generate PDF'}
          </button>

          {busy ? (
            <p className="muted" style={{ fontSize: 12.5, marginTop: 10, textAlign: 'center' }}>
              This takes a few seconds - the document is rendered page by page.
            </p>
          ) : null}
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>What the report contains</h2>
        </div>
        <div className="card-body">
          <ol style={{ margin: 0, paddingLeft: 20, fontSize: 13.5, lineHeight: 1.8 }}>
            <li>
              <strong>Executive summary</strong> - asset counts, how many need attention, pending
              spend, and a condition breakdown.
            </li>
            {isAdmin ? (
              <li>
                <strong>Equipment requiring a decision</strong> - everything broken or flagged for
                replacement, across all departments, most severe first.
              </li>
            ) : null}
            <li>
              <strong>Per department</strong> - condition summary, the full asset list, and the
              purchase needs flagged for that department.
            </li>
            <li>
              <strong>Repair history</strong> - past fixes with clickable links to the videos.
            </li>
          </ol>

          <div className="divider" />

          {videoLinksArePublic ? (
            <Alert kind="info">
              Video links in the PDF use the public tunnel address, so the CEO can open them from
              outside the office.
            </Alert>
          ) : (
            <Alert kind="warn">
              No public video address is configured yet, so video links will only open from inside
              the office network. Set <code>PUBLIC_VIDEO_BASE_URL</code> once the Cloudflare Tunnel
              is running.
            </Alert>
          )}

          <p className="muted" style={{ fontSize: 12.5, marginBottom: 0 }}>
            Rejected purchase requests are left out on purpose - the report is for deciding what to
            buy next, not reviewing what was already turned down.
          </p>
        </div>
      </div>
    </div>
  );
}
