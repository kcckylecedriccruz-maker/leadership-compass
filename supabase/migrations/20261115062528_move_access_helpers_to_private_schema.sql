/*
# Move access-check helpers to a private schema

Plain-English summary
The internal checks used by the access rules were callable directly through the public web API. This migration moves them into a private schema that the web API does not expose, and recreates the access rules so they use the new location. The rules themselves do not change.

## 1. New schema
- private: holds internal access checks. Only signed-in users may use it, and it is not exposed through the public API.

## 2. Moved functions (now in the private schema)
- is_admin, manages_talent, is_assessor_of_talent, can_read_profile, can_read_cycle, is_assignment_assessor, is_assignment_editable_by_me.
- Old copies in the public schema are removed.

## 3. Recreated policies
- Every policy from the access rules migration is dropped and recreated with the same conditions, now pointing at the private functions.

## 4. Unchanged
- complete_password_change stays in the public schema because the app calls it on purpose. It only ever changes the signed-in user's own flag.
- Table grants are unchanged.

## Important notes
1. Policies are dropped and recreated in the same migration so there is no gap in which access is wrongly open or closed.
*/

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA private TO authenticated;

DROP POLICY IF EXISTS "profiles_select" ON public.profiles;
DROP POLICY IF EXISTS "profiles_insert_admin" ON public.profiles;
DROP POLICY IF EXISTS "profiles_update_admin" ON public.profiles;
DROP POLICY IF EXISTS "profiles_delete_admin" ON public.profiles;
DROP POLICY IF EXISTS "talents_select" ON public.talents;
DROP POLICY IF EXISTS "talents_insert_admin" ON public.talents;
DROP POLICY IF EXISTS "talents_update_admin" ON public.talents;
DROP POLICY IF EXISTS "talents_delete_admin" ON public.talents;
DROP POLICY IF EXISTS "cycles_select" ON public.cycles;
DROP POLICY IF EXISTS "cycles_insert_admin" ON public.cycles;
DROP POLICY IF EXISTS "cycles_update_admin" ON public.cycles;
DROP POLICY IF EXISTS "cycles_delete_admin" ON public.cycles;
DROP POLICY IF EXISTS "assignments_select" ON public.assignments;
DROP POLICY IF EXISTS "assignments_insert" ON public.assignments;
DROP POLICY IF EXISTS "assignments_update_admin" ON public.assignments;
DROP POLICY IF EXISTS "assignments_delete_admin" ON public.assignments;
DROP POLICY IF EXISTS "responses_select_own" ON public.responses;
DROP POLICY IF EXISTS "responses_insert_own_open" ON public.responses;
DROP POLICY IF EXISTS "responses_update_own_open" ON public.responses;
DROP POLICY IF EXISTS "responses_delete_own_open" ON public.responses;
DROP POLICY IF EXISTS "notifications_select_admin" ON public.notifications;
DROP POLICY IF EXISTS "audit_log_select_admin" ON public.audit_log;

DROP FUNCTION IF EXISTS public.is_admin();
DROP FUNCTION IF EXISTS public.manages_talent(uuid);
DROP FUNCTION IF EXISTS public.is_assessor_of_talent(uuid);
DROP FUNCTION IF EXISTS public.can_read_profile(uuid);
DROP FUNCTION IF EXISTS public.can_read_cycle(uuid);
DROP FUNCTION IF EXISTS public.is_assignment_assessor(uuid);
DROP FUNCTION IF EXISTS public.is_assignment_editable_by_me(uuid);

CREATE OR REPLACE FUNCTION private.is_admin()
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

CREATE OR REPLACE FUNCTION private.manages_talent(p_talent_id uuid)
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

CREATE OR REPLACE FUNCTION private.is_assessor_of_talent(p_talent_id uuid)
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

