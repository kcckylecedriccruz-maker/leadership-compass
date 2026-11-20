/*
  # Outside people being evaluated, and account deletion with a 3-day recovery window

  1. Outside people evaluated by employees
    - external_evaluators(external_id, evaluator_id): administrators pick which employees evaluate an outside person
      (person_type 'external'). Saved on the outside person and carried to every cycle with include_external.
    - The outside person gets a talents row so they can be assessed. They do no self-assessment.
    - Their evaluations use the Peer kind with origin 'external'.
    - Their report is admin-only; share_report also allows sharing it with any active employee.

  2. Account deletion
    - request_account_deletion(profile): administrators only, deactivated accounts only, never yourself. Sets
      deletion_requested_at; the account can be recovered with cancel_account_deletion for 3 days.
    - purge_due_deletions(): service role (hourly job through the purge-deleted-accounts function). After 3 days the
      name and email are removed (the person becomes "Deleted person xxxx"), memberships, access, peers, links and
      unsubmitted forms are removed, feedback they gave stays as anonymous answers, and reports about them stay in a
      separate "Deleted people" category. The function then deletes the login.
    - profiles no longer require a matching auth user, so the anonymised profile can outlive the login.

  3. readiness_ranking gains a category column: employee, outside or deleted (ranked within each).
*/

-- 1. Outside people being evaluated --------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.external_evaluators (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  evaluator_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  added_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (external_id, evaluator_id),
  CHECK (external_id <> evaluator_id)
);

ALTER TABLE public.external_evaluators ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.external_evaluators FROM anon, authenticated;
GRANT SELECT ON public.external_evaluators TO authenticated;
DROP POLICY IF EXISTS external_evaluators_select ON public.external_evaluators;
CREATE POLICY external_evaluators_select ON public.external_evaluators FOR SELECT TO authenticated
USING (private.is_admin() OR private.can_view('talents'));

