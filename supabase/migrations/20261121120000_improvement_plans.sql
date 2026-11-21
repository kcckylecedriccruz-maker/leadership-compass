/*
  # AI improvement plans ("How to improve" on a report)

  - ai_improvement_plans: one saved plan per person, cycle and language (en / fil). Built from all feedback but written
    as themes only (no quotes).
  - Read: administrators; managers an administrator shared that person's report with; the person themselves once an
    administrator has released the plan and their report is visible to them.
  - Writes only through the ai-insights edge function (service role).
  - Restarting or deleting a cycle removes its plans (restart below, delete through ON DELETE CASCADE).
*/
CREATE TABLE IF NOT EXISTS public.ai_improvement_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id uuid NOT NULL REFERENCES public.cycles(id) ON DELETE CASCADE,
  talent_id uuid NOT NULL REFERENCES public.talents(id) ON DELETE CASCADE,
  language text NOT NULL CHECK (language IN ('en', 'fil')),
  content jsonb NOT NULL,
  model text NOT NULL,
  generated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  generated_at timestamptz NOT NULL DEFAULT now(),
  released_at timestamptz,
  released_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  UNIQUE (cycle_id, talent_id, language)
);

ALTER TABLE public.ai_improvement_plans ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_improvement_plans FROM anon, authenticated;
GRANT SELECT ON public.ai_improvement_plans TO authenticated;

DROP POLICY IF EXISTS ai_improvement_plans_read ON public.ai_improvement_plans;
CREATE POLICY ai_improvement_plans_read ON public.ai_improvement_plans FOR SELECT TO authenticated
USING (
  private.is_admin()
  OR EXISTS (
    SELECT 1 FROM public.report_shares s
    WHERE s.cycle_id = ai_improvement_plans.cycle_id AND s.talent_id = ai_improvement_plans.talent_id AND s.shared_with = auth.uid()
  )
  OR (
    released_at IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.talents t WHERE t.id = ai_improvement_plans.talent_id AND t.profile_id = auth.uid())
    AND private.can_view_cycle_report(cycle_id, talent_id)
  )
);

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
  DELETE FROM public.ai_improvement_plans WHERE cycle_id = p_cycle;
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