CREATE OR REPLACE FUNCTION private.can_read_profile(p_profile_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p_profile_id = auth.uid()
    OR private.is_admin()
    OR EXISTS (
      SELECT 1 FROM public.talents t
      WHERE t.profile_id = p_profile_id
        AND (t.immediate_manager_id = auth.uid() OR private.is_assessor_of_talent(t.id))
    );
$$;

CREATE OR REPLACE FUNCTION private.can_read_cycle(p_cycle_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT private.is_admin()
    OR EXISTS (
      SELECT 1 FROM public.assignments a
      WHERE a.cycle_id = p_cycle_id
        AND (a.assessor_id = auth.uid() OR private.manages_talent(a.talent_id))
    );
$$;

CREATE OR REPLACE FUNCTION private.is_assignment_assessor(p_assignment_id uuid)
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

CREATE OR REPLACE FUNCTION private.is_assignment_editable_by_me(p_assignment_id uuid)
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

REVOKE EXECUTE ON FUNCTION private.is_admin() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION private.manages_talent(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION private.is_assessor_of_talent(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION private.can_read_profile(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION private.can_read_cycle(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION private.is_assignment_assessor(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION private.is_assignment_editable_by_me(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION private.is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION private.manages_talent(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.is_assessor_of_talent(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.can_read_profile(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.can_read_cycle(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.is_assignment_assessor(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.is_assignment_editable_by_me(uuid) TO authenticated;

CREATE POLICY "profiles_select" ON public.profiles FOR SELECT
  TO authenticated USING (private.can_read_profile(id));
CREATE POLICY "profiles_insert_admin" ON public.profiles FOR INSERT
  TO authenticated WITH CHECK (private.is_admin());
CREATE POLICY "profiles_update_admin" ON public.profiles FOR UPDATE
  TO authenticated USING (private.is_admin()) WITH CHECK (private.is_admin());
CREATE POLICY "profiles_delete_admin" ON public.profiles FOR DELETE
  TO authenticated USING (private.is_admin());

CREATE POLICY "talents_select" ON public.talents FOR SELECT
  TO authenticated USING (
    private.is_admin() OR immediate_manager_id = auth.uid() OR private.is_assessor_of_talent(id)
  );
CREATE POLICY "talents_insert_admin" ON public.talents FOR INSERT
  TO authenticated WITH CHECK (private.is_admin());
CREATE POLICY "talents_update_admin" ON public.talents FOR UPDATE
  TO authenticated USING (private.is_admin()) WITH CHECK (private.is_admin());
CREATE POLICY "talents_delete_admin" ON public.talents FOR DELETE
  TO authenticated USING (private.is_admin());

CREATE POLICY "cycles_select" ON public.cycles FOR SELECT
  TO authenticated USING (private.can_read_cycle(id));
CREATE POLICY "cycles_insert_admin" ON public.cycles FOR INSERT
  TO authenticated WITH CHECK (private.is_admin());
CREATE POLICY "cycles_update_admin" ON public.cycles FOR UPDATE
  TO authenticated USING (private.is_admin()) WITH CHECK (private.is_admin());
CREATE POLICY "cycles_delete_admin" ON public.cycles FOR DELETE
  TO authenticated USING (private.is_admin());

CREATE POLICY "assignments_select" ON public.assignments FOR SELECT
  TO authenticated USING (
    private.is_admin() OR assessor_id = auth.uid() OR private.manages_talent(talent_id)
  );
CREATE POLICY "assignments_insert" ON public.assignments FOR INSERT
  TO authenticated WITH CHECK (private.is_admin() OR private.manages_talent(talent_id));
CREATE POLICY "assignments_update_admin" ON public.assignments FOR UPDATE
  TO authenticated USING (private.is_admin()) WITH CHECK (private.is_admin());
CREATE POLICY "assignments_delete_admin" ON public.assignments FOR DELETE
  TO authenticated USING (private.is_admin());

CREATE POLICY "responses_select_own" ON public.responses FOR SELECT
  TO authenticated USING (private.is_assignment_assessor(assignment_id));
CREATE POLICY "responses_insert_own_open" ON public.responses FOR INSERT
  TO authenticated WITH CHECK (private.is_assignment_editable_by_me(assignment_id));
CREATE POLICY "responses_update_own_open" ON public.responses FOR UPDATE
  TO authenticated
  USING (private.is_assignment_editable_by_me(assignment_id))
  WITH CHECK (private.is_assignment_editable_by_me(assignment_id));
CREATE POLICY "responses_delete_own_open" ON public.responses FOR DELETE
  TO authenticated USING (private.is_assignment_editable_by_me(assignment_id));

CREATE POLICY "notifications_select_admin" ON public.notifications FOR SELECT
  TO authenticated USING (private.is_admin());
CREATE POLICY "audit_log_select_admin" ON public.audit_log FOR SELECT
  TO authenticated USING (private.is_admin());
