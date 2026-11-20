/*
# Org structure and automatic cycle generation (phases 1 and 2)

Plain-English summary
Everyone is an Employee (or an Administrator). Every employee gives feedback
and is assessed. Who evaluates whom now comes from the org structure: each
person has one immediate manager; the skip-level manager is the manager's
manager. When a cycle opens it creates the evaluations from a snapshot of the
org structure. Admins choose which kinds of evaluation each cycle includes and
can refresh a cycle to pick up org changes.

## 1. Roles
- profiles.role is now 'admin' or 'employee'. Former assessor, talent and
  manager accounts become employees. Manager features come from having direct
  reports in the org structure.

## 2. Org structure (on profiles)
- manager_id: the person's one immediate manager (null at the top of the tree).
  A person cannot be their own manager and reporting loops are refused.
- exclude_rated (nobody evaluates them), exclude_rater (they evaluate nobody),
  exclude_self (no self-assessment). All default false.
- Only administrators, people with edit access to the org structure module
  ('talents') and server code may change these columns.
- Every person has a talents row (created automatically), because assignments
  are made per talent. talents.immediate_manager_id and talent_managers are
  kept as a mirror of manager_id so existing screens keep working.
- Existing manager links (the primary manager) are copied into manager_id.

## 3. Cycle generation
- New assessment kinds: skip_level_manager (the manager's manager rates the
  employee) and skip_level_report (the employee rates their manager's manager).
- assignments.origin: 'auto' (created from the org structure), 'peer'
  (approved peer) or 'manual' (added by hand). Only 'auto' and 'peer' rows are
  ever removed automatically, and only before feedback starts.
- cycles gains switches include_self, include_manager, include_skip_level,
  include_upward, include_upward_skip, include_peers (all on) and
  evaluations_generated_at.
- public.generate_cycle_evaluations(cycle): creates the evaluations that should
  exist and removes automatic ones that no longer should (not started, no
  answers). Runs automatically when a cycle opens; admins and cycle editors can
  run it again ("Refresh"). Returns counts and writes an audit entry.
- The old trigger that created manager assessments the moment a manager was
  linked is removed: open cycles change only through generation.
*/

-- 1. Roles --------------------------------------------------------------------
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
UPDATE public.profiles SET role = 'employee' WHERE role IN ('manager', 'assessor', 'talent');
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check CHECK (role IN ('admin', 'employee'));

-- 2. Org structure ---------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS manager_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS exclude_rated boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS exclude_rater boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS exclude_self boolean NOT NULL DEFAULT false;

