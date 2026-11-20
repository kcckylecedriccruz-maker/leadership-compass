import { callEdgeFunction, isRecord, type FunctionResult } from '@/lib/edgeFunctions';
import { supabase } from '@/lib/supabase';
import { MODULES, isRole, type Module, type Role } from '@/lib/types';

export type AccessGrant = { module: Module; level: 'view' | 'edit' };

export type UserGroup = { id: string; name: string; description: string | null; memberIds: string[] };

export type ManagedUser = {
  id: string;
  full_name: string;
  email: string;
  role: Role;
  is_active: boolean;
  must_change_password: boolean;
  activated_at: string | null;
  deactivated_at: string | null;
  last_sign_in_at: string | null;
  access: AccessGrant[];
  groupIds: string[];
  department: string | null;
  position: string | null;
  /** Set while the account waits out its 3-day recovery window. */
  deletion_requested_at: string | null;
};

type Row = Record<string, unknown>;

function text(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

export async function loadManagedUsers(): Promise<ManagedUser[]> {
  const [profiles, signIns, access, members] = await Promise.all([
    // External raters never get an account; they are managed per employee in Org structure.
    supabase.from('profiles').select('*').eq('person_type', 'employee').order('full_name'),
    // Latest sign-in per person comes from the audit trail (auth.sign_in events).
    supabase
      .from('audit_log')
      .select('actor_id, created_at')
      .eq('action', 'auth.sign_in')
      .order('created_at', { ascending: false })
      .limit(1000),
    supabase.from('module_access').select('profile_id, module, level'),
    supabase.from('user_group_members').select('group_id, profile_id'),
  ]);
  if (profiles.error) throw profiles.error;

  const lastSignIn = new Map<string, string>();
  if (!signIns.error) {
    for (const row of (signIns.data ?? []) as Row[]) {
      const actor = text(row.actor_id);
      const at = text(row.created_at);
      if (actor && at && !lastSignIn.has(actor)) lastSignIn.set(actor, at);
    }
  }

  const grants = new Map<string, AccessGrant[]>();
  if (!access.error) {
    for (const row of (access.data ?? []) as Row[]) {
      const profileId = String(row.profile_id);
      const module = String(row.module);
      if (!(MODULES as readonly string[]).includes(module)) continue;
      const list = grants.get(profileId) ?? [];
      list.push({ module: module as Module, level: row.level === 'edit' ? 'edit' : 'view' });
      grants.set(profileId, list);
    }
  }

  const groupsByProfile = new Map<string, string[]>();
  if (!members.error) {
    for (const row of (members.data ?? []) as Row[]) {
      const list = groupsByProfile.get(String(row.profile_id)) ?? [];
      list.push(String(row.group_id));
      groupsByProfile.set(String(row.profile_id), list);
    }
  }

  return ((profiles.data ?? []) as Row[])
    // Fully deleted people are anonymised and no longer managed here.
    .filter((row) => isRole(row.role) && !row.deleted_at)
    .map((row) => ({
      id: String(row.id),
      full_name: String(row.full_name ?? ''),
      email: String(row.email ?? ''),
      role: row.role as Role,
      is_active: row.is_active !== false,
      must_change_password: row.must_change_password === true,
      activated_at: text(row.activated_at),
      deactivated_at: text(row.deactivated_at),
      last_sign_in_at: lastSignIn.get(String(row.id)) ?? null,
      access: (grants.get(String(row.id)) ?? []).sort((a, b) => MODULES.indexOf(a.module) - MODULES.indexOf(b.module)),
      groupIds: groupsByProfile.get(String(row.id)) ?? [],
      department: text(row.department),
      position: text(row.position),
      deletion_requested_at: text(row.deletion_requested_at),
    }));
}

export type ManageUserRequest =
  | { action: 'set_role'; userId: string; role: Role }
  | { action: 'deactivate'; userId: string; reason: string }
  | { action: 'reactivate'; userId: string }
  | { action: 'require_password_change'; userId: string }
  | { action: 'rename'; userId: string; fullName: string }
  | { action: 'set_module_access'; userId: string; access: AccessGrant[] };

function isStatusPayload(value: unknown): value is { status: string } {
  return isRecord(value) && typeof value.status === 'string';
}

export function manageUser(request: ManageUserRequest): Promise<FunctionResult<{ status: string }>> {
  return callEdgeFunction('manage-user', request, isStatusPayload);
}

export type CreateUserInput = {
  fullName: string;
  email: string;
  role: Role;
  access: AccessGrant[];
  groups: string[];
  sendInvite: boolean;
  department?: string;
  position?: string;
  managerId?: string | null;
};

function isCreatedPayload(value: unknown): value is { status: string; id: string; inviteSent: boolean } {
  return isRecord(value) && value.status === 'created' && typeof value.id === 'string';
}

export function createUser(input: CreateUserInput) {
  return callEdgeFunction('create-user', input, isCreatedPayload);
}

function isMessagePayload(value: unknown): value is { message: string } {
  return isRecord(value) && typeof value.message === 'string';
}

export function resendInvite(profileId: string) {
  return callEdgeFunction('resend-invite', { profile_id: profileId }, isMessagePayload);
}

// ---- Groups -----------------------------------------------------------------

export async function loadGroups(): Promise<UserGroup[]> {
  const [groups, members] = await Promise.all([
    supabase.from('user_groups').select('id, name, description').order('name'),
    supabase.from('user_group_members').select('group_id, profile_id'),
  ]);
  if (groups.error) throw groups.error;
  const byGroup = new Map<string, string[]>();
  for (const row of (members.data ?? []) as Row[]) {
    const list = byGroup.get(String(row.group_id)) ?? [];
    list.push(String(row.profile_id));
    byGroup.set(String(row.group_id), list);
  }
  return ((groups.data ?? []) as Row[]).map((row) => ({
    id: String(row.id),
    name: String(row.name),
    description: text(row.description),
    memberIds: byGroup.get(String(row.id)) ?? [],
  }));
}

type Result = { ok: true } | { ok: false; message: string };

function groupError(message: string): string {
  if (/duplicate|unique/i.test(message)) return 'A group with that name already exists.';
  if (/permission|policy|42501/i.test(message)) return 'You need edit access to Users to change groups.';
  return 'Could not save the group. Please try again.';
}

export async function saveGroup(group: { id?: string; name: string; description: string }): Promise<Result> {
  const payload = { name: group.name.trim(), description: group.description.trim() || null };
  const { error } = group.id
    ? await supabase.from('user_groups').update(payload).eq('id', group.id)
    : await supabase.from('user_groups').insert(payload);
  return error ? { ok: false, message: groupError(error.message) } : { ok: true };
}

export async function deleteGroup(id: string): Promise<Result> {
  const { error } = await supabase.from('user_groups').delete().eq('id', id);
  return error ? { ok: false, message: groupError(error.message) } : { ok: true };
}

/** Makes the group's members exactly `memberIds`. */
export async function setGroupMembers(groupId: string, current: string[], memberIds: string[]): Promise<Result> {
  const add = memberIds.filter((id) => !current.includes(id));
  const remove = current.filter((id) => !memberIds.includes(id));
  if (add.length > 0) {
    const { error } = await supabase
      .from('user_group_members')
      .insert(add.map((profileId) => ({ group_id: groupId, profile_id: profileId })));
    if (error) return { ok: false, message: groupError(error.message) };
  }
  if (remove.length > 0) {
    const { error } = await supabase.from('user_group_members').delete().eq('group_id', groupId).in('profile_id', remove);
    if (error) return { ok: false, message: groupError(error.message) };
  }
  return { ok: true };
}

// ---- Bulk upload --------------------------------------------------------------

export type BulkRow = {
  row: number;
  fullName: string;
  email: string;
  role: Role;
  groups: string[];
  sendInvite: boolean;
  department: string;
  position: string;
  /** Update an existing account instead of creating one. */
  update: boolean;
};

export type BulkLinkRow = {
  row: number;
  email: string;
  managerEmail: string | null;
  directReports: string[];
  peers: string[];
  department: string;
  position: string;
};

export type BulkRowResult = {
  row: number;
  email: string;
  status: 'created' | 'updated' | 'linked' | 'skipped' | 'failed';
  message: string;
};

function isBulkPayload(value: unknown): value is { results: BulkRowResult[] } {
  return isRecord(value) && Array.isArray(value.results);
}

export function bulkCreateUsers(rows: BulkRow[]) {
  return callEdgeFunction('bulk-create-users', { rows }, isBulkPayload);
}

/** Phase 2 of a bulk upload: managers, direct reports and peers, once every account exists. */
export function bulkLinkPeople(rows: BulkLinkRow[]) {
  return callEdgeFunction('bulk-link-people', { rows }, isBulkPayload);
}
