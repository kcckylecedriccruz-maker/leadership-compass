/*
# Peers and report access (phases 3 and 4)

## Peers
- peer_relationships (created in the previous migration) holds who rates whom
  as a peer: status suggested, approved or rejected. No minimum or maximum.
- Employees suggest peers for themselves (suggest_peer). Their immediate
  manager, an administrator or an org-structure editor approves or rejects
  (decide_peer), adds peers directly (assign_peer, approved at once) or
  removes them (remove_peer; employees may withdraw their own pending
  suggestions).
- Approving a peer adds a Peer evaluation to every open cycle that includes
  peers (draft cycles pick it up when they open). Removing or rejecting a peer
  removes Peer evaluations that have not started.
- Everyone involved can read the rows that concern them: the employee, their
  manager, and admins / Users viewers / Org structure editors.

## Report access
- Administrators (and Dashboard viewers) see every report.
- Each employee sees their own consolidated report once that cycle is closed.
- Managers no longer see their team's reports automatically. An administrator
  shares a person's consolidated or individual report with the person's
  immediate or skip-level manager (share_report / unshare_report).
- individual_feedback(cycle, talent): one row per answer. Admins see every
  assessor's name. In a shared individual report, names are shown only for the
  immediate and skip-level managers' feedback; other feedback is labelled
  (Peer 1, Direct report 2, ...) and groups below the cycle's minimum size are
  left out.
- Report functions now include the skip-level kinds: skip-level managers count
  with managers, skip-level reports with direct reports, all inside "others".
*/

