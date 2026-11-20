/*
  # Evaluating without an account: secure links, quick-add employees and external raters

  1. People
    - profiles.person_type: 'employee' (default) or 'external' (clients, partners, contractors who only give
      feedback). profiles.organisation: optional, for externals.
    - Externals are never rated, never have a manager, are never anyone's manager or peer, and get no talents row.
    - Quick-add employees are ordinary employees who were never invited; they answer by secure link until they
      activate.

  2. External raters
    - external_raters(employee_id, rater_id): saved on the employee and added to each cycle that includes the
      External group, like approved peers. Added by an administrator, Org structure editors, or the employee's
      immediate manager (through the manage-people edge function).
    - New relationship kind 'external' and origin 'external'; cycles.include_external (default on).

  3. Secure links
    - evaluation_links(profile_id, cycle_id, version): one link per person per cycle. The token is an HMAC of
      (id, version) computed in the edge functions, so nothing secret is stored. Resending bumps the version, which
      invalidates the old link; revoking sets revoked_at. Links stop working when the cycle closes.
    - link_save_draft / link_clear_draft: service-role versions of the draft RPCs for link-based answers.

  4. Reports
    - competency_scores gains external_score. External is an anonymous group like Peers and Direct reports:
      hidden below the cycle's minimum group size, and never named outside the administrator view.
*/

-- 1. People ---------------------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS person_type text NOT NULL DEFAULT 'employee',
  ADD COLUMN IF NOT EXISTS organisation text;

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_person_type_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_person_type_check CHECK (person_type IN ('employee', 'external'));
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_organisation_length;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_organisation_length CHECK (organisation IS NULL OR char_length(organisation) <= 100);
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_external_shape;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_external_shape
  CHECK (person_type = 'employee' OR (role = 'employee' AND manager_id IS NULL));

GRANT SELECT (person_type, organisation) ON public.profiles TO authenticated;

-- Nobody reports to an external rater.
CREATE OR REPLACE FUNCTION private.guard_external_manager()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.manager_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = NEW.manager_id AND p.person_type = 'external') THEN
    RAISE EXCEPTION 'An external rater cannot be anyone''s manager.' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_guard_external_manager ON public.profiles;
CREATE TRIGGER profiles_guard_external_manager
BEFORE INSERT OR UPDATE OF manager_id ON public.profiles
FOR EACH ROW EXECUTE FUNCTION private.guard_external_manager();

-- Externals are not assessed, so they get no talents row.
CREATE OR REPLACE FUNCTION private.ensure_talent_row()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.person_type = 'external' THEN
    RETURN NEW;
  END IF;
  INSERT INTO public.talents (profile_id, department, position)
  VALUES (NEW.id, NEW.department, NEW.position)
  ON CONFLICT (profile_id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- Peers are always employees.
CREATE OR REPLACE FUNCTION private.check_peer_pair(p_employee uuid, p_peer uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_employee = p_peer THEN
    RAISE EXCEPTION 'A person cannot be their own peer.' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_peer AND is_active AND person_type = 'employee') THEN
    RAISE EXCEPTION 'That colleague could not be found or is deactivated.' USING ERRCODE = 'P0002';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_employee AND is_active AND person_type = 'employee') THEN
    RAISE EXCEPTION 'That employee could not be found or is deactivated.' USING ERRCODE = 'P0002';
  END IF;
END;
$$;

-- 2. External raters ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.external_raters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  rater_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  added_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id, rater_id),
  CHECK (employee_id <> rater_id)
);

ALTER TABLE public.external_raters ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.external_raters FROM anon, authenticated;
GRANT SELECT ON public.external_raters TO authenticated;

DROP POLICY IF EXISTS external_raters_select ON public.external_raters;
CREATE POLICY external_raters_select ON public.external_raters FOR SELECT TO authenticated
USING (
  private.is_admin() OR private.can_view('talents') OR private.is_manager_of(employee_id) OR employee_id = auth.uid()
);

DROP TRIGGER IF EXISTS audit_row_change ON public.external_raters;
CREATE TRIGGER audit_row_change AFTER INSERT OR UPDATE OR DELETE ON public.external_raters
FOR EACH ROW EXECUTE FUNCTION private.audit_row_change();

