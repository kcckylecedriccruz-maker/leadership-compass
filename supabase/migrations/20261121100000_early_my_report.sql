/*
  # Early access to My report

  - cycles.early_report (default off): when on, employees can open their own report while the cycle is open,
    before everyone has responded.
  - In that early self-view (cycle open + early_report + the viewer is the person), every submitted group is shown,
    including groups below the minimum group size, and written notes appear as they arrive. Final reports after the
    cycle closes, and every other viewer, keep the usual minimum-group-size rule.
  - report_progress(cycle, talent): submitted vs total evaluations for the in-progress banner (anyone who can view
    the report).
*/

ALTER TABLE public.cycles ADD COLUMN IF NOT EXISTS early_report boolean NOT NULL DEFAULT false;
GRANT SELECT (early_report), INSERT (early_report), UPDATE (early_report) ON public.cycles TO authenticated;

CREATE OR REPLACE FUNCTION private.is_early_self_view(p_cycle_id uuid, p_talent_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.cycles c, public.talents t
    WHERE c.id = p_cycle_id AND t.id = p_talent_id
      AND c.status = 'open' AND c.early_report AND t.profile_id = auth.uid()
  );
$$;
REVOKE EXECUTE ON FUNCTION private.is_early_self_view(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.is_early_self_view(uuid, uuid) TO authenticated;

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
      WHERE t.id = p_talent_id AND t.profile_id = auth.uid()
        AND (c.status = 'closed' OR (c.status = 'open' AND c.early_report))
    )
    OR EXISTS (
      SELECT 1 FROM public.report_shares s
      WHERE s.cycle_id = p_cycle_id AND s.talent_id = p_talent_id AND s.shared_with = auth.uid()
    );
$$;

CREATE OR REPLACE FUNCTION public.report_progress(p_cycle_id uuid, p_talent_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT private.can_view_cycle_report(p_cycle_id, p_talent_id) THEN
    RAISE EXCEPTION 'You cannot view this report.' USING ERRCODE = '42501';
  END IF;
  RETURN (
    SELECT jsonb_build_object(
      'submitted', count(*) FILTER (WHERE status = 'submitted'),
      'total', count(*)
    )
    FROM public.assignments WHERE cycle_id = p_cycle_id AND talent_id = p_talent_id
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION public.report_progress(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.report_progress(uuid, uuid) TO authenticated;

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
      (g.grp NOT IN ('peer', 'report', 'external') OR gs.submitted >= (SELECT min_group_size FROM cycle)
        OR private.is_early_self_view(p_cycle_id, g.talent_id)) AS group_visible
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
    AND (g.grp NOT IN ('peer', 'report', 'external') OR gs.submitted >= c.min_group_size
         OR private.is_early_self_view(p_cycle_id, p_talent_id))
  ORDER BY comp.sort_order, g.classification, md5(r.assignment_id::text);
$$;
