/*
# Module access, report functions and user creation fixes

Plain-English summary
Administrators can now give any person view or edit access to each workspace
module. Access is enforced by the database (row-level security and the
existing RPCs) and by the edge functions, not just hidden in the screen. This
migration also adds the three report functions the Dashboard and Report screens
call, which were missing, and fixes account activation bookkeeping.

## 1. Module access
- New table module_access (profile_id, module, level). Modules: dashboard,
  cycles, people, talents, assignments, users, audit, settings. Levels: view, edit.
- Active administrators always have edit on every module; rows only matter for
  other roles. Deactivated people have no access.
- private.module_level(module) for the signed-in user: 0 none, 1 view, 2 edit.
  private.can_view(module) / private.can_edit(module) wrap it.
- public.module_level_for(profile, module) is for edge functions (service role only).
- Extra permissive policies grant SELECT (view) or writes (edit) per module.
- set_talent_managers needs talents edit; set_assignment_classification,
  remove_assignment and cycle_coverage_gaps need assignments or cycles edit.
- A guard trigger stops anyone but an administrator (or server code) changing a
  profile's role, email or active state, so talents editors can rename people
  without being able to promote anyone.

## 2. Report functions (Dashboard and Report)
- competency_scores(cycle): per talent and competency, average ratings by
  assessor group from submitted forms. Peer and direct-report groups below the
  cycle's minimum group size are hidden. Others = every non-self rating.
  Gap to target = 5 - others. Band: Strength >= 4, Developing >= 3, else
  Development need. Perception: Blind spot when self is 1+ above others,
  Hidden strength when 1+ below, otherwise Aligned.
- readiness_ranking(cycle): average gap per category and overall, number of
  categories with a gap above 1, status (Ready, Developing, Not yet ready,
  Insufficient feedback) and rank by overall gap.
- behaviour_notes(cycle, talent): submitted notes, excluding groups below the
  minimum size. All three only return talents the caller may see.

## 3. Activation
- complete_password_change also sets activated_at, and existing accounts that
  already chose their own password are back-filled as activated.
*/

