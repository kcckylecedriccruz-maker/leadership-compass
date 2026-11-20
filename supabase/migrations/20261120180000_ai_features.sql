/*
  # AI features (Claude)

  - competencies.help: plain-English explanation per competency ({plain, looks_like[], not_like[], think_about}),
    drafted by Claude and edited by administrators. Readable by everyone who can read competencies.
  - ai_person_summaries: one AI feedback summary and development plan per person per cycle (admin-only).
  - ai_cycle_insights: one organisation-wide insight report per cycle, including themes from behaviour notes
    (admin-only).
  All AI writes go through the ai-insights edge function (service role); clients only read.
*/

ALTER TABLE public.competencies
  ADD COLUMN IF NOT EXISTS help jsonb,
  ADD COLUMN IF NOT EXISTS help_updated_at timestamptz;
GRANT SELECT (help, help_updated_at) ON public.competencies TO authenticated;

CREATE TABLE IF NOT EXISTS public.ai_person_summaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id uuid NOT NULL REFERENCES public.cycles(id) ON DELETE CASCADE,
  talent_id uuid NOT NULL REFERENCES public.talents(id) ON DELETE CASCADE,
  content jsonb NOT NULL,
  model text NOT NULL,
  generated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  generated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cycle_id, talent_id)
);

CREATE TABLE IF NOT EXISTS public.ai_cycle_insights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id uuid NOT NULL UNIQUE REFERENCES public.cycles(id) ON DELETE CASCADE,
  content jsonb NOT NULL,
  model text NOT NULL,
  generated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  generated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ai_person_summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_cycle_insights ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_person_summaries, public.ai_cycle_insights FROM anon, authenticated;
GRANT SELECT ON public.ai_person_summaries, public.ai_cycle_insights TO authenticated;

DROP POLICY IF EXISTS ai_person_summaries_admin ON public.ai_person_summaries;
CREATE POLICY ai_person_summaries_admin ON public.ai_person_summaries FOR SELECT TO authenticated USING (private.is_admin());
DROP POLICY IF EXISTS ai_cycle_insights_admin ON public.ai_cycle_insights;
CREATE POLICY ai_cycle_insights_admin ON public.ai_cycle_insights FOR SELECT TO authenticated USING (private.is_admin());

-- Deleting a cycle (delete_cycle) removes these through ON DELETE CASCADE.
