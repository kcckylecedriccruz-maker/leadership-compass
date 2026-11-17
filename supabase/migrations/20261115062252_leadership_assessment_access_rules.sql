/*
# Leadership assessment access rules

Plain-English summary
This migration decides who can see and change each piece of data. Admins manage the core records. Managers see and create assignments for the people they manage. Assessors see only their own assignments and their own written responses, and can only write responses while the assignment is still open for editing.

## 1. Helper checks
Small private checks used by the access rules: whether the signed-in person is an admin, manages a talent, is assessing a talent, is the assessor for an assignment, and whether an assignment is still editable. They run with elevated rights so the rules never re-check themselves in a loop. Only signed-in users may run them.

## 2. Password change
- complete_password_change(): clears the must-change-password flag for the signed-in user only. Users cannot edit their own role or any other profile field.

## 3. Policies by table
- profiles: a person sees their own profile; admins see all; managers and assessors see profiles of people they manage or assess. Only admins create, change or delete profiles.
- talents: admins manage. Managers and assessors can read talents they manage or are assessing.
- cycles: admins manage. Managers and assessors can read cycles they are involved in.
- competencies: all signed-in users can read the framework. Nobody can edit it through the app.
- assignments: admins manage. Managers can read and create assignments for their talents. Assessors can read their own assignments. The edit token hash is hidden from the app.
- responses: only the assessor who wrote them can read, add, change or delete them, and only while the assignment is not submitted and the cycle is open. Admins and everyone else cannot read responses.
- notifications and audit_log: admins can read. Writes happen from trusted server code only.

## 4. Grants
- Only the signed-in role receives privileges, and only the verbs and columns each policy needs.
- The anonymous role has no access to any of these tables.

## Important notes
1. Helper checks are not callable by anonymous visitors.
2. Column-level grants mean the app must name the columns it reads rather than selecting everything.
*/

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'
  );
$$;

