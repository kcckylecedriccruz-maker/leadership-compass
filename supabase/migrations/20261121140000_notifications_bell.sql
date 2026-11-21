/*
  # Notification bell

  - report_shares.opened_at / dismissed_at: a shared report counts as new until the recipient opens it; after that it
    stays in the bell list (not counted) until they remove it.
  - my_notifications(): what the signed-in person has pending, grouped with counts:
      peer suggestions waiting for them as immediate manager, improvement plans waiting to be released (admins),
      their forms still to complete in open cycles, and reports shared with them (new and opened).
  - mark_shared_report_opened(cycle, talent) and dismiss_shared_report(share): the recipient only.
*/
ALTER TABLE public.report_shares
  ADD COLUMN IF NOT EXISTS opened_at timestamptz,
  ADD COLUMN IF NOT EXISTS dismissed_at timestamptz;

CREATE OR REPLACE FUNCTION public.my_notifications()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_me uuid := auth.uid();
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'Sign in first.' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'peer_suggestions', (
      SELECT count(*) FROM public.peer_relationships pr
      JOIN public.profiles e ON e.id = pr.employee_id
      WHERE pr.status = 'suggested' AND e.manager_id = v_me AND e.is_active
    ),
    'plans_to_release', CASE WHEN private.is_admin() THEN (
      SELECT count(DISTINCT (p.cycle_id, p.talent_id)) FROM public.ai_improvement_plans p
      WHERE NOT EXISTS (
        SELECT 1 FROM public.ai_improvement_plans q
        WHERE q.cycle_id = p.cycle_id AND q.talent_id = p.talent_id AND q.released_at IS NOT NULL
      )
    ) ELSE 0 END,
    'forms_pending', coalesce((
      SELECT jsonb_agg(jsonb_build_object('cycle', f.name, 'count', f.n, 'closes_at', f.closes_at) ORDER BY f.closes_at)
      FROM (
        SELECT c.name, c.closes_at, count(*) AS n
        FROM public.assignments a JOIN public.cycles c ON c.id = a.cycle_id
        WHERE a.assessor_id = v_me AND a.status <> 'submitted' AND c.status = 'open' AND now() < c.closes_at
        GROUP BY c.id, c.name, c.closes_at
      ) f
    ), '[]'::jsonb),
    'new_shares', (
      SELECT count(*) FROM public.report_shares s
      WHERE s.shared_with = v_me AND s.opened_at IS NULL AND s.dismissed_at IS NULL
    ),
    'opened_shares', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', s.id, 'person', pr.full_name, 'cycle', c.name, 'kind', s.kind) ORDER BY s.opened_at DESC)
      FROM public.report_shares s
      JOIN public.talents t ON t.id = s.talent_id
      JOIN public.profiles pr ON pr.id = t.profile_id
      JOIN public.cycles c ON c.id = s.cycle_id
      WHERE s.shared_with = v_me AND s.opened_at IS NOT NULL AND s.dismissed_at IS NULL
    ), '[]'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_shared_report_opened(p_cycle_id uuid, p_talent_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  UPDATE public.report_shares SET opened_at = now()
  WHERE cycle_id = p_cycle_id AND talent_id = p_talent_id AND shared_with = auth.uid() AND opened_at IS NULL;
$$;

CREATE OR REPLACE FUNCTION public.dismiss_shared_report(p_share_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  UPDATE public.report_shares SET dismissed_at = now(), opened_at = coalesce(opened_at, now())
  WHERE id = p_share_id AND shared_with = auth.uid();
$$;

REVOKE EXECUTE ON FUNCTION public.my_notifications(), public.mark_shared_report_opened(uuid, uuid), public.dismiss_shared_report(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_notifications(), public.mark_shared_report_opened(uuid, uuid), public.dismiss_shared_report(uuid) TO authenticated;
