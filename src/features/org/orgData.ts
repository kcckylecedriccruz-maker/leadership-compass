import { callEdgeFunction, isRecord } from '@/lib/edgeFunctions';
import { databaseErrorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';

export type OrgPerson = {
  id: string;
  full_name: string;
  email: string;
  role: string;
  is_active: boolean;
  manager_id: string | null;
  department: string | null;
  position: string | null;
  exclude_rated: boolean;
  exclude_rater: boolean;
  exclude_self: boolean;
  person_type: 'employee' | 'external';
  organisation: string | null;
  /** False until they set a password; until then they answer by secure link. */
  activated: boolean;
};

export type PeerStatus = 'suggested' | 'approved' | 'rejected';

export type PeerLink = {
  id: string;
  employee_id: string;
  peer_id: string;
  status: PeerStatus;
  suggested_by: string | null;
  created_at: string;
};

export type OrgData = {
  /** Employees only; external raters are listed per employee in externalsOf. */
  people: OrgPerson[];
  byId: Map<string, OrgPerson>;
  reportsOf: Map<string, OrgPerson[]>;
  peers: PeerLink[];
  externalsOf: Map<string, OrgPerson[]>;
};

type Row = Record<string, unknown>;
type Result = { ok: true } | { ok: false; message: string };

const PERSON_COLUMNS =
  'id, full_name, email, role, is_active, manager_id, department, position, exclude_rated, exclude_rater, exclude_self, person_type, organisation, activated_at';

function toPerson(row: Row): OrgPerson {
  return {
    id: String(row.id),
    full_name: String(row.full_name ?? ''),
    email: String(row.email ?? ''),
    role: String(row.role ?? 'employee'),
    is_active: row.is_active !== false,
    manager_id: typeof row.manager_id === 'string' ? row.manager_id : null,
    department: typeof row.department === 'string' ? row.department : null,
    position: typeof row.position === 'string' ? row.position : null,
    exclude_rated: row.exclude_rated === true,
    exclude_rater: row.exclude_rater === true,
    exclude_self: row.exclude_self === true,
    person_type: row.person_type === 'external' ? 'external' : 'employee',
    organisation: typeof row.organisation === 'string' ? row.organisation : null,
    activated: typeof row.activated_at === 'string',
  };
}

export function buildOrg(
  everyone: OrgPerson[],
  peers: PeerLink[],
  externalLinks: { employee_id: string; rater_id: string }[] = [],
): OrgData {
  const all = [...everyone].sort((a, b) => a.full_name.localeCompare(b.full_name));
  const sorted = all.filter((p) => p.person_type === 'employee');
  const byId = new Map(all.map((p) => [p.id, p]));
  const externalsOf = new Map<string, OrgPerson[]>();
  for (const link of externalLinks) {
    const rater = byId.get(link.rater_id);
    if (!rater) continue;
    const list = externalsOf.get(link.employee_id) ?? [];
    list.push(rater);
    externalsOf.set(link.employee_id, list);
  }
  const reportsOf = new Map<string, OrgPerson[]>();
  for (const person of sorted) {
    if (!person.manager_id) continue;
    const list = reportsOf.get(person.manager_id) ?? [];
    list.push(person);
    reportsOf.set(person.manager_id, list);
  }
  return { people: sorted, byId, reportsOf, peers, externalsOf };
}

export async function loadOrg(): Promise<OrgData> {
  const [profiles, peers, externals] = await Promise.all([
    supabase.from('profiles').select(PERSON_COLUMNS).order('full_name'),
    supabase.from('peer_relationships').select('id, employee_id, peer_id, status, suggested_by, created_at'),
    supabase.from('external_raters').select('employee_id, rater_id'),
  ]);
  if (profiles.error) throw profiles.error;
  return buildOrg(
    ((profiles.data ?? []) as Row[]).map(toPerson),
    ((peers.data ?? []) as Row[]).map((r) => ({
      id: String(r.id),
      employee_id: String(r.employee_id),
      peer_id: String(r.peer_id),
      status: (r.status === 'approved' || r.status === 'rejected' ? r.status : 'suggested') as PeerStatus,
      suggested_by: typeof r.suggested_by === 'string' ? r.suggested_by : null,
      created_at: String(r.created_at ?? ''),
    })),
    ((externals.data ?? []) as Row[]).map((r) => ({ employee_id: String(r.employee_id), rater_id: String(r.rater_id) })),
  );
}

/** The manager's manager, if any. */
export function skipLevelOf(org: OrgData, person: OrgPerson): OrgPerson | null {
  const manager = person.manager_id ? org.byId.get(person.manager_id) : undefined;
  return manager?.manager_id ? org.byId.get(manager.manager_id) ?? null : null;
}

/** Everyone below a person (to stop picking one of them as their manager). */
export function descendantsOf(org: OrgData, personId: string): Set<string> {
  const found = new Set<string>();
  const queue = [personId];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    for (const report of org.reportsOf.get(current) ?? []) {
      if (!found.has(report.id)) {
        found.add(report.id);
        queue.push(report.id);
      }
    }
  }
  return found;
}