DO $$ BEGIN
  ALTER TABLE public.profiles ADD CONSTRAINT profiles_manager_not_self CHECK (manager_id IS NULL OR manager_id <> id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS profiles_manager_id_idx ON public.profiles (manager_id);

-- Every person can be assessed, so every person has a talents row.
INSERT INTO public.talents (profile_id, department, position)
SELECT p.id, p.department, p.position
FROM public.profiles p
WHERE NOT EXISTS (SELECT 1 FROM public.talents t WHERE t.profile_id = p.id);

CREATE OR REPLACE FUNCTION private.ensure_talent_row()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.talents (profile_id, department, position)
  VALUES (NEW.id, NEW.department, NEW.position)
  ON CONFLICT (profile_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_ensure_talent ON public.profiles;
CREATE TRIGGER profiles_ensure_talent
AFTER INSERT ON public.profiles
FOR EACH ROW EXECUTE FUNCTION private.ensure_talent_row();

-- Stop the old "assign the manager immediately" behaviour before reshaping manager links.
DROP TRIGGER IF EXISTS talent_managers_after_insert ON public.talent_managers;
DROP TRIGGER IF EXISTS talent_managers_after_delete ON public.talent_managers;

-- Copy each talent's primary manager into the org structure.
UPDATE public.profiles p
SET manager_id = tm.manager_profile_id
FROM public.talents t
JOIN public.talent_managers tm ON tm.talent_id = t.id AND tm.is_primary
WHERE t.profile_id = p.id AND p.manager_id IS NULL AND tm.manager_profile_id <> p.id;

-- No reporting loops: walking up from the new manager must never reach the person.
CREATE OR REPLACE FUNCTION private.guard_reporting_loop()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_cursor uuid := NEW.manager_id;
  v_steps integer := 0;
BEGIN
  IF NEW.manager_id IS NULL OR NEW.manager_id IS NOT DISTINCT FROM OLD.manager_id THEN
    RETURN NEW;
  END IF;
  WHILE v_cursor IS NOT NULL AND v_steps < 1000 LOOP
    IF v_cursor = NEW.id THEN
      RAISE EXCEPTION 'This would create a reporting loop: someone above this person would report to them.' USING ERRCODE = 'P0001';
    END IF;
    SELECT p.manager_id INTO v_cursor FROM public.profiles p WHERE p.id = v_cursor;
    v_steps := v_steps + 1;
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_guard_reporting_loop ON public.profiles;
CREATE TRIGGER profiles_guard_reporting_loop
BEFORE INSERT OR UPDATE OF manager_id ON public.profiles
FOR EACH ROW EXECUTE FUNCTION private.guard_reporting_loop();

-- Mirror manager_id into talent_managers (exactly one primary row) and talents.immediate_manager_id.
CREATE OR REPLACE FUNCTION private.mirror_reporting_line(p_profile_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_talent uuid;
  v_manager uuid;
BEGIN
  SELECT t.id INTO v_talent FROM public.talents t WHERE t.profile_id = p_profile_id;
  IF v_talent IS NULL THEN
    RETURN;
  END IF;
  SELECT p.manager_id INTO v_manager FROM public.profiles p WHERE p.id = p_profile_id;

  DELETE FROM public.talent_managers tm
  WHERE tm.talent_id = v_talent AND tm.manager_profile_id IS DISTINCT FROM v_manager;
  IF v_manager IS NOT NULL THEN
    INSERT INTO public.talent_managers (talent_id, manager_profile_id, is_primary)
    VALUES (v_talent, v_manager, true)
    ON CONFLICT (talent_id, manager_profile_id) DO UPDATE SET is_primary = true;
  END IF;

  PERFORM set_config('app.talent_manager_sync', 'on', true);
  UPDATE public.talents SET immediate_manager_id = v_manager
  WHERE id = v_talent AND immediate_manager_id IS DISTINCT FROM v_manager;
END;
$$;

CREATE OR REPLACE FUNCTION private.mirror_reporting_line_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM private.mirror_reporting_line(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_mirror_reporting_line ON public.profiles;
CREATE TRIGGER profiles_mirror_reporting_line
AFTER INSERT OR UPDATE OF manager_id ON public.profiles
FOR EACH ROW EXECUTE FUNCTION private.mirror_reporting_line_trigger();

-- Make the mirror consistent for everyone now (removes extra, non-primary managers).
DO $$
DECLARE
  v_profile record;
BEGIN
  FOR v_profile IN SELECT id FROM public.profiles LOOP
    PERFORM private.mirror_reporting_line(v_profile.id);
  END LOOP;
END $$;

-- Only admins, org-structure editors and server code change reporting lines and exclusions.
CREATE OR REPLACE FUNCTION private.guard_profile_privileged_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL OR private.is_admin() THEN
    RETURN NEW;
  END IF;
  IF NEW.role IS DISTINCT FROM OLD.role
     OR NEW.email IS DISTINCT FROM OLD.email
     OR NEW.is_active IS DISTINCT FROM OLD.is_active
     OR NEW.deactivated_at IS DISTINCT FROM OLD.deactivated_at
     OR NEW.deactivated_by IS DISTINCT FROM OLD.deactivated_by THEN
    RAISE EXCEPTION 'Only an administrator can change a role, email or account status.' USING ERRCODE = '42501';
  END IF;
  IF (NEW.manager_id IS DISTINCT FROM OLD.manager_id
      OR NEW.exclude_rated IS DISTINCT FROM OLD.exclude_rated
      OR NEW.exclude_rater IS DISTINCT FROM OLD.exclude_rater
      OR NEW.exclude_self IS DISTINCT FROM OLD.exclude_self)
     AND NOT private.can_edit('talents') THEN
    RAISE EXCEPTION 'You need edit access to the Org structure to change reporting lines or exclusions.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

-- 3. Cycle generation --------------------------------------------------------------
ALTER TABLE public.assignments DROP CONSTRAINT IF EXISTS assignments_classification_check;
ALTER TABLE public.assignments ADD CONSTRAINT assignments_classification_check
  CHECK (classification IN ('self', 'immediate_manager', 'skip_level_manager', 'direct_report', 'skip_level_report', 'peer'));

ALTER TABLE public.assignments
  ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'manual';
DO $$ BEGIN
  ALTER TABLE public.assignments ADD CONSTRAINT assignments_origin_check CHECK (origin IN ('auto', 'peer', 'manual'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT SELECT (origin) ON public.assignments TO authenticated;

ALTER TABLE public.cycles
  ADD COLUMN IF NOT EXISTS include_self boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS include_manager boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS include_skip_level boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS include_upward boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS include_upward_skip boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS include_peers boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS evaluations_generated_at timestamptz;

-- Peers chosen by admins and managers (and approved suggestions) are stored per person.
CREATE TABLE IF NOT EXISTS public.peer_relationships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  peer_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'suggested' CHECK (status IN ('suggested', 'approved', 'rejected')),
  suggested_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  decided_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id, peer_id),
  CHECK (employee_id <> peer_id)
);
ALTER TABLE public.peer_relationships ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.peer_relationships FROM anon;

/** The evaluations a cycle should have, from the org structure and approved peers. */
CREATE OR REPLACE FUNCTION private.desired_evaluations(p_cycle_id uuid)
RETURNS TABLE (talent_id uuid, assessor_id uuid, classification text, origin text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH c AS (SELECT * FROM public.cycles WHERE id = p_cycle_id),
  people AS (
    SELECT p.id, p.manager_id, m.manager_id AS skip_id, p.exclude_rated, p.exclude_rater, p.exclude_self, t.id AS talent_id
    FROM public.profiles p
    JOIN public.talents t ON t.profile_id = p.id
    LEFT JOIN public.profiles m ON m.id = p.manager_id
    WHERE p.is_active
  ),
  raters AS (
    SELECT p.id, p.exclude_rater FROM public.profiles p WHERE p.is_active
  ),
  pairs AS (
    -- Self
    SELECT pe.talent_id, pe.id AS assessor_id, 'self' AS classification, 'auto' AS origin
    FROM people pe, c WHERE c.include_self AND NOT pe.exclude_self
    UNION ALL
    -- Manager rates the employee
    SELECT pe.talent_id, pe.manager_id, 'immediate_manager', 'auto'
    FROM people pe, c WHERE c.include_manager AND pe.manager_id IS NOT NULL AND NOT pe.exclude_rated
    UNION ALL
    -- Skip-level manager rates the employee
    SELECT pe.talent_id, pe.skip_id, 'skip_level_manager', 'auto'
    FROM people pe, c WHERE c.include_skip_level AND pe.skip_id IS NOT NULL AND NOT pe.exclude_rated
    UNION ALL
    -- The employee rates their manager (as a direct report)
    SELECT mgr.talent_id, pe.id, 'direct_report', 'auto'
    FROM people pe JOIN people mgr ON mgr.id = pe.manager_id, c
    WHERE c.include_upward AND NOT mgr.exclude_rated
    UNION ALL
    -- The employee rates their manager's manager
    SELECT skip.talent_id, pe.id, 'skip_level_report', 'auto'
    FROM people pe JOIN people skip ON skip.id = pe.skip_id, c
    WHERE c.include_upward_skip AND NOT skip.exclude_rated
    UNION ALL
    -- Approved peers
    SELECT pe.talent_id, pr.peer_id, 'peer', 'peer'
    FROM public.peer_relationships pr JOIN people pe ON pe.id = pr.employee_id, c
    WHERE c.include_peers AND pr.status = 'approved' AND NOT pe.exclude_rated
  )
  SELECT DISTINCT ON (pa.talent_id, pa.assessor_id) pa.talent_id, pa.assessor_id, pa.classification, pa.origin
  FROM pairs pa
  JOIN raters r ON r.id = pa.assessor_id
  WHERE pa.assessor_id IS NOT NULL
    AND (pa.classification = 'self' OR NOT r.exclude_rater)
  -- If two relationships give the same pair, keep the closest one.
  ORDER BY pa.talent_id, pa.assessor_id,
    array_position(ARRAY['self', 'immediate_manager', 'direct_report', 'skip_level_manager', 'skip_level_report', 'peer'], pa.classification);
$$;

CREATE OR REPLACE FUNCTION public.generate_cycle_evaluations(p_cycle_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_status text;
  v_added integer := 0;
  v_removed integer := 0;
  v_kept integer := 0;
BEGIN
  IF NOT (auth.uid() IS NULL OR private.can_edit('cycles')) THEN
    RAISE EXCEPTION 'You need edit access to Cycles to generate evaluations.' USING ERRCODE = '42501';
  END IF;
  SELECT status INTO v_status FROM public.cycles WHERE id = p_cycle_id FOR UPDATE;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'This cycle could not be found.' USING ERRCODE = 'P0002';
  END IF;
  IF v_status = 'closed' THEN
    RAISE EXCEPTION 'This cycle is closed, so its evaluations can no longer change.' USING ERRCODE = 'P0001';
  END IF;

  -- Remove automatic evaluations that should no longer exist, but only before any feedback.
  WITH stale AS (
    SELECT a.id FROM public.assignments a
    WHERE a.cycle_id = p_cycle_id
      AND a.origin IN ('auto', 'peer')
      AND a.status = 'not_started'
      AND NOT EXISTS (SELECT 1 FROM public.responses r WHERE r.assignment_id = a.id)
      AND NOT EXISTS (
        SELECT 1 FROM private.desired_evaluations(p_cycle_id) d
        WHERE d.talent_id = a.talent_id AND d.assessor_id = a.assessor_id AND d.classification = a.classification
      )
  ), cleared AS (
    UPDATE public.notifications SET assignment_id = NULL WHERE assignment_id IN (SELECT id FROM stale) RETURNING 1
  ), deleted AS (
    DELETE FROM public.assignments WHERE id IN (SELECT id FROM stale) RETURNING 1
  )
  SELECT count(*) INTO v_removed FROM deleted;

  -- Add the evaluations that are missing. A pair that already exists (for example added by hand) is kept as it is.
  WITH added AS (
    INSERT INTO public.assignments (cycle_id, talent_id, assessor_id, classification, origin)
    SELECT p_cycle_id, d.talent_id, d.assessor_id, d.classification, d.origin
    FROM private.desired_evaluations(p_cycle_id) d
    ON CONFLICT (cycle_id, talent_id, assessor_id) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_added FROM added;

  SELECT count(*) INTO v_kept FROM public.assignments WHERE cycle_id = p_cycle_id;
  UPDATE public.cycles SET evaluations_generated_at = now() WHERE id = p_cycle_id;

  INSERT INTO public.audit_log (actor_id, action, entity, entity_id, details, source)
  VALUES (auth.uid(), 'cycle.evaluations_generated', 'cycles', p_cycle_id::text,
    jsonb_build_object('added', v_added, 'removed', v_removed, 'total', v_kept), 'app');

  RETURN jsonb_build_object('added', v_added, 'removed', v_removed, 'total', v_kept);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.generate_cycle_evaluations(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.generate_cycle_evaluations(uuid) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION private.desired_evaluations(uuid) FROM PUBLIC, anon, authenticated;

-- Opening a cycle (by an admin or the scheduler) takes the snapshot.
CREATE OR REPLACE FUNCTION private.generate_on_open()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM public.generate_cycle_evaluations(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cycles_generate_on_open ON public.cycles;
CREATE TRIGGER cycles_generate_on_open
AFTER UPDATE OF status ON public.cycles
FOR EACH ROW
WHEN (NEW.status = 'open' AND OLD.status IS DISTINCT FROM 'open')
EXECUTE FUNCTION private.generate_on_open();

-- The self-assessment rule still holds; skip-level kinds are allowed for anyone else.
DROP TRIGGER IF EXISTS audit_row_change ON public.peer_relationships;
CREATE TRIGGER audit_row_change AFTER INSERT OR UPDATE OR DELETE ON public.peer_relationships
FOR EACH ROW EXECUTE FUNCTION private.audit_row_change();
