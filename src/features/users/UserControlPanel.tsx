import { lazy, Suspense, useMemo, useState } from 'react';
import {
  FileSpreadsheet,
  KeyRound,
  Loader2,
  Mail,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  UserCheck,
  UserPlus,
  UserRound,
  Users,
  UserX,
} from 'lucide-react';
import { Badge } from '@/components/Badge';
import { Modal } from '@/components/Modal';
import { Notice } from '@/components/Notice';
import { AccountDeletionButton, DeletionBadge } from '@/features/users/AccountDeletion';
import { GroupsDialog } from '@/features/users/GroupsDialog';
import {
  createUser,
  loadGroups,
  loadManagedUsers,
  manageUser,
  resendInvite,
  type AccessGrant,
  type ManagedUser,
  type ManageUserRequest,
  type UserGroup,
} from '@/features/users/userControl';
import { MODULES, MODULE_LABELS, ROLES, canEdit as canEditModule, type Module, type Profile, type Role } from '@/lib/types';
import { useAsyncData } from '@/lib/useAsyncData';

// Loaded only when opened: it carries the Excel libraries.
const BulkUploadDialog = lazy(() => import('@/features/users/BulkUploadDialog').then((m) => ({ default: m.BulkUploadDialog })));

const ROLE_LABELS: Record<Role, string> = {
  admin: 'Administrator',
  employee: 'Employee',
};

const ROLE_HELP: Record<Role, string> = {
  admin: 'Full access to every module, all reports, sharing, user control and the audit trail. Can also be assessed.',
  employee:
    'Gives feedback and is assessed, including a self-assessment each cycle. Anyone with direct reports in the org structure also gets My team.',
};

const MODULE_HELP: Record<Module, string> = {
  dashboard: 'Readiness and reports for every employee',
  cycles: 'Review rounds, dates and reminders',
  people: 'Everyone with an account',
  talents: 'Reporting lines, peers and rating exclusions',
  assignments: 'Who evaluates whom in each cycle (generated plus manual)',
  users: 'Create accounts, roles and status',
  audit: 'Who did what, and when',
  settings: 'Email sender and templates',
};

// Notifications / Settings are for administrators only, so they are never granted.
const GRANTABLE_MODULES = MODULES.filter((module) => module !== 'settings');

// Some modules are read-only screens, so edit means nothing for them.
const VIEW_ONLY_MODULES: Module[] = ['dashboard', 'audit'];

type StatusFilter = 'all' | 'active' | 'inactive';
type Level = 'none' | 'view' | 'edit';

const DATE_TIME = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' });

function when(iso: string | null): string {
  return iso ? DATE_TIME.format(new Date(iso)) : 'Never';
}

function accessSummary(user: ManagedUser): string {
  if (user.role === 'admin') return 'Full access to every module';
  if (user.access.length === 0) return 'No workspace modules';
  return user.access.map((grant) => `${MODULE_LABELS[grant.module]} (${grant.level})`).join(', ');
}

type PendingAction = {
  user: ManagedUser;
  kind: 'role' | 'deactivate' | 'reactivate' | 'password' | 'rename' | 'access';
};