function errorResult(error: { message: string; code?: string } | null): Result {
  if (!error) return { ok: true };
  if (/reporting loop/i.test(error.message)) {
    return { ok: false, message: 'That would create a reporting loop: someone above this person would report to them.' };
  }
  return { ok: false, message: databaseErrorMessage(error) };
}

export async function updatePerson(
  id: string,
  patch: Partial<Pick<OrgPerson, 'manager_id' | 'department' | 'position' | 'exclude_rated' | 'exclude_rater' | 'exclude_self'>>,
): Promise<Result> {
  const { error } = await supabase.from('profiles').update(patch).eq('id', id);
  return errorResult(error);
}

export async function suggestPeer(peerId: string): Promise<Result> {
  const { error } = await supabase.rpc('suggest_peer', { p_peer: peerId });
  return errorResult(error);
}

export async function assignPeer(employeeId: string, peerId: string): Promise<Result> {
  const { error } = await supabase.rpc('assign_peer', { p_employee: employeeId, p_peer: peerId });
  return errorResult(error);
}

export async function decidePeer(linkId: string, approve: boolean): Promise<Result> {
  const { error } = await supabase.rpc('decide_peer', { p_id: linkId, p_approve: approve });
  return errorResult(error);
}

export async function removePeer(linkId: string): Promise<Result> {
  const { error } = await supabase.rpc('remove_peer', { p_id: linkId });
  return errorResult(error);
}

type ManageResult = { ok: true; data: Record<string, unknown> } | { ok: false; message: string };

async function managePeople(action: string, body: Record<string, unknown>): Promise<ManageResult> {
  const result = await callEdgeFunction('manage-people', { action, ...body }, isRecord);
  return result.ok ? { ok: true, data: result.data } : { ok: false, message: result.message };
}

/** Adds an employee without an account invitation: they answer by secure link until they activate. */
export function quickAddEmployee(input: {
  full_name: string;
  email: string;
  manager_id: string | null;
  department: string;
  position: string;
}): Promise<ManageResult> {
  return managePeople('quick_add_employee', input);
}

export function addExternalRater(input: {
  employee_id: string;
  full_name: string;
  email: string;
  organisation: string;
}): Promise<ManageResult> {
  return managePeople('add_external', input);
}

export function removeExternalRater(employeeId: string, raterId: string): Promise<ManageResult> {
  return managePeople('remove_external', { employee_id: employeeId, rater_id: raterId });
}

export function sendEvaluationLink(profileId: string, cycleId: string): Promise<ManageResult> {
  return managePeople('send_link', { profile_id: profileId, cycle_id: cycleId });
}

export function revokeEvaluationLink(profileId: string, cycleId: string): Promise<ManageResult> {
  return managePeople('revoke_link', { profile_id: profileId, cycle_id: cycleId });
}
