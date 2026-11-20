/*
  # Delete or restart a review cycle

  Administrators only. Both are destructive, so the caller must type the cycle's name to confirm.

  - restart_cycle(cycle, confirm_name): removes every answer in the cycle, puts each evaluation back to
    "not started", clears reminders, copy requests, reopen links, "dashboard ready" notices and report shares,
    and moves the cycle back to draft. The evaluations themselves are kept; opening the cycle again rebuilds
    them from the org structure.
  - delete_cycle(cycle, confirm_name): removes the cycle with its evaluations, answers, email log entries,
    notices and shares.

  Both write one summary row to the audit trail (with counts only; answers are never copied there).
*/

CREATE OR REPLACE FUNCTION private.cycle_for_destructive_action(p_cycle uuid, p_confirm_name text)
RETURNS public.cycles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_cycle public.cycles;
BEGIN
  IF NOT private.is_admin() THEN
    RAISE EXCEPTION 'Only administrators can delete or restart a cycle.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO v_cycle FROM public.cycles WHERE id = p_cycle FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This cycle no longer exists.' USING ERRCODE = 'no_data_found';
  END IF;
  IF lower(btrim(coalesce(p_confirm_name, ''))) <> lower(btrim(v_cycle.name)) THEN
    RAISE EXCEPTION 'Type the cycle name exactly to confirm.' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  RETURN v_cycle;
END;
$$;

REVOKE EXECUTE ON FUNCTION private.cycle_for_destructive_action(uuid, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.restart_cycle(p_cycle uuid, p_confirm_name text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_cycle public.cycles;
  v_answers integer;
  v_reset integer;
  v_shares integer;
BEGIN
  v_cycle := private.cycle_for_destructive_action(p_cycle, p_confirm_name);

  DELETE FROM public.responses r
  USING public.assignments a
  WHERE r.assignment_id = a.id AND a.cycle_id = p_cycle;
  GET DIAGNOSTICS v_answers = ROW_COUNT;

  UPDATE public.assignments
  SET status = 'not_started', submitted_at = NULL, last_reminded_at = NULL,
      copy_requested = false, edit_token_hash = NULL
  WHERE cycle_id = p_cycle
    AND (status <> 'not_started' OR submitted_at IS NOT NULL OR last_reminded_at IS NOT NULL
         OR copy_requested OR edit_token_hash IS NOT NULL);
  GET DIAGNOSTICS v_reset = ROW_COUNT;

  DELETE FROM public.notification_digest_queue WHERE cycle_id = p_cycle;
  DELETE FROM public.dashboard_ready_notices WHERE cycle_id = p_cycle;
  DELETE FROM public.report_shares WHERE cycle_id = p_cycle;
  GET DIAGNOSTICS v_shares = ROW_COUNT;

  UPDATE public.cycles SET status = 'draft' WHERE id = p_cycle AND status <> 'draft';

  INSERT INTO public.audit_log (actor_id, action, entity, entity_id, details, source)
  VALUES (auth.uid(), 'cycle.restarted', 'cycles', p_cycle::text,
          jsonb_build_object('name', v_cycle.name, 'previous_status', v_cycle.status,
                             'answers_removed', v_answers, 'evaluations_reset', v_reset,
                             'shares_removed', v_shares),
          'app');

  RETURN jsonb_build_object('answers_removed', v_answers, 'evaluations_reset', v_reset, 'shares_removed', v_shares);
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_cycle(p_cycle uuid, p_confirm_name text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_cycle public.cycles;
  v_answers integer;
  v_evaluations integer;
BEGIN
  v_cycle := private.cycle_for_destructive_action(p_cycle, p_confirm_name);

  DELETE FROM public.notifications
  WHERE cycle_id = p_cycle
     OR assignment_id IN (SELECT id FROM public.assignments WHERE cycle_id = p_cycle);
  DELETE FROM public.notification_digest_queue WHERE cycle_id = p_cycle;
  DELETE FROM public.dashboard_ready_notices WHERE cycle_id = p_cycle;
  DELETE FROM public.report_shares WHERE cycle_id = p_cycle;

  DELETE FROM public.responses r
  USING public.assignments a
  WHERE r.assignment_id = a.id AND a.cycle_id = p_cycle;
  GET DIAGNOSTICS v_answers = ROW_COUNT;

  DELETE FROM public.assignments WHERE cycle_id = p_cycle;
  GET DIAGNOSTICS v_evaluations = ROW_COUNT;

  DELETE FROM public.cycles WHERE id = p_cycle;

  INSERT INTO public.audit_log (actor_id, action, entity, entity_id, details, source)
  VALUES (auth.uid(), 'cycle.deleted', 'cycles', p_cycle::text,
          jsonb_build_object('name', v_cycle.name, 'status', v_cycle.status,
                             'evaluations_removed', v_evaluations, 'answers_removed', v_answers),
          'app');

  RETURN jsonb_build_object('evaluations_removed', v_evaluations, 'answers_removed', v_answers);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.restart_cycle(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.delete_cycle(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.restart_cycle(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_cycle(uuid, text) TO authenticated;