export function UserControlPanel({ currentUser, canEdit = true }: { currentUser: Profile; canEdit?: boolean }) {
  const { state, reload } = useAsyncData(loadManagedUsers);
  const groupsData = useAsyncData(loadGroups);
  const groups = useMemo(() => (groupsData.state.status === 'ready' ? groupsData.state.data : []), [groupsData.state]);
  const groupName = useMemo(() => new Map(groups.map((g) => [g.id, g.name])), [groups]);
  const [groupFilter, setGroupFilter] = useState<string>('all');
  const [bulkOpen, setBulkOpen] = useState(false);
  const [groupsOpen, setGroupsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<Role | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [adding, setAdding] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [resending, setResending] = useState<string | null>(null);
  const actorIsAdmin = currentUser.role === 'admin';

  const users = useMemo(() => (state.status === 'ready' ? state.data : []), [state]);
  const activeAdmins = users.filter((user) => user.role === 'admin' && user.is_active).length;

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return users.filter(
      (user) =>
        (roleFilter === 'all' || user.role === roleFilter) &&
        (statusFilter === 'all' || (statusFilter === 'active') === user.is_active) &&
        (groupFilter === 'all' || user.groupIds.includes(groupFilter)) &&
        (!needle || user.full_name.toLowerCase().includes(needle) || user.email.toLowerCase().includes(needle)),
    );
  }, [users, query, roleFilter, statusFilter, groupFilter]);

  const counts = {
    total: users.length,
    active: users.filter((user) => user.is_active).length,
    pending: users.filter((user) => user.is_active && !user.activated_at).length,
    admins: activeAdmins,
  };

  function finished(message: string) {
    setPending(null);
    setAdding(false);
    setBulkOpen(false);
    setFlash(message);
    reload();
    groupsData.reload();
  }

  async function handleResend(user: ManagedUser) {
    setResending(user.id);
    const result = await resendInvite(user.id);
    setResending(null);
    setFlash(result.ok ? `Invitation sent again to ${user.email}.` : result.message);
  }

  return (
    <section className="space-y-6" aria-labelledby="users-heading">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <h2 id="users-heading" className="text-2xl">
            User control
          </h2>
          <p className="text-sm leading-relaxed text-ink-muted">
            Create accounts, set each person&apos;s role and which modules they can view or edit, and switch accounts off
            and on. Every change is recorded in the audit trail.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <button type="button" className="btn-secondary" onClick={() => setGroupsOpen(true)}>
            <Users className="h-4 w-4" aria-hidden="true" />
            Groups
          </button>
          {canEdit && (
            <>
              <button type="button" className="btn-secondary" onClick={() => setBulkOpen(true)}>
                <FileSpreadsheet className="h-4 w-4" aria-hidden="true" />
                Bulk upload
              </button>
              <button type="button" className="btn-primary" onClick={() => setAdding(true)}>
                <UserPlus className="h-4 w-4" aria-hidden="true" />
                Add user
              </button>
            </>
          )}
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: 'Accounts', value: counts.total },
          { label: 'Active', value: counts.active },
          { label: 'Invite pending', value: counts.pending },
          { label: 'Active admins', value: counts.admins },
        ].map((item) => (
          <div key={item.label} className="rounded-card border border-line bg-surface p-4">
            <dt className="text-xs font-semibold text-ink-muted">{item.label}</dt>
            <dd className="mt-1 text-2xl font-semibold tabular-nums">{state.status === 'ready' ? item.value : '–'}</dd>
          </div>
        ))}
      </dl>

      <div className="flex flex-col gap-3 sm:flex-row">
        <label className="relative flex-1">
          <span className="sr-only">Search users</span>
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" aria-hidden="true" />
          <input
            className="field-input pl-10"
            placeholder="Search by name or email"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <label className="sm:w-44">
          <span className="sr-only">Role</span>
          <select className="field-input" value={roleFilter} onChange={(event) => setRoleFilter(event.target.value as Role | 'all')}>
            <option value="all">All roles</option>
            {ROLES.map((role) => (
              <option key={role} value={role}>
                {ROLE_LABELS[role]}
              </option>
            ))}
          </select>
        </label>
        <label className="sm:w-40">
          <span className="sr-only">Status</span>
          <select className="field-input" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}>
            <option value="all">Any status</option>
            <option value="active">Active</option>
            <option value="inactive">Deactivated</option>
          </select>
        </label>
        {groups.length > 0 && (
          <label className="sm:w-44">
            <span className="sr-only">Group</span>
            <select className="field-input" value={groupFilter} onChange={(event) => setGroupFilter(event.target.value)}>
              <option value="all">All groups</option>
              {groups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {flash && (
        <div className="flex items-start justify-between gap-4">
          <Notice tone="info">{flash}</Notice>
          <button type="button" onClick={() => setFlash(null)} className="shrink-0 text-sm font-semibold text-ink-muted hover:text-ink">
            Dismiss
          </button>
        </div>
      )}

      {state.status === 'loading' && <p className="text-sm text-ink-muted">Loading users...</p>}
      {state.status === 'error' && (
        <Notice>
          We could not load users.{' '}
          <button type="button" onClick={reload} className="font-semibold underline underline-offset-4">
            Try again
          </button>
        </Notice>
      )}

      {state.status === 'ready' && visible.length === 0 && (
        <div className="rounded-card border border-dashed border-line bg-surface p-8 text-center">
          <p className="font-semibold">No matching users</p>
          <p className="mt-1 text-sm text-ink-muted">Try a different search or filter.</p>
        </div>
      )}

      {state.status === 'ready' && visible.length > 0 && (
        <ul className="space-y-3">
          {visible.map((user) => {
            const isSelf = user.id === currentUser.id;
            // Non-admins with Users edit access manage non-admin accounts only.
            const locked = !canEdit || (!actorIsAdmin && user.role === 'admin');
            return (
              <li
                key={user.id}
                className={`flex flex-col gap-4 rounded-card border border-line bg-surface p-5 lg:flex-row lg:items-center ${
                  user.is_active ? '' : 'opacity-75'
                }`}
              >
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-muted text-primary">
                  {user.role === 'admin' ? <ShieldCheck className="h-5 w-5" aria-hidden="true" /> : <UserRound className="h-5 w-5" aria-hidden="true" />}
                </span>
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="min-w-0">
                    <p className="truncate font-semibold">
                      {user.full_name}
                      {isSelf && <span className="ml-2 text-xs font-semibold text-ink-muted">(you)</span>}
                    </p>
                    <p className="truncate text-sm text-ink-muted">{user.email}</p>
                    {(user.department || user.position) && (
                      <p className="truncate text-xs text-ink-muted">{[user.position, user.department].filter(Boolean).join(' · ')}</p>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="neutral">{ROLE_LABELS[user.role]}</Badge>
                    {user.groupIds.map((id) =>
                      groupName.has(id) ? (
                        <span
                          key={id}
                          className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/5 px-2.5 py-0.5 text-xs font-semibold text-primary"
                        >
                          <Users className="h-3 w-3" aria-hidden="true" />
                          {groupName.get(id)}
                        </span>
                      ) : null,
                    )}
                    {user.is_active ? <Badge tone="success">Active</Badge> : <Badge tone="warning">Deactivated</Badge>}
                    {user.deletion_requested_at && <DeletionBadge requestedAt={user.deletion_requested_at} />}
                    {user.is_active && !user.activated_at && <Badge tone="warning">Invite pending</Badge>}
                    {user.must_change_password && user.activated_at && <Badge tone="neutral">Password change pending</Badge>}
                  </div>
                  <p className="text-xs text-ink-muted">
                    <span className="font-semibold">Access:</span> {accessSummary(user)}
                  </p>
                  <p className="text-xs text-ink-muted">
                    Last sign-in: {when(user.last_sign_in_at)}
                    {!user.is_active && user.deactivated_at ? ` · Deactivated ${when(user.deactivated_at)}` : ''}
                  </p>
                </div>
                {!locked && user.deletion_requested_at && actorIsAdmin && (
                  <div className="flex flex-wrap gap-2 lg:max-w-sm lg:justify-end">
                    <AccountDeletionButton user={user} onDone={finished} />
                  </div>
                )}
                {!locked && !user.deletion_requested_at && (
                  <div className="flex flex-wrap gap-2 lg:max-w-sm lg:justify-end">
                    {user.is_active && !user.activated_at && (
                      <button
                        type="button"
                        className="btn-secondary px-3 py-2"
                        disabled={resending === user.id}
                        onClick={() => void handleResend(user)}
                      >
                        {resending === user.id ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Mail className="h-4 w-4" aria-hidden="true" />}
                        Resend invite
                      </button>
                    )}
                    <button type="button" className="btn-secondary px-3 py-2" onClick={() => setPending({ user, kind: 'rename' })}>
                      Rename
                    </button>
                    <button
                      type="button"
                      className="btn-secondary px-3 py-2"
                      disabled={isSelf}
                      title={isSelf ? 'Ask another administrator to change your role' : undefined}
                      onClick={() => setPending({ user, kind: 'role' })}
                    >
                      Role
                    </button>
                    {actorIsAdmin && user.role !== 'admin' && (
                      <button
                        type="button"
                        className="btn-secondary px-3 py-2"
                        disabled={isSelf}
                        onClick={() => setPending({ user, kind: 'access' })}
                      >
                        <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
                        Access
                      </button>
                    )}
                    {user.activated_at && (
                      <button type="button" className="btn-secondary px-3 py-2" onClick={() => setPending({ user, kind: 'password' })}>
                        <KeyRound className="h-4 w-4" aria-hidden="true" />
                        <span className="sr-only sm:not-sr-only">Reset</span>
                      </button>
                    )}
                    {user.is_active ? (
                      <button
                        type="button"
                        className="btn-secondary px-3 py-2 text-danger"
                        disabled={isSelf}
                        title={isSelf ? 'You cannot deactivate yourself' : undefined}
                        onClick={() => setPending({ user, kind: 'deactivate' })}
                      >
                        <UserX className="h-4 w-4" aria-hidden="true" />
                        Deactivate
                      </button>
                    ) : (
                      <>
                        <button type="button" className="btn-secondary px-3 py-2" onClick={() => setPending({ user, kind: 'reactivate' })}>
                          <UserCheck className="h-4 w-4" aria-hidden="true" />
                          Reactivate
                        </button>
                        {actorIsAdmin && !isSelf && <AccountDeletionButton user={user} onDone={finished} />}
                      </>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {adding && (
        <AddUserDialog actorIsAdmin={actorIsAdmin} groups={groups} people={users.filter((u) => u.is_active)} onClose={() => setAdding(false)} onDone={finished} />
      )}

      {bulkOpen && (
        <Suspense fallback={null}>
          <BulkUploadDialog
          known={new Map(users.map((u) => [u.email.toLowerCase(), { email: u.email.toLowerCase(), role: u.role, fullName: u.full_name }]))}
          groupNames={groups.map((g) => g.name)}
          canCreateAdmins={actorIsAdmin}
          canLink={canEditModule(currentUser, 'talents') && canEditModule(currentUser, 'assignments')}
          onClose={() => setBulkOpen(false)}
          onFinished={finished}
          />
        </Suspense>
      )}

      {groupsOpen && (
        <GroupsDialog
          groups={groups}
          users={users}
          canEdit={canEdit}
          onClose={() => setGroupsOpen(false)}
          onChanged={() => {
            groupsData.reload();
            reload();
          }}
        />
      )}

      {pending && (
        <UserActionDialog
          pending={pending}
          actorIsAdmin={actorIsAdmin}
          isLastAdmin={pending.user.role === 'admin' && pending.user.is_active && activeAdmins <= 1}
          onClose={() => setPending(null)}
          onDone={finished}
        />
      )}
    </section>
  );
}

function grantsToLevels(grants: AccessGrant[]): Record<Module, Level> {
  const levels = Object.fromEntries(MODULES.map((module) => [module, 'none'])) as Record<Module, Level>;
  for (const grant of grants) levels[grant.module] = grant.level;
  return levels;
}

function levelsToGrants(levels: Record<Module, Level>): AccessGrant[] {
  return GRANTABLE_MODULES.filter((module) => levels[module] !== 'none').map((module) => ({
    module,
    level: levels[module] as 'view' | 'edit',
  }));
}

/** A row per module with a None / View / Edit choice. */
function AccessEditor({ levels, onChange }: { levels: Record<Module, Level>; onChange: (next: Record<Module, Level>) => void }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-line">
      <table className="w-full text-left text-sm">
        <thead className="bg-muted text-xs text-ink-muted">
          <tr>
            <th scope="col" className="px-3 py-2 font-semibold">
              Module
            </th>
            <th scope="col" className="px-3 py-2 text-right font-semibold">
              Access
            </th>
          </tr>
        </thead>
        <tbody>
          {GRANTABLE_MODULES.map((module) => {
            const options: Level[] = VIEW_ONLY_MODULES.includes(module) ? ['none', 'view'] : ['none', 'view', 'edit'];
            return (
              <tr key={module} className="border-t border-line align-middle">
                <td className="px-3 py-2">
                  <span className="block font-semibold">{MODULE_LABELS[module]}</span>
                  <span className="block text-xs text-ink-muted">{MODULE_HELP[module]}</span>
                </td>
                <td className="px-3 py-2">
                  <div role="radiogroup" aria-label={`${MODULE_LABELS[module]} access`} className="ml-auto flex w-fit gap-1 rounded-xl bg-muted p-1">
                    {options.map((option) => {
                      const selected = levels[module] === option;
                      return (
                        <button
                          key={option}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          onClick={() => onChange({ ...levels, [module]: option })}
                          className={`rounded-lg px-2.5 py-1 text-xs font-semibold capitalize transition-colors ${
                            selected ? 'bg-surface text-ink shadow-sm' : 'text-ink-muted hover:text-ink'
                          }`}
                        >
                          {option}
                        </button>
                      );
                    })}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function RolePicker({ role, onChange, allowAdmin }: { role: Role; onChange: (role: Role) => void; allowAdmin: boolean }) {
  return (
    <fieldset className="space-y-2">
      <legend className="mb-2 text-sm font-semibold">Role</legend>
      {ROLES.filter((option) => allowAdmin || option !== 'admin').map((option) => (
        <label
          key={option}
          className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-3 transition-colors ${
            role === option ? 'border-primary bg-muted' : 'border-line hover:bg-muted'
          }`}
        >
          <input type="radio" name="role" className="mt-1 accent-primary" checked={role === option} onChange={() => onChange(option)} />
          <span>
            <span className="block text-sm font-semibold">{ROLE_LABELS[option]}</span>
            <span className="block text-xs text-ink-muted">{ROLE_HELP[option]}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function AddUserDialog({
  actorIsAdmin,
  groups,
  people,
  onClose,
  onDone,
}: {
  actorIsAdmin: boolean;
  groups: UserGroup[];
  people: ManagedUser[];
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('employee');
  const [managerId, setManagerId] = useState('');
  const [levels, setLevels] = useState<Record<Module, Level>>(grantsToLevels([]));
  const [sendInvite, setSendInvite] = useState(true);
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [department, setDepartment] = useState('');
  const [position, setPosition] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!fullName.trim()) return setError('Enter the person’s full name.');
    if (!EMAIL_PATTERN.test(email.trim())) return setError('Enter a valid work email address.');
    setBusy(true);
    setError(null);
    const result = await createUser({
      fullName: fullName.trim(),
      email: email.trim(),
      role,
      access: role === 'admin' || !actorIsAdmin ? [] : levelsToGrants(levels),
      groups: groups.filter((g) => groupIds.includes(g.id)).map((g) => g.name),
      sendInvite,
      department: department.trim(),
      position: position.trim(),
      managerId: managerId || null,
    });
    setBusy(false);
    if (!result.ok) return setError(result.message);
    onDone(
      result.data.inviteSent
        ? `${fullName.trim()} was added. An invitation is on its way to ${email.trim()}.`
        : `${fullName.trim()} was added, but no invitation was sent. Use Resend invite when you are ready.`,
    );
  }

  return (
    <Modal title="Add user" description="They get an email invitation and choose their own password." onClose={onClose}>
      <form
        className="space-y-5"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
        noValidate
      >
        <label className="block space-y-2">
          <span className="text-sm font-semibold">Full name</span>
          <input className="field-input" value={fullName} maxLength={200} onChange={(event) => setFullName(event.target.value)} autoComplete="off" />
        </label>
        <label className="block space-y-2">
          <span className="text-sm font-semibold">Work email</span>
          <input
            type="email"
            className="field-input"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="name@company.com"
            autoComplete="off"
          />
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block space-y-2">
            <span className="text-sm font-semibold">Department (optional)</span>
            <input className="field-input" value={department} maxLength={100} onChange={(event) => setDepartment(event.target.value)} />
          </label>
          <label className="block space-y-2">
            <span className="text-sm font-semibold">Position (optional)</span>
            <input className="field-input" value={position} maxLength={100} onChange={(event) => setPosition(event.target.value)} />
          </label>
        </div>

        <label className="block space-y-2">
          <span className="text-sm font-semibold">Immediate manager (optional)</span>
          <select className="field-input" value={managerId} onChange={(event) => setManagerId(event.target.value)}>
            <option value="">No manager (top of the org)</option>
            {people.map((person) => (
              <option key={person.id} value={person.id}>
                {person.full_name}
                {person.position ? ` · ${person.position}` : ''}
              </option>
            ))}
          </select>
          <span className="block text-xs text-ink-muted">Sets their reporting line in the Org structure. You can change it later.</span>
        </label>

        <RolePicker role={role} onChange={setRole} allowAdmin={actorIsAdmin} />

        {actorIsAdmin && role !== 'admin' && (
          <div className="space-y-2">
            <p className="text-sm font-semibold">Workspace modules</p>
            <p className="text-xs text-ink-muted">
              Optional. Their role already covers their own assessments; give access here only for admin modules.
            </p>
            <AccessEditor levels={levels} onChange={setLevels} />
          </div>
        )}

        {groups.length > 0 && (
          <fieldset className="space-y-2">
            <legend className="mb-2 text-sm font-semibold">Groups (optional)</legend>
            <div className="flex flex-wrap gap-2">
              {groups.map((group) => {
                const on = groupIds.includes(group.id);
                return (
                  <button
                    key={group.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setGroupIds((ids) => (on ? ids.filter((id) => id !== group.id) : [...ids, group.id]))}
                    className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
                      on ? 'border-primary bg-primary text-on-primary' : 'border-line text-ink-muted hover:text-ink'
                    }`}
                  >
                    {group.name}
                  </button>
                );
              })}
            </div>
          </fieldset>
        )}

        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" className="mt-1 accent-primary" checked={sendInvite} onChange={(event) => setSendInvite(event.target.checked)} />
          <span>
            <span className="block font-semibold">Email the invitation now</span>
            <span className="block text-xs text-ink-muted">They open the link, get a 6-digit code and set their password.</span>
          </span>
        </label>

        {error && <Notice>{error}</Notice>}

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            Add user
          </button>
        </div>
      </form>
    </Modal>
  );
}

function UserActionDialog({
  pending,
  actorIsAdmin,
  isLastAdmin,
  onClose,
  onDone,
}: {
  pending: PendingAction;
  actorIsAdmin: boolean;
  isLastAdmin: boolean;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const { user, kind } = pending;
  const [role, setRole] = useState<Role>(user.role);
  const [reason, setReason] = useState('');
  const [fullName, setFullName] = useState(user.full_name);
  const [levels, setLevels] = useState<Record<Module, Level>>(grantsToLevels(user.access));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const config: Record<PendingAction['kind'], { title: string; description: string; confirm: string; danger?: boolean }> = {
    role: { title: 'Change role', description: `Choose what ${user.full_name} can do.`, confirm: 'Save role' },
    access: {
      title: 'Module access',
      description: `Choose which workspace modules ${user.full_name} can view or edit. Changes apply at their next sign-in or page refresh.`,
      confirm: 'Save access',
    },
    deactivate: {
      title: 'Deactivate account',
      description: `${user.full_name} will be blocked from signing in. Their assessment data is kept.`,
      confirm: 'Deactivate',
      danger: true,
    },
    reactivate: {
      title: 'Reactivate account',
      description: `${user.full_name} will be able to sign in again with their existing password.`,
      confirm: 'Reactivate',
    },
    password: {
      title: 'Require a new password',
      description: `${user.full_name} must choose a new password the next time they sign in.`,
      confirm: 'Require new password',
    },
    rename: { title: 'Rename user', description: 'Correct how this person’s name appears across the app.', confirm: 'Save name' },
  };
  const current = config[kind];
  const blockedByLastAdmin = isLastAdmin && (kind === 'deactivate' || (kind === 'role' && role !== 'admin'));

  async function submit() {
    let request: ManageUserRequest;
    switch (kind) {
      case 'role':
        request = { action: 'set_role', userId: user.id, role };
        break;
      case 'access':
        request = { action: 'set_module_access', userId: user.id, access: levelsToGrants(levels) };
        break;
      case 'deactivate':
        request = { action: 'deactivate', userId: user.id, reason };
        break;
      case 'reactivate':
        request = { action: 'reactivate', userId: user.id };
        break;
      case 'password':
        request = { action: 'require_password_change', userId: user.id };
        break;
      case 'rename':
        if (!fullName.trim()) {
          setError('Enter a name.');
          return;
        }
        request = { action: 'rename', userId: user.id, fullName: fullName.trim() };
        break;
    }
    setBusy(true);
    setError(null);
    const result = await manageUser(request);
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    onDone(
      result.data.status === 'unchanged'
        ? 'Nothing changed.'
        : {
            role: `${user.full_name} is now ${ROLE_LABELS[role].toLowerCase()}.`,
            access: `Module access updated for ${user.full_name}.`,
            deactivate: `${user.full_name} has been deactivated.`,
            reactivate: `${user.full_name} has been reactivated.`,
            password: `${user.full_name} will be asked for a new password at next sign-in.`,
            rename: `Name updated to ${fullName.trim()}.`,
          }[kind],
    );
  }

  return (
    <Modal title={current.title} description={current.description} onClose={onClose}>
      <form
        className="space-y-5"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        {kind === 'role' && <RolePicker role={role} onChange={setRole} allowAdmin={actorIsAdmin} />}

        {kind === 'access' && <AccessEditor levels={levels} onChange={setLevels} />}

        {kind === 'deactivate' && (
          <label className="block space-y-2">
            <span className="text-sm font-semibold">Reason (recorded in the audit trail)</span>
            <textarea
              className="field-input min-h-24"
              value={reason}
              maxLength={500}
              onChange={(event) => setReason(event.target.value)}
              placeholder="For example: left the company"
            />
          </label>
        )}

        {kind === 'rename' && (
          <label className="block space-y-2">
            <span className="text-sm font-semibold">Full name</span>
            <input className="field-input" value={fullName} maxLength={200} onChange={(event) => setFullName(event.target.value)} />
          </label>
        )}

        {blockedByLastAdmin && <Notice>This is the only active administrator. Make someone else an administrator first.</Notice>}
        {error && <Notice>{error}</Notice>}

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className={current.danger ? 'btn-primary bg-danger hover:bg-danger' : 'btn-primary'}
            disabled={busy || blockedByLastAdmin}
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            {current.confirm}
          </button>
        </div>
      </form>
    </Modal>
  );
}
