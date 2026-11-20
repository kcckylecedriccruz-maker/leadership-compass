/*
  # Restarting a cycle also clears its AI summaries and insights (the answers they were based on are removed).
*/
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
  DELETE FROM public.ai_person_summaries WHERE cycle_id = p_cycle;
  DELETE FROM public.ai_cycle_insights WHERE cycle_id = p_cycle;
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
