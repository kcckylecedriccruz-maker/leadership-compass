/*
# User groups

Plain-English summary
People can be put into named groups (for example a department, a batch or a
programme cohort) so admins can find, filter and manage them together. A person
can be in any number of groups. Groups are also filled from the bulk upload.

## New tables
- user_groups: id, name (unique, case-insensitive), description, created_at, created_by.
- user_group_members: group_id + profile_id (primary key), added_at, added_by.
  Removing a group removes its memberships; people are never deleted.

## Security
- Row-level security on both tables.
- Read: anyone who can view the Users or People module, and each person can see
  the groups they belong to.
- Write: anyone with edit access to the Users module (admins always).
- Every insert, update and delete is written to the audit trail.
*/

CREATE TABLE IF NOT EXISTS public.user_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 100),
  description text CHECK (description IS NULL OR length(description) <= 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS user_groups_name_unique ON public.user_groups (lower(btrim(name)));

CREATE TABLE IF NOT EXISTS public.user_group_members (
  group_id uuid NOT NULL REFERENCES public.user_groups(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  added_at timestamptz NOT NULL DEFAULT now(),
  added_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  PRIMARY KEY (group_id, profile_id)
);

CREATE INDEX IF NOT EXISTS user_group_members_profile_idx ON public.user_group_members (profile_id);

ALTER TABLE public.user_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_group_members ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.user_groups, public.user_group_members FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_groups, public.user_group_members TO authenticated;

DROP POLICY IF EXISTS user_groups_select ON public.user_groups;
CREATE POLICY user_groups_select ON public.user_groups FOR SELECT TO authenticated
  USING (
    private.can_view('users') OR private.can_view('people')
    OR EXISTS (SELECT 1 FROM public.user_group_members m WHERE m.group_id = id AND m.profile_id = auth.uid())
  );

DROP POLICY IF EXISTS user_groups_write ON public.user_groups;
CREATE POLICY user_groups_write ON public.user_groups FOR ALL TO authenticated
  USING (private.can_edit('users')) WITH CHECK (private.can_edit('users'));

DROP POLICY IF EXISTS user_group_members_select ON public.user_group_members;
CREATE POLICY user_group_members_select ON public.user_group_members FOR SELECT TO authenticated
  USING (private.can_view('users') OR private.can_view('people') OR profile_id = auth.uid());

DROP POLICY IF EXISTS user_group_members_write ON public.user_group_members;
CREATE POLICY user_group_members_write ON public.user_group_members FOR ALL TO authenticated
  USING (private.can_edit('users')) WITH CHECK (private.can_edit('users'));

DROP TRIGGER IF EXISTS audit_row_change ON public.user_groups;
CREATE TRIGGER audit_row_change AFTER INSERT OR UPDATE OR DELETE ON public.user_groups
FOR EACH ROW EXECUTE FUNCTION private.audit_row_change();

DROP TRIGGER IF EXISTS audit_row_change ON public.user_group_members;
CREATE TRIGGER audit_row_change AFTER INSERT OR UPDATE OR DELETE ON public.user_group_members
FOR EACH ROW EXECUTE FUNCTION private.audit_row_change();