-- 1. Module access -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.module_access (
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  module text NOT NULL CHECK (module IN ('dashboard', 'cycles', 'people', 'talents', 'assignments', 'users', 'audit', 'settings')),
  level text NOT NULL CHECK (level IN ('view', 'edit')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  PRIMARY KEY (profile_id, module)
);

ALTER TABLE public.module_access ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.module_access FROM anon, authenticated;
GRANT SELECT ON public.module_access TO authenticated;

CREATE OR REPLACE FUNCTION public.module_level_for(p_profile_id uuid, p_module text)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p.id IS NULL OR NOT p.is_active THEN 0
    WHEN p.role = 'admin' THEN 2
    ELSE COALESCE((
      SELECT CASE m.level WHEN 'edit' THEN 2 WHEN 'view' THEN 1 ELSE 0 END
      FROM public.module_access m
      WHERE m.profile_id = p.id AND m.module = p_module
    ), 0)
  END
  FROM (SELECT 1) one
  LEFT JOIN public.profiles p ON p.id = p_profile_id;
$$;

REVOKE EXECUTE ON FUNCTION public.module_level_for(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.module_level_for(uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION private.module_level(p_module text)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE WHEN auth.uid() IS NULL THEN 0 ELSE public.module_level_for(auth.uid(), p_module) END;
$$;

CREATE OR REPLACE FUNCTION private.can_view(p_module text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$ SELECT private.module_level(p_module) >= 1; $$;

CREATE OR REPLACE FUNCTION private.can_edit(p_module text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$ SELECT private.module_level(p_module) >= 2; $$;

REVOKE EXECUTE ON FUNCTION private.module_level(text), private.can_view(text), private.can_edit(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.module_level(text), private.can_view(text), private.can_edit(text) TO authenticated;

DROP POLICY IF EXISTS module_access_select ON public.module_access;
CREATE POLICY module_access_select ON public.module_access FOR SELECT TO authenticated
  USING (profile_id = auth.uid() OR private.can_view('users'));

-- Extra read access per module (policies are OR-ed with the existing ones).
DROP POLICY IF EXISTS profiles_select_modules ON public.profiles;
CREATE POLICY profiles_select_modules ON public.profiles FOR SELECT TO authenticated
  USING (private.can_view('people') OR private.can_view('users') OR private.can_view('talents')
         OR private.can_view('assignments') OR private.can_view('dashboard'));

DROP POLICY IF EXISTS talents_select_modules ON public.talents;
CREATE POLICY talents_select_modules ON public.talents FOR SELECT TO authenticated
  USING (private.can_view('people') OR private.can_view('talents') OR private.can_view('assignments') OR private.can_view('dashboard'));

DROP POLICY IF EXISTS talent_managers_select_modules ON public.talent_managers;
CREATE POLICY talent_managers_select_modules ON public.talent_managers FOR SELECT TO authenticated
  USING (private.can_view('people') OR private.can_view('talents') OR private.can_view('assignments') OR private.can_view('dashboard'));

DROP POLICY IF EXISTS assignments_select_modules ON public.assignments;
CREATE POLICY assignments_select_modules ON public.assignments FOR SELECT TO authenticated
  USING (private.can_view('people') OR private.can_view('assignments') OR private.can_view('dashboard'));

DROP POLICY IF EXISTS cycles_select_modules ON public.cycles;
CREATE POLICY cycles_select_modules ON public.cycles FOR SELECT TO authenticated
  USING (private.can_view('cycles') OR private.can_view('dashboard') OR private.can_view('assignments') OR private.can_view('talents'));

DROP POLICY IF EXISTS audit_log_select_modules ON public.audit_log;
CREATE POLICY audit_log_select_modules ON public.audit_log FOR SELECT TO authenticated
  USING (private.can_view('audit') OR (action = 'auth.sign_in' AND private.can_view('users')));

DROP POLICY IF EXISTS notifications_select_modules ON public.notifications;
CREATE POLICY notifications_select_modules ON public.notifications FOR SELECT TO authenticated
  USING (private.can_view('settings') OR private.can_view('people'));

DROP POLICY IF EXISTS app_settings_select_modules ON public.app_settings;
CREATE POLICY app_settings_select_modules ON public.app_settings FOR SELECT TO authenticated
  USING (private.can_view('settings'));

DROP POLICY IF EXISTS email_templates_select_modules ON public.email_templates;
CREATE POLICY email_templates_select_modules ON public.email_templates FOR SELECT TO authenticated
  USING (private.can_view('settings'));

-- Writes per module.
DROP POLICY IF EXISTS cycles_insert_modules ON public.cycles;
CREATE POLICY cycles_insert_modules ON public.cycles FOR INSERT TO authenticated
  WITH CHECK (private.can_edit('cycles'));
DROP POLICY IF EXISTS cycles_update_modules ON public.cycles;
CREATE POLICY cycles_update_modules ON public.cycles FOR UPDATE TO authenticated
  USING (private.can_edit('cycles')) WITH CHECK (private.can_edit('cycles'));

DROP POLICY IF EXISTS talents_update_modules ON public.talents;
CREATE POLICY talents_update_modules ON public.talents FOR UPDATE TO authenticated
  USING (private.can_edit('talents')) WITH CHECK (private.can_edit('talents'));

DROP POLICY IF EXISTS profiles_update_modules ON public.profiles;
CREATE POLICY profiles_update_modules ON public.profiles FOR UPDATE TO authenticated
  USING (private.can_edit('talents') OR private.can_edit('users'))
  WITH CHECK (private.can_edit('talents') OR private.can_edit('users'));

-- Only administrators (or server code) may change who someone is or what they can do.
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
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_profile_privileged_columns ON public.profiles;
CREATE TRIGGER guard_profile_privileged_columns
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION private.guard_profile_privileged_columns();

-- Point the existing admin-only RPCs at module edit rights. Each rewrite must
-- find its check, so a changed function body fails loudly instead of silently.
DO $$
DECLARE
  def text;
  rewritten text;
  item record;
BEGIN
  FOR item IN
    SELECT * FROM (VALUES
      ('public.set_talent_managers(uuid, uuid[], uuid)', 'IF NOT private.is_admin() THEN', 'IF NOT private.can_edit(''talents'') THEN'),
      ('public.set_assignment_classification(uuid, text)', 'IF NOT private.is_admin() THEN', 'IF NOT private.can_edit(''assignments'') THEN'),
      ('public.remove_assignment(uuid)', 'IF NOT private.is_admin() THEN', 'IF NOT private.can_edit(''assignments'') THEN'),
      ('public.cycle_coverage_gaps(uuid)', 'private.is_admin()', '(private.can_edit(''cycles'') OR private.can_view(''assignments''))')
    ) AS t(signature, old_text, new_text)
  LOOP
    def := pg_get_functiondef(item.signature::regprocedure);
    rewritten := replace(def, item.old_text, item.new_text);
    IF rewritten = def THEN
      RAISE EXCEPTION 'Could not find the permission check in %', item.signature;
    END IF;
    EXECUTE rewritten;
  END LOOP;

  def := pg_get_functiondef('private.can_view_talent_report(uuid)'::regprocedure);
  rewritten := replace(def, 'SELECT private.is_admin()', 'SELECT private.is_admin() OR private.can_view(''dashboard'')');
  IF rewritten = def THEN
    RAISE EXCEPTION 'Could not find the permission check in private.can_view_talent_report';
  END IF;
  EXECUTE rewritten;
END $$;

-- Module access changes are part of the audit trail.
DROP TRIGGER IF EXISTS audit_row_change ON public.module_access;
CREATE TRIGGER audit_row_change AFTER INSERT OR UPDATE OR DELETE ON public.module_access
FOR EACH ROW EXECUTE FUNCTION private.audit_row_change();

-- 2. Report functions --------------------------------------------------------
CREATE OR REPLACE FUNCTION public.competency_scores(p_cycle_id uuid)
RETURNS TABLE (
  talent_id uuid,
  competency_id uuid,
  category text,
  competency_name text,
  sort_order integer,
  self_score numeric,
  manager_score numeric,
  peer_score numeric,
  direct_report_score numeric,
  others_score numeric,
  gap_to_target numeric,
  band text,
  perception text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH cycle AS (
    SELECT c.id, c.min_group_size FROM public.cycles c WHERE c.id = p_cycle_id
  ),
  visible_talents AS (
    SELECT DISTINCT a.talent_id
    FROM public.assignments a
    WHERE a.cycle_id = p_cycle_id AND private.can_view_talent_report(a.talent_id)
  ),
  group_sizes AS (
    SELECT a.talent_id, a.classification, count(*) AS submitted
    FROM public.assignments a
    WHERE a.cycle_id = p_cycle_id AND a.status = 'submitted'
    GROUP BY a.talent_id, a.classification
  ),
  ratings AS (
    SELECT a.talent_id, a.classification, r.competency_id, r.rating
    FROM public.assignments a
    JOIN public.responses r ON r.assignment_id = a.id
    JOIN visible_talents v ON v.talent_id = a.talent_id
    WHERE a.cycle_id = p_cycle_id AND a.status = 'submitted'
  ),
  shown AS (
    -- Peer and direct-report groups below the minimum size are never shown on their own.
    SELECT rt.*,
      (rt.classification NOT IN ('peer', 'direct_report')
        OR gs.submitted >= (SELECT min_group_size FROM cycle)) AS group_visible
    FROM ratings rt
    JOIN group_sizes gs ON gs.talent_id = rt.talent_id AND gs.classification = rt.classification
  ),
  scored AS (
    SELECT
      v.talent_id,
      comp.id AS competency_id,
      comp.category,
      comp.name AS competency_name,
      comp.sort_order,
      round(avg(s.rating) FILTER (WHERE s.classification = 'self'), 2) AS self_score,
      round(avg(s.rating) FILTER (WHERE s.classification = 'immediate_manager'), 2) AS manager_score,
      round(avg(s.rating) FILTER (WHERE s.classification = 'peer' AND s.group_visible), 2) AS peer_score,
      round(avg(s.rating) FILTER (WHERE s.classification = 'direct_report' AND s.group_visible), 2) AS direct_report_score,
      round(avg(s.rating) FILTER (WHERE s.classification <> 'self'), 2) AS others_score
    FROM visible_talents v
    CROSS JOIN public.competencies comp
    LEFT JOIN shown s ON s.talent_id = v.talent_id AND s.competency_id = comp.id
    WHERE EXISTS (SELECT 1 FROM cycle)
    GROUP BY v.talent_id, comp.id, comp.category, comp.name, comp.sort_order
  )
  SELECT
    talent_id, competency_id, category, competency_name, sort_order,
    self_score, manager_score, peer_score, direct_report_score, others_score,
    CASE WHEN others_score IS NULL THEN NULL ELSE round(5 - others_score, 2) END AS gap_to_target,
    CASE
      WHEN others_score IS NULL THEN NULL
      WHEN others_score >= 4 THEN 'Strength'
      WHEN others_score >= 3 THEN 'Developing'
      ELSE 'Development need'
    END AS band,
    CASE
      WHEN others_score IS NULL OR self_score IS NULL THEN NULL
      WHEN self_score - others_score >= 1 THEN 'Blind spot'
      WHEN others_score - self_score >= 1 THEN 'Hidden strength'
      ELSE 'Aligned'
    END AS perception
  FROM scored
  ORDER BY talent_id, sort_order;
$$;

CREATE OR REPLACE FUNCTION public.readiness_ranking(p_cycle_id uuid)
RETURNS TABLE (
  talent_id uuid,
  talent_name text,
  leading_self_gap numeric,
  leading_others_gap numeric,
  leading_business_gap numeric,
  leading_change_gap numeric,
  overall_gap numeric,
  categories_above_one integer,
  status text,
  rank integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH scores AS (
    SELECT * FROM public.competency_scores(p_cycle_id)
  ),
  per_talent AS (
    SELECT
      s.talent_id,
      round(avg(s.gap_to_target) FILTER (WHERE s.category = 'Leading Self'), 2) AS leading_self_gap,
      round(avg(s.gap_to_target) FILTER (WHERE s.category = 'Leading Others'), 2) AS leading_others_gap,
      round(avg(s.gap_to_target) FILTER (WHERE s.category = 'Leading the Business'), 2) AS leading_business_gap,
      round(avg(s.gap_to_target) FILTER (WHERE s.category = 'Leading Change'), 2) AS leading_change_gap,
      round(avg(s.gap_to_target), 2) AS overall_gap
    FROM scores s
    GROUP BY s.talent_id
  ),
  counted AS (
    SELECT pt.*,
      ((pt.leading_self_gap > 1)::int + (pt.leading_others_gap > 1)::int
        + (pt.leading_business_gap > 1)::int + (pt.leading_change_gap > 1)::int) AS categories_above_one
    FROM per_talent pt
  )
  SELECT
    c.talent_id,
    p.full_name AS talent_name,
    c.leading_self_gap, c.leading_others_gap, c.leading_business_gap, c.leading_change_gap,
    c.overall_gap,
    COALESCE(c.categories_above_one, 0) AS categories_above_one,
    CASE
      WHEN c.overall_gap IS NULL THEN 'Insufficient feedback'
      WHEN c.overall_gap <= 1 AND COALESCE(c.categories_above_one, 0) = 0 THEN 'Ready'
      WHEN COALESCE(c.categories_above_one, 0) <= 1 THEN 'Developing'
      ELSE 'Not yet ready'
    END AS status,
    (rank() OVER (ORDER BY c.overall_gap ASC NULLS LAST, p.full_name))::integer AS rank
  FROM counted c
  JOIN public.talents t ON t.id = c.talent_id
  JOIN public.profiles p ON p.id = t.profile_id
  ORDER BY rank;
$$;

CREATE OR REPLACE FUNCTION public.behaviour_notes(p_cycle_id uuid, p_talent_id uuid)
RETURNS TABLE (
  classification text,
  competency_id uuid,
  competency_name text,
  category text,
  sort_order integer,
  note text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH group_sizes AS (
    SELECT a.classification, count(*) AS submitted
    FROM public.assignments a
    WHERE a.cycle_id = p_cycle_id AND a.talent_id = p_talent_id AND a.status = 'submitted'
    GROUP BY a.classification
  )
  SELECT a.classification, comp.id, comp.name, comp.category, comp.sort_order, r.behaviour_note
  FROM public.assignments a
  JOIN public.responses r ON r.assignment_id = a.id
  JOIN public.competencies comp ON comp.id = r.competency_id
  JOIN group_sizes gs ON gs.classification = a.classification
  JOIN public.cycles c ON c.id = a.cycle_id
  WHERE a.cycle_id = p_cycle_id
    AND a.talent_id = p_talent_id
    AND a.status = 'submitted'
    AND private.can_view_talent_report(p_talent_id)
    AND (a.classification NOT IN ('peer', 'direct_report') OR gs.submitted >= c.min_group_size)
  ORDER BY comp.sort_order, a.classification, md5(r.assignment_id::text);
$$;

REVOKE EXECUTE ON FUNCTION public.competency_scores(uuid), public.readiness_ranking(uuid), public.behaviour_notes(uuid, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.competency_scores(uuid), public.readiness_ranking(uuid), public.behaviour_notes(uuid, uuid)
  TO authenticated;

-- 3. Activation bookkeeping -------------------------------------------------
DO $$
DECLARE
  def text;
  rewritten text;
BEGIN
  def := pg_get_functiondef('public.complete_password_change()'::regprocedure);
  rewritten := replace(def, 'SET must_change_password = false, temp_password_expires_at = NULL',
    'SET must_change_password = false, temp_password_expires_at = NULL, activated_at = COALESCE(activated_at, now())');
  IF rewritten = def THEN
    RAISE EXCEPTION 'Could not update complete_password_change';
  END IF;
  EXECUTE rewritten;
END $$;

UPDATE public.profiles SET activated_at = now()
WHERE activated_at IS NULL AND must_change_password = false;
