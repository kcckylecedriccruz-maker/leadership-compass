import { useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Info, Loader2, Upload, XCircle } from 'lucide-react';
import writeXlsxFile from 'write-excel-file/browser';
import { Modal } from '@/components/Modal';
import { Notice } from '@/components/Notice';
import {
  MAX_UPLOAD_ROWS,
  accountRows,
  downloadProblemRows,
  downloadTemplate,
  isReady,
  linkRows,
  parseUpload,
  type KnownPerson,
  type ParsedRow,
} from '@/features/users/bulkUpload';
import { bulkCreateUsers, bulkLinkPeople, type BulkRowResult } from '@/features/users/userControl';

const BATCH_SIZE = 25;

type Preview = { file: File; rows: ParsedRow[]; ignoredColumns: string[] };

type Stage =
  | { kind: 'choose' }
  | { kind: 'preview' }
  | { kind: 'uploading'; phase: 'Creating accounts' | 'Adding reporting lines'; done: number; total: number }
  | { kind: 'done'; results: BulkRowResult[] };

export function BulkUploadDialog({
  known,
  groupNames,
  canCreateAdmins,
  canLink,
  onClose,
  onFinished,
}: {
  known: Map<string, KnownPerson>;
  groupNames: string[];
  canCreateAdmins: boolean;
  /** Edit access to Talents and Assignments, needed for reporting lines. */
  canLink: boolean;
  onClose: () => void;
  onFinished: (summary: string) => void;
}) {
  const [stage, setStage] = useState<Stage>({ kind: 'choose' });
  const [preview, setPreview] = useState<Preview | null>(null);
  const [updateExisting, setUpdateExisting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  async function handleTemplate() {
    setDownloading(true);
    try {
      await downloadTemplate(groupNames);
    } catch (cause) {
      console.error('Template download failed', cause);
      setError('The template could not be created. Please try again.');
    } finally {
      setDownloading(false);
    }
  }

  async function check(file: File, update: boolean) {
    setError(null);
    const result = await parseUpload(file, { known, canCreateAdmins, updateExisting: update });
    if (fileInput.current) fileInput.current.value = '';
    if (!result.ok) {
      setError(result.message);
      setStage({ kind: 'choose' });
      return;
    }
    setPreview({ file, rows: result.rows, ignoredColumns: result.ignoredColumns });
    setStage({ kind: 'preview' });
  }

  async function runInBatches<T>(
    items: T[],
    phase: 'Creating accounts' | 'Adding reporting lines',
    send: (batch: T[]) => ReturnType<typeof bulkCreateUsers>,
    onFailure: (batch: T[], message: string) => BulkRowResult[],
  ): Promise<BulkRowResult[]> {
    const results: BulkRowResult[] = [];
    setStage({ kind: 'uploading', phase, done: 0, total: items.length });
    for (let start = 0; start < items.length; start += BATCH_SIZE) {
      const batch = items.slice(start, start + BATCH_SIZE);
      const response = await send(batch);
      results.push(...(response.ok ? response.data.results : onFailure(batch, response.message)));
      setStage({ kind: 'uploading', phase, done: Math.min(start + BATCH_SIZE, items.length), total: items.length });
    }
    return results;
  }

  async function handleUpload(rows: ParsedRow[]) {
    const skipped: BulkRowResult[] = rows
      .filter((r) => r.skipReason && r.errors.length === 0)
      .map((r) => ({ row: r.row, email: r.email, status: 'skipped', message: r.skipReason ?? '' }));

    // Phase 1: every account first, so people can refer to each other anywhere in the file.
    const accounts = accountRows(rows);
    const created = await runInBatches(accounts, 'Creating accounts', bulkCreateUsers, (batch, message) =>
      batch.map((r) => ({ row: r.row, email: r.email, status: 'failed' as const, message })),
    );
    const succeeded = new Set(created.filter((r) => r.status !== 'failed').map((r) => r.email));

    // Phase 2: reporting lines and peers for everyone.
    const links = canLink ? linkRows(rows, succeeded) : [];
    const linked = links.length
      ? await runInBatches(links, 'Adding reporting lines', bulkLinkPeople, (batch, message) =>
          batch.map((r) => ({ row: r.row, email: r.email, status: 'failed' as const, message: `Reporting lines: ${message}` })),
        )
      : [];

    // One line per row: the account result, with the reporting-line result added to it.
    const byRow = new Map<number, BulkRowResult>();
    for (const r of [...skipped, ...created]) byRow.set(r.row, r);
    for (const link of linked) {
      const base = byRow.get(link.row);
      if (!base) byRow.set(link.row, link);
      else {
        base.message = `${base.message} ${link.message}`;
        if (link.status === 'failed') base.status = 'failed';
        else if (base.status === 'skipped' && link.status === 'linked') base.status = 'linked';
      }
    }
    setStage({ kind: 'done', results: [...byRow.values()].sort((a, b) => a.row - b.row) });
  }

  async function downloadResults(results: BulkRowResult[]) {
    const header = ['Row', 'Email', 'Result', 'Details'].map((value) => ({
      value,
      fontWeight: 'bold' as const,
      textColor: '#FFFFFF',
      backgroundColor: '#005B99',
    }));
    await writeXlsxFile([header, ...results.map((r) => [r.row, r.email, r.status, r.message])], {
      sheet: 'Results',
      columns: [{ width: 8 }, { width: 34 }, { width: 12 }, { width: 90 }],
      stickyRowsCount: 1,
    }).toFile('bulk-upload-results.xlsx');
  }

  function close() {
    if (stage.kind === 'done') {
      const count = (status: string) => stage.results.filter((r) => r.status === status).length;
      onFinished(`Bulk upload finished: ${count('created')} added, ${count('updated')} updated, ${count('failed')} failed.`);
    } else if (stage.kind !== 'uploading') {
      onClose();
    }
  }

  return (
    <Modal
      title="Bulk upload users"
      description="Add many people at once from Excel, with their department, position and reporting lines."
      onClose={close}
      size="wide"
    >
      <div className="space-y-6">
        {stage.kind === 'choose' && (
          <>
            <ol className="grid gap-3 sm:grid-cols-2">
              <li className="space-y-3 rounded-2xl border border-line p-4">
                <p className="eyebrow">Step 1</p>
                <p className="text-sm font-semibold">Download the template</p>
                <p className="text-xs text-ink-muted">
                  Full name, Email, Role, Department, Position, Immediate manager, Direct reports, Peers, Groups and Send
                  invite. Cells turn red in Excel when something looks wrong.
                </p>
                <button type="button" className="btn-secondary" onClick={() => void handleTemplate()} disabled={downloading}>
                  {downloading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Download className="h-4 w-4" aria-hidden="true" />}
                  Download template (.xlsx)
                </button>
              </li>
              <li className="space-y-3 rounded-2xl border border-line p-4">
                <p className="eyebrow">Step 2</p>
                <p className="text-sm font-semibold">Upload the filled-in file</p>
                <p className="text-xs text-ink-muted">
                  Up to {MAX_UPLOAD_ROWS} people. Every row is checked and shown to you before anything is created.
                </p>
                <label className="flex items-start gap-2 text-xs">
                  <input
                    type="checkbox"
                    className="mt-0.5 accent-primary"
                    checked={updateExisting}
                    onChange={(event) => setUpdateExisting(event.target.checked)}
                  />
                  <span>
                    <span className="font-semibold">Update people who already have an account</span>
                    <span className="block text-ink-muted">Name, department, position, groups and reporting lines. Roles are never changed.</span>
                  </span>
                </label>
                <label className="btn-primary cursor-pointer">
                  <Upload className="h-4 w-4" aria-hidden="true" />
                  Choose Excel file
                  <input
                    ref={fileInput}
                    type="file"
                    accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    className="sr-only"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) void check(file, updateExisting);
                    }}
                  />
                </label>
              </li>
            </ol>
            {!canLink && (
              <Notice tone="info">
                You do not have edit access to Talents and Assignments, so managers, direct reports and peers in the file will be
                ignored. Accounts, departments, positions and groups are still uploaded.
              </Notice>
            )}
            {error && <Notice>{error}</Notice>}
          </>
        )}

        {stage.kind === 'preview' && preview && (
          <PreviewTable
            preview={preview}
            updateExisting={updateExisting}
            onToggleUpdate={(next) => {
              setUpdateExisting(next);
              void check(preview.file, next);
            }}
            onBack={() => setStage({ kind: 'choose' })}
            onUpload={() => void handleUpload(preview.rows)}
          />
        )}

        {stage.kind === 'uploading' && (
          <div className="space-y-3 py-6" role="status">
            <p className="flex items-center gap-2 text-sm font-semibold">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              {stage.phase}… {stage.done} of {stage.total}
            </p>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-primary transition-all"
                style={{ width: `${stage.total === 0 ? 100 : Math.round((stage.done / stage.total) * 100)}%` }}
              />
            </div>
            <p className="text-xs text-ink-muted">Keep this window open until it finishes.</p>
          </div>
        )}

        {stage.kind === 'done' && <Results results={stage.results} onDownload={() => void downloadResults(stage.results)} onClose={close} />}
      </div>
    </Modal>
  );
}