ALTER TABLE public.assignments DROP CONSTRAINT IF EXISTS assignments_classification_check;
ALTER TABLE public.assignments ADD CONSTRAINT assignments_classification_check
  CHECK (classification IN ('self', 'immediate_manager', 'skip_level_manager', 'direct_report', 'skip_level_report', 'peer', 'external'));
ALTER TABLE public.assignments DROP CONSTRAINT IF EXISTS assignments_origin_check;
ALTER TABLE public.assignments ADD CONSTRAINT assignments_origin_check CHECK (origin IN ('auto', 'peer', 'external', 'manual'));

ALTER TABLE public.cycles ADD COLUMN IF NOT EXISTS include_external boolean NOT NULL DEFAULT true;
GRANT SELECT (include_external) ON public.cycles TO authenticated;
GRANT INSERT (include_external), UPDATE (include_external) ON public.cycles TO authenticated;

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
    WHERE p.is_active AND p.person_type = 'employee'
  ),
  raters AS (
    SELECT p.id, p.exclude_rater FROM public.profiles p WHERE p.is_active
  ),
  pairs AS (
    SELECT pe.talent_id, pe.id AS assessor_id, 'self' AS classification, 'auto' AS origin
    FROM people pe, c WHERE c.include_self AND NOT pe.exclude_self
    UNION ALL
    SELECT pe.talent_id, pe.manager_id, 'immediate_manager', 'auto'
    FROM people pe, c WHERE c.include_manager AND pe.manager_id IS NOT NULL AND NOT pe.exclude_rated
    UNION ALL
    SELECT pe.talent_id, pe.skip_id, 'skip_level_manager', 'auto'
    FROM people pe, c WHERE c.include_skip_level AND pe.skip_id IS NOT NULL AND NOT pe.exclude_rated
    UNION ALL
    SELECT mgr.talent_id, pe.id, 'direct_report', 'auto'
    FROM people pe JOIN people mgr ON mgr.id = pe.manager_id, c
    WHERE c.include_upward AND NOT mgr.exclude_rated
    UNION ALL
    SELECT skip.talent_id, pe.id, 'skip_level_report', 'auto'
    FROM people pe JOIN people skip ON skip.id = pe.skip_id, c
    WHERE c.include_upward_skip AND NOT skip.exclude_rated
    UNION ALL
    SELECT pe.talent_id, pr.peer_id, 'peer', 'peer'
    FROM public.peer_relationships pr JOIN people pe ON pe.id = pr.employee_id, c
    WHERE c.include_peers AND pr.status = 'approved' AND NOT pe.exclude_rated
    UNION ALL
    SELECT pe.talent_id, er.rater_id, 'external', 'external'
    FROM public.external_raters er JOIN people pe ON pe.id = er.employee_id, c
    WHERE c.include_external AND NOT pe.exclude_rated
  )
  SELECT DISTINCT ON (pa.talent_id, pa.assessor_id) pa.talent_id, pa.assessor_id, pa.classification, pa.origin
  FROM pairs pa
  JOIN raters r ON r.id = pa.assessor_id
  WHERE pa.assessor_id IS NOT NULL
    AND (pa.classification = 'self' OR NOT r.exclude_rater)
  ORDER BY pa.talent_id, pa.assessor_id,
    array_position(ARRAY['self', 'immediate_manager', 'direct_report', 'skip_level_manager', 'skip_level_report', 'peer', 'external'], pa.classification);
$$;

