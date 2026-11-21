/*
  # Manager feedback on improvement plans

  - plan_notes: one note per author per focus area (scope = competency name) or for the whole plan (scope = 'overall'),
    with an optional verdict (agree / adjust / disagree) and free text. plan_generated_at records which version of the
    plan the note was written on, so notes on an earlier plan can be labelled.
  - Write: administrators, and the immediate or skip-level manager when the report was shared with them.
  - Read: administrators and those managers (all notes); the employee only notes marked visible_to_employee, once a
    plan has been released to them and their report is available.
  - visible_to_employee is set by the immediate manager or an administrator.
  - plan_note_summary(): administrators, verdict counts per competency.
*/
CREATE TABLE IF NOT EXISTS public.plan_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id uuid NOT NULL REFERENCES public.cycles(id) ON DELETE CASCADE,
  talent_id uuid NOT NULL REFERENCES public.talents(id) ON DELETE CASCADE,
  author_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  scope text NOT NULL CHECK (char_length(scope) BETWEEN 1 AND 120),
  verdict text CHECK (verdict IS NULL OR verdict IN ('agree', 'adjust', 'disagree')),
  note text NOT NULL DEFAULT '' CHECK (char_length(note) <= 2000),
  visible_to_employee boolean NOT NULL DEFAULT false,
  plan_generated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cycle_id, talent_id, author_id, scope)
);

ALTER TABLE public.plan_notes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.plan_notes FROM anon, authenticated;
GRANT SELECT ON public.plan_notes TO authenticated;

DROP TRIGGER IF EXISTS audit_row_change ON public.plan_notes;
CREATE TRIGGER audit_row_change AFTER INSERT OR UPDATE OR DELETE ON public.plan_notes
FOR EACH ROW EXECUTE FUNCTION private.audit_row_change();

/** Administrators, or a manager this person's report was shared with for this cycle. */
CREATE OR REPLACE FUNCTION private.can_note_plan(p_cycle_id uuid, p_talent_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT private.is_admin() OR EXISTS (
    SELECT 1 FROM public.report_shares s
    WHERE s.cycle_id = p_cycle_id AND s.talent_id = p_talent_id AND s.shared_with = auth.uid()
  );
$$;
REVOKE EXECUTE ON FUNCTION private.can_note_plan(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.can_note_plan(uuid, uuid) TO authenticated;

DROP POLICY IF EXISTS plan_notes_read ON public.plan_notes;
CREATE POLICY plan_notes_read ON public.plan_notes FOR SELECT TO authenticated
USING (
  private.can_note_plan(cycle_id, talent_id)
  OR (
    visible_to_employee
    AND EXISTS (SELECT 1 FROM public.talents t WHERE t.id = plan_notes.talent_id AND t.profile_id = auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.ai_improvement_plans p
      WHERE p.cycle_id = plan_notes.cycle_id AND p.talent_id = plan_notes.talent_id AND p.released_at IS NOT NULL
    )
    AND private.can_view_cycle_report(cycle_id, talent_id)
  )
);

CREATE OR REPLACE FUNCTION public.save_plan_note(p_cycle_id uuid, p_talent_id uuid, p_scope text, p_verdict text, p_note text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_id uuid;
  v_generated timestamptz;
BEGIN
  IF NOT private.can_note_plan(p_cycle_id, p_talent_id) THEN
    RAISE EXCEPTION 'Only administrators, and managers this report was shared with, can add notes.' USING ERRCODE = '42501';
  END IF;
  IF p_verdict IS NOT NULL AND p_verdict NOT IN ('agree', 'adjust', 'disagree') THEN
    RAISE EXCEPTION 'Choose Agree, Adjust or Disagree.' USING ERRCODE = '22023';
  END IF;
  IF coalesce(btrim(p_scope), '') = '' OR char_length(p_scope) > 120 THEN
    RAISE EXCEPTION 'The note needs a focus area.' USING ERRCODE = '22023';
  END IF;
  IF char_length(coalesce(p_note, '')) > 2000 THEN
    RAISE EXCEPTION 'Notes can be up to 2000 characters.' USING ERRCODE = '22023';
  END IF;
  IF p_verdict IS NULL AND coalesce(btrim(p_note), '') = '' THEN
    RAISE EXCEPTION 'Choose a verdict or write a note.' USING ERRCODE = '22023';
  END IF;

  SELECT max(generated_at) INTO v_generated FROM public.ai_improvement_plans WHERE cycle_id = p_cycle_id AND talent_id = p_talent_id;

  INSERT INTO public.plan_notes (cycle_id, talent_id, author_id, scope, verdict, note, plan_generated_at)
  VALUES (p_cycle_id, p_talent_id, auth.uid(), btrim(p_scope), p_verdict, btrim(coalesce(p_note, '')), v_generated)
  ON CONFLICT (cycle_id, talent_id, author_id, scope)
  DO UPDATE SET verdict = EXCLUDED.verdict, note = EXCLUDED.note, plan_generated_at = EXCLUDED.plan_generated_at, updated_at = now()
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_plan_note(p_note_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  DELETE FROM public.plan_notes WHERE id = p_note_id AND (author_id = auth.uid() OR private.is_admin());
  IF NOT FOUND THEN
    RAISE EXCEPTION 'You can only delete your own notes.' USING ERRCODE = '42501';
  END IF;
END;
$$;

/** The immediate manager or an administrator decides whether the employee may see a note. */
CREATE OR REPLACE FUNCTION public.set_plan_note_visibility(p_note_id uuid, p_visible boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_talent uuid;
BEGIN
  SELECT talent_id INTO v_talent FROM public.plan_notes WHERE id = p_note_id;
  IF v_talent IS NULL THEN
    RAISE EXCEPTION 'That note could not be found.' USING ERRCODE = 'P0002';
  END IF;
  IF NOT (
    private.is_admin()
    OR EXISTS (SELECT 1 FROM public.talents t JOIN public.profiles p ON p.id = t.profile_id WHERE t.id = v_talent AND p.manager_id = auth.uid())
  ) THEN
    RAISE EXCEPTION 'Only the immediate manager or an administrator can decide what the employee sees.' USING ERRCODE = '42501';
  END IF;
  UPDATE public.plan_notes SET visible_to_employee = coalesce(p_visible, false), updated_at = now() WHERE id = p_note_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.plan_note_summary()
RETURNS TABLE (scope text, agree bigint, adjust bigint, disagree bigint, notes bigint)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT private.is_admin() THEN
    RAISE EXCEPTION 'Only administrators can see this summary.' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT n.scope,
    count(*) FILTER (WHERE n.verdict = 'agree'),
    count(*) FILTER (WHERE n.verdict = 'adjust'),
    count(*) FILTER (WHERE n.verdict = 'disagree'),
    count(*) FILTER (WHERE btrim(n.note) <> '')
  FROM public.plan_notes n
  GROUP BY n.scope
  ORDER BY count(*) DESC;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.save_plan_note(uuid, uuid, text, text, text), public.delete_plan_note(uuid),
  public.set_plan_note_visibility(uuid, boolean), public.plan_note_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_plan_note(uuid, uuid, text, text, text), public.delete_plan_note(uuid),
  public.set_plan_note_visibility(uuid, boolean), public.plan_note_summary() TO authenticated;