function lines(r: ParsedRow): string {
  const parts = [
    r.manager ? `Manager: ${r.manager}` : null,
    r.directReports.length ? `${r.directReports.length} direct report${r.directReports.length === 1 ? '' : 's'}` : null,
    r.peers.length ? `${r.peers.length} peer${r.peers.length === 1 ? '' : 's'}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : '—';
}

function PreviewTable({
  preview,
  updateExisting,
  onToggleUpdate,
  onBack,
  onUpload,
}: {
  preview: Preview;
  updateExisting: boolean;
  onToggleUpdate: (next: boolean) => void;
  onBack: () => void;
  onUpload: () => void;
}) {
  const { rows } = preview;
  const ready = rows.filter(isReady);
  const newCount = ready.filter((r) => !r.existing).length;
  const updateCount = ready.length - newCount;
  const withErrors = rows.filter((r) => r.errors.length > 0).length;
  const skipped = rows.filter((r) => r.errors.length === 0 && r.skipReason).length;
  const withWarnings = ready.filter((r) => r.warnings.length > 0).length;
  const existingCount = rows.filter((r) => r.existing).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <span className="flex items-center gap-2 font-semibold">
          <FileSpreadsheet className="h-4 w-4 text-primary" aria-hidden="true" />
          {preview.file.name}
        </span>
        <span className="text-band-strength">{newCount} new</span>
        {updateCount > 0 && <span className="text-primary">{updateCount} to update</span>}
        {withErrors > 0 && <span className="text-danger">{withErrors} with problems</span>}
        {skipped > 0 && <span className="text-ink-muted">{skipped} skipped</span>}
        {withWarnings > 0 && <span className="text-band-developing">{withWarnings} with notes</span>}
      </div>

      {existingCount > 0 && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="accent-primary" checked={updateExisting} onChange={(event) => onToggleUpdate(event.target.checked)} />
          Update the {existingCount} {existingCount === 1 ? 'person who already has' : 'people who already have'} an account
        </label>
      )}

      {preview.ignoredColumns.length > 0 && (
        <Notice tone="info">Columns not used: {preview.ignoredColumns.join(', ')}.</Notice>
      )}

      {withErrors > 0 && (
        <div className="flex flex-col gap-3 rounded-2xl bg-danger-soft px-4 py-3 text-sm text-danger sm:flex-row sm:items-center sm:justify-between">
          <span>
            Rows with problems are not uploaded. Fix them and upload again, or continue with the {ready.length} ready{' '}
            {ready.length === 1 ? 'row' : 'rows'}.
          </span>
          <button type="button" className="btn-secondary shrink-0" onClick={() => void downloadProblemRows(rows)}>
            <Download className="h-4 w-4" aria-hidden="true" />
            Download rows with problems
          </button>
        </div>
      )}

      <div className="max-h-[45vh] overflow-auto rounded-2xl border border-line">
        <table className="w-full min-w-[56rem] text-left text-sm">
          <thead className="sticky top-0 z-10 bg-muted text-xs text-ink-muted">
            <tr>
              <th className="px-3 py-2 font-semibold">Row</th>
              <th className="px-3 py-2 font-semibold">Person</th>
              <th className="px-3 py-2 font-semibold">Role</th>
              <th className="px-3 py-2 font-semibold">Department · Position</th>
              <th className="px-3 py-2 font-semibold">Reporting lines</th>
              <th className="px-3 py-2 font-semibold">Groups</th>
              <th className="px-3 py-2 font-semibold">Check</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.row} className={`border-t border-line align-top ${r.errors.length > 0 ? 'bg-danger-soft' : ''}`}>
                <td className="px-3 py-2 tabular-nums text-ink-muted">{r.row}</td>
                <td className="px-3 py-2">
                  <span className="block font-semibold">{r.fullName || '—'}</span>
                  <span className="block break-all text-xs text-ink-muted">{r.email || '—'}</span>
                </td>
                <td className="px-3 py-2">{r.role ?? (r.roleText || '—')}</td>
                <td className="px-3 py-2 text-xs">{[r.department, r.position].filter(Boolean).join(' · ') || '—'}</td>
                <td className="px-3 py-2 text-xs">{lines(r)}</td>
                <td className="px-3 py-2 text-xs">{r.groups.join(', ') || '—'}</td>
                <td className="px-3 py-2 text-xs">
                  {r.errors.length > 0 ? (
                    <span className="flex items-start gap-1.5 text-danger">
                      <XCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                      {r.errors.join(' ')}
                    </span>
                  ) : r.skipReason ? (
                    <span className="flex items-start gap-1.5 text-ink-muted">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                      {r.skipReason}
                    </span>
                  ) : (
                    <span className="space-y-1">
                      <span className="flex items-center gap-1.5 text-band-strength">
                        <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
                        {r.existing ? 'Ready to update' : 'Ready'}
                      </span>
                      {r.warnings.map((w) => (
                        <span key={w} className="flex items-start gap-1.5 text-band-developing">
                          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                          {w}
                        </span>
                      ))}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <button type="button" className="btn-secondary" onClick={onBack}>
          Choose another file
        </button>
        <button type="button" className="btn-primary" onClick={onUpload} disabled={ready.length === 0}>
          <Upload className="h-4 w-4" aria-hidden="true" />
          Upload {ready.length} {ready.length === 1 ? 'person' : 'people'}
        </button>
      </div>
    </div>
  );
}

const TONE: Record<BulkRowResult['status'], string> = {
  created: 'text-band-strength',
  updated: 'text-primary',
  linked: 'text-primary',
  skipped: 'text-ink-muted',
  failed: 'text-danger',
};

function Results({ results, onDownload, onClose }: { results: BulkRowResult[]; onDownload: () => void; onClose: () => void }) {
  const count = (status: BulkRowResult['status']) => results.filter((r) => r.status === status).length;
  const tiles = (['created', 'updated', 'skipped', 'failed'] as const).filter((s) => s !== 'updated' || count('updated') > 0);

  return (
    <div className="space-y-4">
      <dl className={`grid gap-3 ${tiles.length === 4 ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-3'}`}>
        {tiles.map((status) => (
          <div key={status} className="rounded-card border border-line p-4">
            <dt className="text-xs font-semibold capitalize text-ink-muted">{status}</dt>
            <dd className={`mt-1 text-2xl font-semibold tabular-nums ${TONE[status]}`}>{count(status)}</dd>
          </div>
        ))}
      </dl>
      <div className="max-h-[40vh] overflow-auto rounded-2xl border border-line">
        <table className="w-full min-w-[36rem] text-left text-sm">
          <thead className="sticky top-0 bg-muted text-xs text-ink-muted">
            <tr>
              <th className="px-3 py-2 font-semibold">Row</th>
              <th className="px-3 py-2 font-semibold">Email</th>
              <th className="px-3 py-2 font-semibold">Result</th>
            </tr>
          </thead>
          <tbody>
            {results.map((r) => (
              <tr key={`${r.row}-${r.email}`} className="border-t border-line align-top">
                <td className="px-3 py-2 tabular-nums text-ink-muted">{r.row}</td>
                <td className="break-all px-3 py-2">{r.email}</td>
                <td className={`px-3 py-2 ${TONE[r.status]}`}>
                  <span className="font-semibold capitalize">{r.status}</span>
                  <span className="text-ink-muted"> · {r.message}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <button type="button" className="btn-secondary" onClick={onDownload}>
          <Download className="h-4 w-4" aria-hidden="true" />
          Download results
        </button>
        <button type="button" className="btn-primary" onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  );
}
