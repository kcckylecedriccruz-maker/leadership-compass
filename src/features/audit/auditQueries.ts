import { supabase } from '@/lib/supabase';

export type AuditSource = 'app' | 'data_change' | 'auth';

export type AuditEntry = {
  id: string;
  created_at: string;
  action: string;
  entity: string;
  entity_id: string | null;
  actor_id: string | null;
  actor_email: string | null;
  source: AuditSource;
  details: Record<string, unknown>;
};

export type AuditFilters = {
  search: string;
  source: AuditSource | 'all';
  entity: string;
  from: string; // yyyy-mm-dd, inclusive
  to: string; // yyyy-mm-dd, inclusive
};

export const EMPTY_FILTERS: AuditFilters = { search: '', source: 'all', entity: 'all', from: '', to: '' };

export const PAGE_SIZE = 50;

type Row = Record<string, unknown>;

function toEntry(row: Row): AuditEntry {
  const source = row.source === 'data_change' || row.source === 'auth' ? row.source : 'app';
  const details = typeof row.details === 'object' && row.details !== null && !Array.isArray(row.details) ? (row.details as Record<string, unknown>) : {};
  return {
    id: String(row.id),
    created_at: String(row.created_at),
    action: String(row.action ?? ''),
    entity: String(row.entity ?? ''),
    entity_id: typeof row.entity_id === 'string' ? row.entity_id : null,
    actor_id: typeof row.actor_id === 'string' ? row.actor_id : null,
    actor_email: typeof row.actor_email === 'string' ? row.actor_email : null,
    source,
    details,
  };
}

// PostgREST "or" filters use commas and parentheses as syntax; strip them from free text.
function safeTerm(value: string): string {
  return value.replace(/[,()*%\\]/g, ' ').trim();
}

function endOfDay(date: string): string {
  const next = new Date(`${date}T00:00:00`);
  next.setDate(next.getDate() + 1);
  return next.toISOString();
}

export async function loadAuditPage(filters: AuditFilters, page: number, pageSize = PAGE_SIZE) {
  let query = supabase.from('audit_log').select('*', { count: 'exact' }).order('created_at', { ascending: false });

  if (filters.source !== 'all') query = query.eq('source', filters.source);
  if (filters.entity !== 'all') query = query.eq('entity', filters.entity);
  if (filters.from) query = query.gte('created_at', new Date(`${filters.from}T00:00:00`).toISOString());
  if (filters.to) query = query.lt('created_at', endOfDay(filters.to));
  const term = safeTerm(filters.search);
  if (term) {
    query = query.or(`action.ilike.*${term}*,actor_email.ilike.*${term}*,entity_id.ilike.*${term}*`);
  }

  const { data, error, count } = await query.range(page * pageSize, page * pageSize + pageSize - 1);
  if (error) throw error;
  return { entries: ((data ?? []) as Row[]).map(toEntry), total: count ?? 0 };
}

/** Name lookup so entries can show "Jane Doe" instead of a raw id. */
export async function loadPeopleNames(): Promise<Map<string, string>> {
  const { data, error } = await supabase.from('profiles').select('id, full_name');
  if (error) return new Map();
  return new Map(((data ?? []) as Row[]).map((row) => [String(row.id), String(row.full_name ?? '')]));
}

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : typeof value === 'string' ? value : JSON.stringify(value);
  // Neutralise spreadsheet formulas and quote every cell.
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

const EXPORT_LIMIT = 10000;

export async function exportAuditCsv(filters: AuditFilters): Promise<{ count: number }> {
  const { entries } = await loadAuditPage(filters, 0, EXPORT_LIMIT);
  const header = ['Time (UTC)', 'Source', 'Action', 'Entity', 'Entity id', 'Actor email', 'Actor id', 'Details'];
  const lines = [header.map(csvCell).join(',')].concat(
    entries.map((entry) =>
      [entry.created_at, entry.source, entry.action, entry.entity, entry.entity_id, entry.actor_email, entry.actor_id, entry.details]
        .map(csvCell)
        .join(','),
    ),
  );
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `audit-trail-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);

  await supabase
    .rpc('record_audit_event', { p_action: 'audit.exported', p_details: { rows: entries.length, filters } })
    .then(({ error }) => error && console.warn('Could not record the export', error.message));
  return { count: entries.length };
}