-- ---- Peers --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.is_manager_of(p_employee uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$ SELECT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = p_employee AND p.manager_id = auth.uid()); $$;
REVOKE EXECUTE ON FUNCTION private.is_manager_of(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.is_manager_of(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION private.can_manage_peers_of(p_employee uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$ SELECT private.is_admin() OR private.can_edit('talents') OR private.is_manager_of(p_employee); $$;
REVOKE EXECUTE ON FUNCTION private.can_manage_peers_of(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.can_manage_peers_of(uuid) TO authenticated;

GRANT SELECT ON public.peer_relationships TO authenticated;
DROP POLICY IF EXISTS peer_relationships_select ON public.peer_relationships;
CREATE POLICY peer_relationships_select ON public.peer_relationships FOR SELECT TO authenticated
  USING (employee_id = auth.uid() OR private.can_manage_peers_of(employee_id) OR private.can_view('users'));

/** Adds Peer evaluations for an approved peer to every open cycle that includes peers. */
CREATE OR REPLACE FUNCTION private.apply_peer_to_open_cycles(p_employee uuid, p_peer uuid)
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
    SELECT c.id, t.id, p_peer, 'peer', 'peer'
    FROM public.cycles c
    JOIN public.talents t ON t.profile_id = p_employee
    JOIN public.profiles e ON e.id = p_employee
    JOIN public.profiles r ON r.id = p_peer
    WHERE c.status = 'open' AND c.include_peers AND now() < c.closes_at
      AND e.is_active AND r.is_active AND NOT e.exclude_rated AND NOT r.exclude_rater
    ON CONFLICT (cycle_id, talent_id, assessor_id) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_added FROM added;
  RETURN v_added;
END;
$$;

/** Removes Peer evaluations (not started, no answers) for a peer who is no longer approved. */
CREATE OR REPLACE FUNCTION private.withdraw_peer_from_cycles(p_employee uuid, p_peer uuid)
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
    WHERE a.assessor_id = p_peer AND a.classification = 'peer' AND a.status = 'not_started'
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
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_peer AND is_active) THEN
    RAISE EXCEPTION 'That colleague could not be found or is deactivated.' USING ERRCODE = 'P0002';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_employee AND is_active) THEN
    RAISE EXCEPTION 'That employee could not be found or is deactivated.' USING ERRCODE = 'P0002';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.suggest_peer(p_peer uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in first.' USING ERRCODE = '42501';
  END IF;
  PERFORM private.check_peer_pair(auth.uid(), p_peer);
  INSERT INTO public.peer_relationships (employee_id, peer_id, status, suggested_by)
  VALUES (auth.uid(), p_peer, 'suggested', auth.uid())
  ON CONFLICT (employee_id, peer_id) DO UPDATE
    SET status = 'suggested', suggested_by = auth.uid(), decided_by = NULL, decided_at = NULL
    WHERE public.peer_relationships.status = 'rejected';
END;
$$;

CREATE OR REPLACE FUNCTION public.assign_peer(p_employee uuid, p_peer uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT private.can_manage_peers_of(p_employee) THEN
    RAISE EXCEPTION 'Only this person''s immediate manager or an administrator can add their peers.' USING ERRCODE = '42501';
  END IF;
  PERFORM private.check_peer_pair(p_employee, p_peer);
  INSERT INTO public.peer_relationships (employee_id, peer_id, status, suggested_by, decided_by, decided_at)
  VALUES (p_employee, p_peer, 'approved', auth.uid(), auth.uid(), now())
  ON CONFLICT (employee_id, peer_id) DO UPDATE
    SET status = 'approved', decided_by = auth.uid(), decided_at = now();
  RETURN private.apply_peer_to_open_cycles(p_employee, p_peer);
END;
$$;

CREATE OR REPLACE FUNCTION public.decide_peer(p_id uuid, p_approve boolean)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_row public.peer_relationships%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM public.peer_relationships WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This peer suggestion could not be found.' USING ERRCODE = 'P0002';
  END IF;
  IF NOT private.can_manage_peers_of(v_row.employee_id) THEN
    RAISE EXCEPTION 'Only this person''s immediate manager or an administrator can decide on their peers.' USING ERRCODE = '42501';
  END IF;
  UPDATE public.peer_relationships
  SET status = CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END, decided_by = auth.uid(), decided_at = now()
  WHERE id = p_id;
  IF p_approve THEN
    RETURN private.apply_peer_to_open_cycles(v_row.employee_id, v_row.peer_id);
  END IF;
  RETURN -private.withdraw_peer_from_cycles(v_row.employee_id, v_row.peer_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_peer(p_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_row public.peer_relationships%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM public.peer_relationships WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 0;
  END IF;
  IF NOT (private.can_manage_peers_of(v_row.employee_id)
          OR (v_row.employee_id = auth.uid() AND v_row.status = 'suggested')) THEN
    RAISE EXCEPTION 'You cannot remove this peer.' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.peer_relationships WHERE id = p_id;
  RETURN private.withdraw_peer_from_cycles(v_row.employee_id, v_row.peer_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.suggest_peer(uuid), public.assign_peer(uuid, uuid), public.decide_peer(uuid, boolean), public.remove_peer(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.suggest_peer(uuid), public.assign_peer(uuid, uuid), public.decide_peer(uuid, boolean), public.remove_peer(uuid)
  TO authenticated;
REVOKE EXECUTE ON FUNCTION private.apply_peer_to_open_cycles(uuid, uuid), private.withdraw_peer_from_cycles(uuid, uuid), private.check_peer_pair(uuid, uuid)
  FROM PUBLIC, anon, authenticated;

-- Employees need to see active colleagues' names to suggest peers. The check runs in a
-- SECURITY DEFINER helper so the policy does not query profiles from inside itself.
CREATE OR REPLACE FUNCTION private.is_active_member()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$ SELECT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_active); $$;
REVOKE EXECUTE ON FUNCTION private.is_active_member() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.is_active_member() TO authenticated;

DROP POLICY IF EXISTS profiles_select_colleagues ON public.profiles;
CREATE POLICY profiles_select_colleagues ON public.profiles FOR SELECT TO authenticated
  USING (is_active AND private.is_active_member());

-- ---- Report access ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.report_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id uuid NOT NULL REFERENCES public.cycles(id) ON DELETE CASCADE,
  talent_id uuid NOT NULL REFERENCES public.talents(id) ON DELETE CASCADE,
  shared_with uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('consolidated', 'individual')),
  shared_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cycle_id, talent_id, shared_with, kind)
);
ALTER TABLE public.report_shares ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.report_shares FROM anon;
GRANT SELECT ON public.report_shares TO authenticated;
DROP POLICY IF EXISTS report_shares_select ON public.report_shares;
CREATE POLICY report_shares_select ON public.report_shares FOR SELECT TO authenticated
  USING (private.is_admin() OR private.can_view('dashboard') OR shared_with = auth.uid());
DROP TRIGGER IF EXISTS audit_row_change ON public.report_shares;
CREATE TRIGGER audit_row_change AFTER INSERT OR UPDATE OR DELETE ON public.report_shares
FOR EACH ROW EXECUTE FUNCTION private.audit_row_change();

/** Who may see a talent's consolidated report for one cycle. */
CREATE OR REPLACE FUNCTION private.can_view_cycle_report(p_cycle_id uuid, p_talent_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT private.is_admin()
    OR private.can_view('dashboard')
    OR EXISTS (
      SELECT 1 FROM public.talents t JOIN public.cycles c ON c.id = p_cycle_id
      WHERE t.id = p_talent_id AND t.profile_id = auth.uid() AND c.status = 'closed'
    )
    OR EXISTS (
      SELECT 1 FROM public.report_shares s
      WHERE s.cycle_id = p_cycle_id AND s.talent_id = p_talent_id AND s.shared_with = auth.uid()
    );
$$;
REVOKE EXECUTE ON FUNCTION private.can_view_cycle_report(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.can_view_cycle_report(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.share_report(p_cycle_id uuid, p_talent_id uuid, p_shared_with uuid, p_kind text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT private.is_admin() THEN
    RAISE EXCEPTION 'Only an administrator can share reports.' USING ERRCODE = '42501';
  END IF;
  IF p_kind NOT IN ('consolidated', 'individual') THEN
    RAISE EXCEPTION 'Choose a consolidated or individual report.' USING ERRCODE = '22023';
  END IF;
  -- Reports go only to the person's immediate or skip-level manager.
  IF NOT EXISTS (
    SELECT 1 FROM public.talents t
    JOIN public.profiles p ON p.id = t.profile_id
    LEFT JOIN public.profiles m ON m.id = p.manager_id
    WHERE t.id = p_talent_id AND (p.manager_id = p_shared_with OR m.manager_id = p_shared_with)
  ) THEN
    RAISE EXCEPTION 'Reports can only be shared with the person''s immediate or skip-level manager.' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.report_shares (cycle_id, talent_id, shared_with, kind, shared_by)
  VALUES (p_cycle_id, p_talent_id, p_shared_with, p_kind, auth.uid())
  ON CONFLICT (cycle_id, talent_id, shared_with, kind) DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION public.unshare_report(p_share_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT private.is_admin() THEN
    RAISE EXCEPTION 'Only an administrator can stop sharing reports.' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.report_shares WHERE id = p_share_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.share_report(uuid, uuid, uuid, text), public.unshare_report(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.share_report(uuid, uuid, uuid, text), public.unshare_report(uuid) TO authenticated;

-- Report functions, now per cycle and aware of the skip-level kinds.
CREATE OR REPLACE FUNCTION public.competency_scores(p_cycle_id uuid)
RETURNS TABLE (
  talent_id uuid, competency_id uuid, category text, competency_name text, sort_order integer,
  self_score numeric, manager_score numeric, peer_score numeric, direct_report_score numeric,
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
    -- Reporting groups: managers (immediate + skip-level) and reports (direct + skip-level).
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
      (g.grp NOT IN ('peer', 'report') OR gs.submitted >= (SELECT min_group_size FROM cycle)) AS group_visible
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
      round(avg(s.rating) FILTER (WHERE s.grp <> 'self'), 2) AS others_score
    FROM visible_talents v
    CROSS JOIN public.competencies comp
    LEFT JOIN ratings s ON s.talent_id = v.talent_id AND s.competency_id = comp.id
    WHERE EXISTS (SELECT 1 FROM cycle)
    GROUP BY v.talent_id, comp.id, comp.category, comp.name, comp.sort_order
  )
  SELECT
    talent_id, competency_id, category, competency_name, sort_order,
    self_score, manager_score, peer_score, direct_report_score, others_score,
    CASE WHEN others_score IS NULL THEN NULL ELSE round(5 - others_score, 2) END,
    CASE WHEN others_score IS NULL THEN NULL WHEN others_score >= 4 THEN 'Strength'
         WHEN others_score >= 3 THEN 'Developing' ELSE 'Development need' END,
    CASE WHEN others_score IS NULL OR self_score IS NULL THEN NULL
         WHEN self_score - others_score >= 1 THEN 'Blind spot'
         WHEN others_score - self_score >= 1 THEN 'Hidden strength' ELSE 'Aligned' END
  FROM scored
  ORDER BY talent_id, sort_order;
$$;

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
    AND (g.grp NOT IN ('peer', 'report') OR gs.submitted >= c.min_group_size)
  ORDER BY comp.sort_order, g.classification, md5(r.assignment_id::text);
$$;

/** Individual answers per assessor, for admins and for managers an admin shared the individual report with. */
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
  WHERE v_full OR n.grp NOT IN ('peer', 'report') OR sz.n >= c.min_group_size
  ORDER BY n.classification, n.seq, comp.sort_order;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.individual_feedback(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.individual_feedback(uuid, uuid) TO authenticated;
