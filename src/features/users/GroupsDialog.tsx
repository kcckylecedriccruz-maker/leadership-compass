import { useMemo, useState } from 'react';
import { ArrowLeft, Loader2, Pencil, Plus, Search, Trash2, Users } from 'lucide-react';
import { Modal } from '@/components/Modal';
import { Notice } from '@/components/Notice';
import { deleteGroup, saveGroup, setGroupMembers, type ManagedUser, type UserGroup } from '@/features/users/userControl';

type View = { kind: 'list' } | { kind: 'edit'; group: UserGroup | null } | { kind: 'members'; group: UserGroup };

export function GroupsDialog({
  groups,
  users,
  canEdit,
  onClose,
  onChanged,
}: {
  groups: UserGroup[];
  users: ManagedUser[];
  canEdit: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [view, setView] = useState<View>({ kind: 'list' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<{ ok: true } | { ok: false; message: string }>) {
    setBusy(true);
    setError(null);
    const result = await action();
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return false;
    }
    onChanged();
    setView({ kind: 'list' });
    return true;
  }

  return (
    <Modal title="Groups" description="Put people into groups such as a team, batch or programme, then filter by group." onClose={onClose}>
      <div className="space-y-5">
        {view.kind !== 'list' && (
          <button
            type="button"
            onClick={() => {
              setError(null);
              setView({ kind: 'list' });
            }}
            className="inline-flex items-center gap-2 text-sm font-semibold text-ink-muted hover:text-ink"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            All groups
          </button>
        )}

        {view.kind === 'list' && (
          <>
            {canEdit && (
              <button type="button" className="btn-primary" onClick={() => setView({ kind: 'edit', group: null })}>
                <Plus className="h-4 w-4" aria-hidden="true" />
                New group
              </button>
            )}
            {groups.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-line p-6 text-center text-sm text-ink-muted">
                No groups yet. Create one here, or add a Groups column in the bulk upload.
              </p>
            ) : (
              <ul className="divide-y divide-line rounded-2xl border border-line">
                {groups.map((group) => (
                  <li key={group.id} className="flex items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{group.name}</p>
                      <p className="truncate text-xs text-ink-muted">
                        {group.memberIds.length} {group.memberIds.length === 1 ? 'member' : 'members'}
                        {group.description ? ` · ${group.description}` : ''}
                      </p>
                    </div>
                    {canEdit && (
                      <div className="flex shrink-0 gap-1">
                        <button
                          type="button"
                          className="btn-secondary px-2.5 py-1.5"
                          onClick={() => setView({ kind: 'members', group })}
                          aria-label={`Members of ${group.name}`}
                        >
                          <Users className="h-4 w-4" aria-hidden="true" />
                          <span className="hidden sm:inline">Members</span>
                        </button>
                        <button
                          type="button"
                          className="btn-secondary px-2.5 py-1.5"
                          onClick={() => setView({ kind: 'edit', group })}
                          aria-label={`Rename ${group.name}`}
                        >
                          <Pencil className="h-4 w-4" aria-hidden="true" />
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        {view.kind === 'edit' && (
          <GroupForm
            group={view.group}
            busy={busy}
            onSave={(name, description) => void run(() => saveGroup({ id: view.group?.id, name, description }))}
            onDelete={
              view.group
                ? () => {
                    const group = view.group;
                    if (group && window.confirm(`Delete the group "${group.name}"? People stay; only the grouping is removed.`)) {
                      void run(() => deleteGroup(group.id));
                    }
                  }
                : undefined
            }
          />
        )}

        {view.kind === 'members' && (
          <MemberPicker
            group={view.group}
            users={users}
            busy={busy}
            onSave={(ids) => void run(() => setGroupMembers(view.group.id, view.group.memberIds, ids))}
          />
        )}

        {error && <Notice>{error}</Notice>}
      </div>
    </Modal>
  );
}

function GroupForm({
  group,
  busy,
  onSave,
  onDelete,
}: {
  group: UserGroup | null;
  busy: boolean;
  onSave: (name: string, description: string) => void;
  onDelete?: () => void;
}) {
  const [name, setName] = useState(group?.name ?? '');
  const [description, setDescription] = useState(group?.description ?? '');

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (name.trim()) onSave(name, description);
      }}
    >
      <label className="block space-y-2">
        <span className="text-sm font-semibold">Group name</span>
        <input className="field-input" value={name} maxLength={100} onChange={(event) => setName(event.target.value)} placeholder="For example: Batch 1" />
      </label>
      <label className="block space-y-2">
        <span className="text-sm font-semibold">Description (optional)</span>
        <input className="field-input" value={description} maxLength={500} onChange={(event) => setDescription(event.target.value)} />
      </label>
      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
        {onDelete ? (
          <button type="button" className="btn-secondary text-danger" onClick={onDelete} disabled={busy}>
            <Trash2 className="h-4 w-4" aria-hidden="true" />
            Delete group
          </button>
        ) : (
          <span />
        )}
        <button type="submit" className="btn-primary" disabled={busy || !name.trim()}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
          {group ? 'Save' : 'Create group'}
        </button>
      </div>
    </form>
  );
}

function MemberPicker({
  group,
  users,
  busy,
  onSave,
}: {
  group: UserGroup;
  users: ManagedUser[];
  busy: boolean;
  onSave: (ids: string[]) => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set(group.memberIds));
  const [query, setQuery] = useState('');
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return users.filter((u) => !needle || u.full_name.toLowerCase().includes(needle) || u.email.toLowerCase().includes(needle));
  }, [users, query]);

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="space-y-4">
      <p className="text-sm">
        <span className="font-semibold">{group.name}</span>
        <span className="text-ink-muted"> · {selected.size} selected</span>
      </p>
      <label className="relative block">
        <span className="sr-only">Search people</span>
        <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" aria-hidden="true" />
        <input className="field-input pl-10" placeholder="Search by name or email" value={query} onChange={(event) => setQuery(event.target.value)} />
      </label>
      <ul className="max-h-[40vh] divide-y divide-line overflow-auto rounded-2xl border border-line">
        {visible.map((user) => (
          <li key={user.id}>
            <label className="flex cursor-pointer items-center gap-3 px-4 py-2.5 hover:bg-muted">
              <input type="checkbox" className="h-4 w-4 accent-primary" checked={selected.has(user.id)} onChange={() => toggle(user.id)} />
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold">{user.full_name}</span>
                <span className="block truncate text-xs text-ink-muted">{user.email}</span>
              </span>
            </label>
          </li>
        ))}
        {visible.length === 0 && <li className="px-4 py-6 text-center text-sm text-ink-muted">No one matches.</li>}
      </ul>
      <div className="flex justify-end">
        <button type="button" className="btn-primary" disabled={busy} onClick={() => onSave([...selected])}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
          Save members
        </button>
      </div>
    </div>
  );
}