CREATE OR REPLACE FUNCTION public.manages_talent(p_talent_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.talents t WHERE t.id = p_talent_id AND t.immediate_manager_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.is_assessor_of_talent(p_talent_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.assignments a WHERE a.talent_id = p_talent_id AND a.assessor_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.can_read_profile(p_profile_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p_profile_id = auth.uid()
    OR public.is_admin()
    OR EXISTS (
      SELECT 1 FROM public.talents t
      WHERE t.profile_id = p_profile_id
        AND (t.immediate_manager_id = auth.uid() OR public.is_assessor_of_talent(t.id))
    );
$$;

CREATE OR REPLACE FUNCTION public.can_read_cycle(p_cycle_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.is_admin()
    OR EXISTS (
      SELECT 1 FROM public.assignments a
      WHERE a.cycle_id = p_cycle_id
        AND (a.assessor_id = auth.uid() OR public.manages_talent(a.talent_id))
    );
$$;

CREATE OR REPLACE FUNCTION public.is_assignment_assessor(p_assignment_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.assignments a WHERE a.id = p_assignment_id AND a.assessor_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.is_assignment_editable_by_me(p_assignment_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.assignments a
    JOIN public.cycles c ON c.id = a.cycle_id
    WHERE a.id = p_assignment_id
      AND a.assessor_id = auth.uid()
      AND a.status <> 'submitted'
      AND c.status = 'open'
  );
$$;

CREATE OR REPLACE FUNCTION public.complete_password_change()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  UPDATE public.profiles SET must_change_password = false WHERE id = auth.uid();
$$;

REVOKE EXECUTE ON FUNCTION public.is_admin() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.manages_talent(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_assessor_of_talent(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.can_read_profile(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.can_read_cycle(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_assignment_assessor(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_assignment_editable_by_me(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.complete_password_change() FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.manages_talent(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_assessor_of_talent(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_read_profile(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_read_cycle(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_assignment_assessor(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_assignment_editable_by_me(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_password_change() TO authenticated;

-- profiles
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;

DROP POLICY IF EXISTS "profiles_select" ON public.profiles;
CREATE POLICY "profiles_select" ON public.profiles FOR SELECT
  TO authenticated USING (public.can_read_profile(id));

DROP POLICY IF EXISTS "profiles_insert_admin" ON public.profiles;
CREATE POLICY "profiles_insert_admin" ON public.profiles FOR INSERT
  TO authenticated WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "profiles_update_admin" ON public.profiles;
CREATE POLICY "profiles_update_admin" ON public.profiles FOR UPDATE
  TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "profiles_delete_admin" ON public.profiles;
CREATE POLICY "profiles_delete_admin" ON public.profiles FOR DELETE
  TO authenticated USING (public.is_admin());

-- talents
GRANT SELECT, INSERT, UPDATE, DELETE ON public.talents TO authenticated;

DROP POLICY IF EXISTS "talents_select" ON public.talents;
CREATE POLICY "talents_select" ON public.talents FOR SELECT
  TO authenticated USING (
    public.is_admin() OR immediate_manager_id = auth.uid() OR public.is_assessor_of_talent(id)
  );

DROP POLICY IF EXISTS "talents_insert_admin" ON public.talents;
CREATE POLICY "talents_insert_admin" ON public.talents FOR INSERT
  TO authenticated WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "talents_update_admin" ON public.talents;
CREATE POLICY "talents_update_admin" ON public.talents FOR UPDATE
  TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "talents_delete_admin" ON public.talents;
CREATE POLICY "talents_delete_admin" ON public.talents FOR DELETE
  TO authenticated USING (public.is_admin());

-- cycles
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cycles TO authenticated;

DROP POLICY IF EXISTS "cycles_select" ON public.cycles;
CREATE POLICY "cycles_select" ON public.cycles FOR SELECT
  TO authenticated USING (public.can_read_cycle(id));

DROP POLICY IF EXISTS "cycles_insert_admin" ON public.cycles;
CREATE POLICY "cycles_insert_admin" ON public.cycles FOR INSERT
  TO authenticated WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "cycles_update_admin" ON public.cycles;
CREATE POLICY "cycles_update_admin" ON public.cycles FOR UPDATE
  TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "cycles_delete_admin" ON public.cycles;
CREATE POLICY "cycles_delete_admin" ON public.cycles FOR DELETE
  TO authenticated USING (public.is_admin());

-- competencies (shared reference data, read-only in the app)
GRANT SELECT ON public.competencies TO authenticated;

DROP POLICY IF EXISTS "competencies_select" ON public.competencies;
CREATE POLICY "competencies_select" ON public.competencies FOR SELECT
  TO authenticated USING (true);

-- assignments (edit_token_hash is deliberately not granted to the app)
GRANT SELECT (id, cycle_id, talent_id, assessor_id, classification, status, submitted_at, last_reminded_at, copy_requested)
  ON public.assignments TO authenticated;
GRANT INSERT (cycle_id, talent_id, assessor_id, classification) ON public.assignments TO authenticated;
GRANT UPDATE (cycle_id, talent_id, assessor_id, classification, status, submitted_at, last_reminded_at, copy_requested)
  ON public.assignments TO authenticated;
GRANT DELETE ON public.assignments TO authenticated;

DROP POLICY IF EXISTS "assignments_select" ON public.assignments;
CREATE POLICY "assignments_select" ON public.assignments FOR SELECT
  TO authenticated USING (
    public.is_admin() OR assessor_id = auth.uid() OR public.manages_talent(talent_id)
  );

DROP POLICY IF EXISTS "assignments_insert" ON public.assignments;
CREATE POLICY "assignments_insert" ON public.assignments FOR INSERT
  TO authenticated WITH CHECK (public.is_admin() OR public.manages_talent(talent_id));

DROP POLICY IF EXISTS "assignments_update_admin" ON public.assignments;
CREATE POLICY "assignments_update_admin" ON public.assignments FOR UPDATE
  TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "assignments_delete_admin" ON public.assignments;
CREATE POLICY "assignments_delete_admin" ON public.assignments FOR DELETE
  TO authenticated USING (public.is_admin());

-- responses (visible and writable only by the assessor who wrote them)
GRANT SELECT ON public.responses TO authenticated;
GRANT INSERT (assignment_id, competency_id, rating, behaviour_note) ON public.responses TO authenticated;
GRANT UPDATE (rating, behaviour_note) ON public.responses TO authenticated;
GRANT DELETE ON public.responses TO authenticated;

DROP POLICY IF EXISTS "responses_select_own" ON public.responses;
CREATE POLICY "responses_select_own" ON public.responses FOR SELECT
  TO authenticated USING (public.is_assignment_assessor(assignment_id));

DROP POLICY IF EXISTS "responses_insert_own_open" ON public.responses;
CREATE POLICY "responses_insert_own_open" ON public.responses FOR INSERT
  TO authenticated WITH CHECK (public.is_assignment_editable_by_me(assignment_id));

DROP POLICY IF EXISTS "responses_update_own_open" ON public.responses;
CREATE POLICY "responses_update_own_open" ON public.responses FOR UPDATE
  TO authenticated
  USING (public.is_assignment_editable_by_me(assignment_id))
  WITH CHECK (public.is_assignment_editable_by_me(assignment_id));

DROP POLICY IF EXISTS "responses_delete_own_open" ON public.responses;
CREATE POLICY "responses_delete_own_open" ON public.responses FOR DELETE
  TO authenticated USING (public.is_assignment_editable_by_me(assignment_id));

-- notifications and audit log (admin read only; writes come from trusted server code)
GRANT SELECT ON public.notifications TO authenticated;
GRANT SELECT ON public.audit_log TO authenticated;

DROP POLICY IF EXISTS "notifications_select_admin" ON public.notifications;
CREATE POLICY "notifications_select_admin" ON public.notifications FOR SELECT
  TO authenticated USING (public.is_admin());

DROP POLICY IF EXISTS "audit_log_select_admin" ON public.audit_log;
CREATE POLICY "audit_log_select_admin" ON public.audit_log FOR SELECT
  TO authenticated USING (public.is_admin());