DROP TRIGGER IF EXISTS audit_row_change ON public.external_evaluators;
CREATE TRIGGER audit_row_change AFTER INSERT OR UPDATE OR DELETE ON public.external_evaluators
FOR EACH ROW EXECUTE FUNCTION private.audit_row_change();

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
  outsiders AS (
    SELECT p.id, p.exclude_rated, t.id AS talent_id
    FROM public.profiles p
    JOIN public.talents t ON t.profile_id = p.id
    WHERE p.is_active AND p.person_type = 'external'
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
    UNION ALL
    -- Employees evaluate an outside person (no self-assessment for them).
    SELECT o.talent_id, ee.evaluator_id, 'peer', 'external'
    FROM public.external_evaluators ee JOIN outsiders o ON o.id = ee.external_id, c
    WHERE c.include_external AND NOT o.exclude_rated
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

/** Administrators pick which employees evaluate an outside person; open cycles get the evaluation straight away. */
CREATE OR REPLACE FUNCTION public.add_outside_evaluator(p_external uuid, p_evaluator uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_talent uuid;
  v_added integer;
BEGIN
  IF NOT private.is_admin() THEN
    RAISE EXCEPTION 'Only an administrator can choose who evaluates an outside person.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_external AND person_type = 'external' AND is_active) THEN
    RAISE EXCEPTION 'That outside person could not be found.' USING ERRCODE = 'P0002';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_evaluator AND person_type = 'employee' AND is_active) THEN
    RAISE EXCEPTION 'Choose an active employee as evaluator.' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.talents (profile_id) VALUES (p_external) ON CONFLICT (profile_id) DO NOTHING;
  SELECT id INTO v_talent FROM public.talents WHERE profile_id = p_external;

  INSERT INTO public.external_evaluators (external_id, evaluator_id, added_by)
  VALUES (p_external, p_evaluator, auth.uid())
  ON CONFLICT (external_id, evaluator_id) DO NOTHING;

  WITH added AS (
    INSERT INTO public.assignments (cycle_id, talent_id, assessor_id, classification, origin)
    SELECT c.id, v_talent, p_evaluator, 'peer', 'external'
    FROM public.cycles c
    JOIN public.profiles e ON e.id = p_external
    JOIN public.profiles r ON r.id = p_evaluator
    WHERE c.status = 'open' AND c.include_external AND now() < c.closes_at
      AND NOT e.exclude_rated AND NOT r.exclude_rater
    ON CONFLICT (cycle_id, talent_id, assessor_id) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_added FROM added;
  RETURN v_added;
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_outside_evaluator(p_external uuid, p_evaluator uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_removed integer;
BEGIN
  IF NOT private.is_admin() THEN
    RAISE EXCEPTION 'Only an administrator can change who evaluates an outside person.' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.external_evaluators WHERE external_id = p_external AND evaluator_id = p_evaluator;
  WITH stale AS (
    SELECT a.id FROM public.assignments a
    JOIN public.talents t ON t.id = a.talent_id AND t.profile_id = p_external
    JOIN public.cycles c ON c.id = a.cycle_id AND c.status IN ('draft', 'open')
    WHERE a.assessor_id = p_evaluator AND a.origin = 'external' AND a.status = 'not_started'
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

REVOKE EXECUTE ON FUNCTION public.add_outside_evaluator(uuid, uuid), public.remove_outside_evaluator(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_outside_evaluator(uuid, uuid), public.remove_outside_evaluator(uuid, uuid) TO authenticated;

-- An outside person's report can be shared with any active employee.
CREATE OR REPLACE FUNCTION public.share_report(p_cycle_id uuid, p_talent_id uuid, p_shared_with uuid, p_kind text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_outside boolean;
BEGIN
  IF NOT private.is_admin() THEN
    RAISE EXCEPTION 'Only an administrator can share reports.' USING ERRCODE = '42501';
  END IF;
  IF p_kind NOT IN ('consolidated', 'individual') THEN
    RAISE EXCEPTION 'Choose a consolidated or individual report.' USING ERRCODE = '22023';
  END IF;
  SELECT p.person_type = 'external' INTO v_outside
  FROM public.talents t JOIN public.profiles p ON p.id = t.profile_id WHERE t.id = p_talent_id;
  IF v_outside THEN
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_shared_with AND person_type = 'employee' AND is_active) THEN
      RAISE EXCEPTION 'Share an outside person''s report with an active employee.' USING ERRCODE = '22023';
    END IF;
  ELSIF NOT EXISTS (
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

-- 2. Account deletion -------------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS deletion_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS deletion_requested_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
GRANT SELECT (deletion_requested_at, deletion_requested_by, deleted_at) ON public.profiles TO authenticated;

-- The anonymised profile stays after its login is deleted.
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_id_fkey;

CREATE OR REPLACE FUNCTION public.request_account_deletion(p_profile uuid)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_row public.profiles;
BEGIN
  IF NOT private.is_admin() THEN
    RAISE EXCEPTION 'Only an administrator can delete accounts.' USING ERRCODE = '42501';
  END IF;
  IF p_profile = auth.uid() THEN
    RAISE EXCEPTION 'You cannot delete your own account.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_row FROM public.profiles WHERE id = p_profile FOR UPDATE;
  IF NOT FOUND OR v_row.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'This account could not be found.' USING ERRCODE = 'P0002';
  END IF;
  IF v_row.is_active THEN
    RAISE EXCEPTION 'Deactivate the account before deleting it.' USING ERRCODE = 'P0001';
  END IF;
  IF v_row.deletion_requested_at IS NOT NULL THEN
    RETURN v_row.deletion_requested_at + interval '3 days';
  END IF;
  UPDATE public.profiles SET deletion_requested_at = now(), deletion_requested_by = auth.uid() WHERE id = p_profile;
  INSERT INTO public.audit_log (actor_id, action, entity, entity_id, details, source)
  VALUES (auth.uid(), 'user.deletion_requested', 'profiles', p_profile::text,
          jsonb_build_object('deletes_after', now() + interval '3 days'), 'app');
  RETURN now() + interval '3 days';
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_account_deletion(p_profile uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT private.is_admin() THEN
    RAISE EXCEPTION 'Only an administrator can recover accounts.' USING ERRCODE = '42501';
  END IF;
  UPDATE public.profiles SET deletion_requested_at = NULL, deletion_requested_by = NULL
  WHERE id = p_profile AND deleted_at IS NULL AND deletion_requested_at IS NOT NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This account is not waiting to be deleted (it may already be deleted).' USING ERRCODE = 'P0002';
  END IF;
  INSERT INTO public.audit_log (actor_id, action, entity, entity_id, details, source)
  VALUES (auth.uid(), 'user.deletion_cancelled', 'profiles', p_profile::text, '{}'::jsonb, 'app');
END;
$$;

REVOKE EXECUTE ON FUNCTION public.request_account_deletion(uuid), public.cancel_account_deletion(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_account_deletion(uuid), public.cancel_account_deletion(uuid) TO authenticated;

/**
 * Anonymises every account whose 3-day window has passed and returns their ids so the caller can delete the logins.
 * Service role only.
 */
CREATE OR REPLACE FUNCTION public.purge_due_deletions()
RETURNS SETOF uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_id uuid;
BEGIN
  FOR v_id IN
    SELECT id FROM public.profiles
    WHERE deletion_requested_at IS NOT NULL AND deleted_at IS NULL
      AND deletion_requested_at <= now() - interval '3 days' AND NOT is_active
    FOR UPDATE SKIP LOCKED
  LOOP
    -- Forms they never submitted go; submitted feedback stays as anonymous answers.
    UPDATE public.notifications SET assignment_id = NULL
    WHERE assignment_id IN (SELECT id FROM public.assignments WHERE assessor_id = v_id AND status <> 'submitted');
    DELETE FROM public.responses
    WHERE assignment_id IN (SELECT id FROM public.assignments WHERE assessor_id = v_id AND status <> 'submitted');
    DELETE FROM public.assignments WHERE assessor_id = v_id AND status <> 'submitted';

    -- Reporting lines, memberships, access and relationships.
    UPDATE public.profiles SET manager_id = NULL WHERE manager_id = v_id;
    UPDATE public.talents SET immediate_manager_id = NULL WHERE immediate_manager_id = v_id;
    DELETE FROM public.talent_managers WHERE manager_profile_id = v_id;
    DELETE FROM public.peer_relationships WHERE employee_id = v_id OR peer_id = v_id;
    DELETE FROM public.external_raters WHERE employee_id = v_id OR rater_id = v_id;
    DELETE FROM public.external_evaluators WHERE external_id = v_id OR evaluator_id = v_id;
    DELETE FROM public.evaluation_links WHERE profile_id = v_id;
    DELETE FROM public.module_access WHERE profile_id = v_id;
    DELETE FROM public.user_group_members WHERE profile_id = v_id;
    DELETE FROM public.notification_preferences WHERE profile_id = v_id;
    DELETE FROM public.notification_digest_queue WHERE profile_id = v_id;
    DELETE FROM public.report_shares WHERE shared_with = v_id;

    -- Name and email go; the person stays as "Deleted person xxxx" so reports about them still work.
    UPDATE public.profiles SET
      full_name = 'Deleted person ' || upper(left(v_id::text, 4)),
      email = 'deleted-' || v_id::text || '@deleted.invalid',
      manager_id = NULL,
      organisation = NULL,
      deleted_at = now()
    WHERE id = v_id;

    INSERT INTO public.audit_log (actor_id, action, entity, entity_id, details, source)
    VALUES (NULL, 'user.deleted', 'profiles', v_id::text, '{}'::jsonb, 'app');
    RETURN NEXT v_id;
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.purge_due_deletions() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_due_deletions() TO service_role;

-- Hourly purge, through the purge-deleted-accounts edge function (same secret as the daily scheduler).
DO $$
BEGIN
  PERFORM cron.unschedule('purge-deleted-accounts') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'purge-deleted-accounts');
  PERFORM cron.schedule(
    'purge-deleted-accounts',
    '15 * * * *',
    $job$
    select net.http_post(
      url := 'https://ihjpihouoidogkvthhik.supabase.co/functions/v1/purge-deleted-accounts',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
      ),
      body := '{}'::jsonb
    );
    $job$
  );
END $$;

-- 3. Dashboard categories ---------------------------------------------------------------
DROP FUNCTION IF EXISTS public.readiness_ranking(uuid);
CREATE FUNCTION public.readiness_ranking(p_cycle_id uuid)
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
  rank integer,
  category text
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
  ),
  labelled AS (
    SELECT c.*, p.full_name,
      CASE WHEN p.deleted_at IS NOT NULL THEN 'deleted'
           WHEN p.person_type = 'external' THEN 'outside'
           ELSE 'employee' END AS category
    FROM counted c
    JOIN public.talents t ON t.id = c.talent_id
    JOIN public.profiles p ON p.id = t.profile_id
  )
  SELECT
    l.talent_id,
    l.full_name AS talent_name,
    l.leading_self_gap, l.leading_others_gap, l.leading_business_gap, l.leading_change_gap,
    l.overall_gap,
    COALESCE(l.categories_above_one, 0) AS categories_above_one,
    CASE
      WHEN l.overall_gap IS NULL THEN 'Insufficient feedback'
      WHEN l.overall_gap <= 1 AND COALESCE(l.categories_above_one, 0) = 0 THEN 'Ready'
      WHEN COALESCE(l.categories_above_one, 0) <= 1 THEN 'Developing'
      ELSE 'Not yet ready'
    END AS status,
    (rank() OVER (PARTITION BY l.category ORDER BY l.overall_gap ASC NULLS LAST, l.full_name))::integer AS rank,
    l.category
  FROM labelled l
  ORDER BY array_position(ARRAY['employee', 'outside', 'deleted'], l.category), rank;
$$;
REVOKE EXECUTE ON FUNCTION public.readiness_ranking(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.readiness_ranking(uuid) TO authenticated;