REVOKE EXECUTE ON FUNCTION private.desired_evaluations(uuid) FROM PUBLIC, anon, authenticated;

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

  WITH stale AS (
    SELECT a.id FROM public.assignments a
    WHERE a.cycle_id = p_cycle_id
      AND a.origin IN ('auto', 'peer', 'external')
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

/** Adds External evaluations to open cycles for a newly linked external rater. Service role only. */
CREATE OR REPLACE FUNCTION public.apply_external_rater(p_employee uuid, p_rater uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_added integer;
BEGIN
  WITH added AS (
    INSERT INTO public.assignments (cycle_id, talent_id, assessor_id, classification, origin)
    SELECT c.id, t.id, p_rater, 'external', 'external'
    FROM public.cycles c
    JOIN public.talents t ON t.profile_id = p_employee
    JOIN public.profiles e ON e.id = p_employee
    JOIN public.profiles r ON r.id = p_rater
    WHERE c.status = 'open' AND c.include_external AND now() < c.closes_at
      AND e.is_active AND r.is_active AND NOT e.exclude_rated AND NOT r.exclude_rater
    ON CONFLICT (cycle_id, talent_id, assessor_id) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_added FROM added;
  RETURN v_added;
END;
$$;

/** Removes External evaluations (not started, no answers) when an external rater is unlinked. Service role only. */
CREATE OR REPLACE FUNCTION public.withdraw_external_rater(p_employee uuid, p_rater uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_removed integer;
BEGIN
  WITH stale AS (
    SELECT a.id FROM public.assignments a
    JOIN public.talents t ON t.id = a.talent_id AND t.profile_id = p_employee
    JOIN public.cycles c ON c.id = a.cycle_id AND c.status IN ('draft', 'open')
    WHERE a.assessor_id = p_rater AND a.classification = 'external' AND a.status = 'not_started'
      AND NOT EXISTS (SELECT 1 FROM public.responses r WHERE r.assignment_id = a.id)
  ), cleared AS (
    UPDATE public.notifications SET assignment_id = NULL WHERE assignment_id IN (SELECT id FROM stale) RETURNING 1
  ), deleted AS (
    DELETE FROM public.assignments WHERE id IN (SELECT id FROM stale) RETURNING 1
  )
  SELECT count(*) INTO v_removed FROM deleted;
  RETURN v_removed;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.apply_external_rater(uuid, uuid), public.withdraw_external_rater(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_external_rater(uuid, uuid), public.withdraw_external_rater(uuid, uuid) TO service_role;

-- 3. Secure links ------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.evaluation_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  cycle_id uuid NOT NULL REFERENCES public.cycles(id) ON DELETE CASCADE,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_sent_at timestamptz,
  last_used_at timestamptz,
  revoked_at timestamptz,
  UNIQUE (profile_id, cycle_id)
);

ALTER TABLE public.evaluation_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.evaluation_links FROM anon, authenticated;
GRANT SELECT ON public.evaluation_links TO authenticated;

DROP POLICY IF EXISTS evaluation_links_select ON public.evaluation_links;
CREATE POLICY evaluation_links_select ON public.evaluation_links FOR SELECT TO authenticated
USING (private.is_admin() OR private.can_view('assignments'));

CREATE OR REPLACE FUNCTION public.link_save_draft(p_assessor uuid, p_assignment_id uuid, p_responses jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_item jsonb;
  v_sort_order integer;
  v_rating integer;
  v_note text;
  v_competency_id uuid;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.assignments a JOIN public.cycles c ON c.id = a.cycle_id
    WHERE a.id = p_assignment_id AND a.assessor_id = p_assessor AND a.status <> 'submitted'
      AND c.status = 'open' AND now() < c.closes_at
  ) THEN
    RAISE EXCEPTION 'This assessment cannot be changed right now.' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p_responses) <> 'array' OR jsonb_array_length(p_responses) > 19 THEN
    RAISE EXCEPTION 'The feedback is not in the right format.' USING ERRCODE = '22023';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_responses) LOOP
    v_sort_order := (v_item ->> 'sort_order')::integer;
    v_rating := (v_item ->> 'rating')::integer;
    v_note := NULLIF(btrim(COALESCE(v_item ->> 'behaviour_note', '')), '');
    IF v_sort_order IS NULL OR v_sort_order NOT BETWEEN 1 AND 19
      OR (v_rating IS NOT NULL AND v_rating NOT BETWEEN 1 AND 5)
      OR (v_note IS NOT NULL AND length(v_note) > 2000) THEN
      RAISE EXCEPTION 'Each answer needs an item number from 1 to 19, a rating from 1 to 5 if one is given, and a behaviour note of up to 2000 characters.' USING ERRCODE = '22023';
    END IF;
    SELECT c.id INTO v_competency_id FROM public.competencies c WHERE c.sort_order = v_sort_order;
    INSERT INTO public.responses (assignment_id, competency_id, rating, behaviour_note)
    VALUES (p_assignment_id, v_competency_id, v_rating, v_note)
    ON CONFLICT (assignment_id, competency_id)
    DO UPDATE SET rating = EXCLUDED.rating, behaviour_note = EXCLUDED.behaviour_note;
  END LOOP;

  UPDATE public.assignments SET status = 'draft' WHERE id = p_assignment_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.link_clear_draft(p_assessor uuid, p_assignment_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.assignments a JOIN public.cycles c ON c.id = a.cycle_id
    WHERE a.id = p_assignment_id AND a.assessor_id = p_assessor AND a.status <> 'submitted'
      AND c.status = 'open' AND now() < c.closes_at
  ) THEN
    RAISE EXCEPTION 'This assessment cannot be changed right now.' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.responses WHERE assignment_id = p_assignment_id;
  UPDATE public.assignments SET status = 'not_started' WHERE id = p_assignment_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.link_save_draft(uuid, uuid, jsonb), public.link_clear_draft(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.link_save_draft(uuid, uuid, jsonb), public.link_clear_draft(uuid, uuid) TO service_role;

-- 4. Reports: an anonymous External group ----------------------------------------------
DROP FUNCTION IF EXISTS public.competency_scores(uuid);
CREATE FUNCTION public.competency_scores(p_cycle_id uuid)
RETURNS TABLE (
  talent_id uuid, competency_id uuid, category text, competency_name text, sort_order integer,
  self_score numeric, manager_score numeric, peer_score numeric, direct_report_score numeric, external_score numeric,
  others_score numeric, gap_to_target numeric, band text, perception text
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
    WHERE a.cycle_id = p_cycle_id AND private.can_view_cycle_report(p_cycle_id, a.talent_id)
  ),
  grouped AS (
    SELECT a.*, CASE
      WHEN a.classification IN ('immediate_manager', 'skip_level_manager') THEN 'manager'
      WHEN a.classification IN ('direct_report', 'skip_level_report') THEN 'report'
      ELSE a.classification END AS grp
    FROM public.assignments a
    WHERE a.cycle_id = p_cycle_id AND a.status = 'submitted'
  ),
  group_sizes AS (
    SELECT g.talent_id, g.grp, count(*) AS submitted FROM grouped g GROUP BY g.talent_id, g.grp
  ),
  ratings AS (
    SELECT g.talent_id, g.grp, r.competency_id, r.rating,
      (g.grp NOT IN ('peer', 'report', 'external') OR gs.submitted >= (SELECT min_group_size FROM cycle)) AS group_visible
    FROM grouped g
    JOIN public.responses r ON r.assignment_id = g.id
    JOIN visible_talents v ON v.talent_id = g.talent_id
    JOIN group_sizes gs ON gs.talent_id = g.talent_id AND gs.grp = g.grp
  ),
  scored AS (
    SELECT
      v.talent_id, comp.id AS competency_id, comp.category, comp.name AS competency_name, comp.sort_order,
      round(avg(s.rating) FILTER (WHERE s.grp = 'self'), 2) AS self_score,
      round(avg(s.rating) FILTER (WHERE s.grp = 'manager'), 2) AS manager_score,
      round(avg(s.rating) FILTER (WHERE s.grp = 'peer' AND s.group_visible), 2) AS peer_score,
      round(avg(s.rating) FILTER (WHERE s.grp = 'report' AND s.group_visible), 2) AS direct_report_score,
      round(avg(s.rating) FILTER (WHERE s.grp = 'external' AND s.group_visible), 2) AS external_score,
      round(avg(s.rating) FILTER (WHERE s.grp <> 'self'), 2) AS others_score
    FROM visible_talents v
    CROSS JOIN public.competencies comp
    LEFT JOIN ratings s ON s.talent_id = v.talent_id AND s.competency_id = comp.id
    WHERE EXISTS (SELECT 1 FROM cycle)
    GROUP BY v.talent_id, comp.id, comp.category, comp.name, comp.sort_order
  )
  SELECT
    talent_id, competency_id, category, competency_name, sort_order,
    self_score, manager_score, peer_score, direct_report_score, external_score, others_score,
    CASE WHEN others_score IS NULL THEN NULL ELSE round(5 - others_score, 2) END,
    CASE WHEN others_score IS NULL THEN NULL WHEN others_score >= 4 THEN 'Strength'
         WHEN others_score >= 3 THEN 'Developing' ELSE 'Development need' END,
    CASE WHEN others_score IS NULL OR self_score IS NULL THEN NULL
         WHEN self_score - others_score >= 1 THEN 'Blind spot'
         WHEN others_score - self_score >= 1 THEN 'Hidden strength' ELSE 'Aligned' END
  FROM scored
  ORDER BY talent_id, sort_order;
$$;

REVOKE EXECUTE ON FUNCTION public.competency_scores(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.competency_scores(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.behaviour_notes(p_cycle_id uuid, p_talent_id uuid)
RETURNS TABLE (classification text, competency_id uuid, competency_name text, category text, sort_order integer, note text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH grouped AS (
    SELECT a.*, CASE
      WHEN a.classification IN ('immediate_manager', 'skip_level_manager') THEN 'manager'
      WHEN a.classification IN ('direct_report', 'skip_level_report') THEN 'report'
      ELSE a.classification END AS grp
    FROM public.assignments a
    WHERE a.cycle_id = p_cycle_id AND a.talent_id = p_talent_id AND a.status = 'submitted'
  ),
  group_sizes AS (SELECT grp, count(*) AS submitted FROM grouped GROUP BY grp)
  SELECT g.classification, comp.id, comp.name, comp.category, comp.sort_order, r.behaviour_note
  FROM grouped g
  JOIN public.responses r ON r.assignment_id = g.id
  JOIN public.competencies comp ON comp.id = r.competency_id
  JOIN group_sizes gs ON gs.grp = g.grp
  JOIN public.cycles c ON c.id = g.cycle_id
  WHERE private.can_view_cycle_report(p_cycle_id, p_talent_id)
    AND (g.grp NOT IN ('peer', 'report', 'external') OR gs.submitted >= c.min_group_size)
  ORDER BY comp.sort_order, g.classification, md5(r.assignment_id::text);
$$;

CREATE OR REPLACE FUNCTION public.individual_feedback(p_cycle_id uuid, p_talent_id uuid)
RETURNS TABLE (
  assessor_label text, assessor_name text, classification text, submitted_at timestamptz,
  competency_id uuid, category text, competency_name text, sort_order integer, rating smallint, note text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_full boolean := private.is_admin() OR private.can_view('dashboard');
  v_shared boolean := EXISTS (
    SELECT 1 FROM public.report_shares s
    WHERE s.cycle_id = p_cycle_id AND s.talent_id = p_talent_id AND s.shared_with = auth.uid() AND s.kind = 'individual'
  );
BEGIN
  IF NOT (v_full OR v_shared) THEN
    RAISE EXCEPTION 'You do not have access to this individual report.' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH submitted AS (
    SELECT a.id, a.assessor_id, a.classification, a.submitted_at, CASE
      WHEN a.classification IN ('immediate_manager', 'skip_level_manager') THEN 'manager'
      WHEN a.classification IN ('direct_report', 'skip_level_report') THEN 'report'
      ELSE a.classification END AS grp
    FROM public.assignments a
    WHERE a.cycle_id = p_cycle_id AND a.talent_id = p_talent_id AND a.status = 'submitted'
  ),
  sizes AS (SELECT grp, count(*) AS n FROM submitted GROUP BY grp),
  numbered AS (
    SELECT s.*, row_number() OVER (PARTITION BY s.classification ORDER BY md5(s.id::text)) AS seq
    FROM submitted s
  )
  SELECT
    initcap(replace(n.classification, '_', ' ')) || CASE WHEN n.classification IN ('self') THEN '' ELSE ' ' || n.seq END,
    CASE WHEN v_full OR n.classification IN ('immediate_manager', 'skip_level_manager') THEN p.full_name ELSE NULL END,
    n.classification, n.submitted_at,
    comp.id, comp.category, comp.name, comp.sort_order, r.rating, r.behaviour_note
  FROM numbered n
  JOIN public.profiles p ON p.id = n.assessor_id
  JOIN public.responses r ON r.assignment_id = n.id
  JOIN public.competencies comp ON comp.id = r.competency_id
  JOIN sizes sz ON sz.grp = n.grp
  JOIN public.cycles c ON c.id = p_cycle_id
  WHERE v_full OR n.grp NOT IN ('peer', 'report', 'external') OR sz.n >= c.min_group_size
  ORDER BY n.classification, n.seq, comp.sort_order;
END;
$$;
