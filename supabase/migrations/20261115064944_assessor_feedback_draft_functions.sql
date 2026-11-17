/*
# Assessor feedback drafts: save and clear

Plain-English summary
Lets an assessor save or clear their feedback for one talent while the cycle is open. Both actions run on the server, confirm that the signed-in person is the assessor and that the assessment can still be changed, and then update the stored ratings and notes in one step.

## 1. New functions
- save_assessment_draft(assignment id, list of answers): stores each complete answer (a rating from 1 to 5 and a behaviour note) against its competency, removes stored answers that are no longer complete, and sets the assessment to Draft. Each answer is identified by its item number, 1 to 19.
- clear_assessment_draft(assignment id): removes every stored answer for the assessment and sets it back to Not started.

## 2. Security
- Both functions run with elevated rights so they can write response rows and the status, but each first checks that the caller is the assessor, the assessment is not submitted and the cycle is open.
- Default public and anonymous access is removed. Only signed-in users can call them.
- No table privileges or row rules are changed.

## Important notes
1. An item with only a rating, or only a note, is not stored, because the database requires both. The app tells the assessor which items are not yet saved.
2. Submitting is handled by a separate server function, not by this migration.
*/

CREATE OR REPLACE FUNCTION public.save_assessment_draft(p_assignment_id uuid, p_responses jsonb)
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
  v_kept_ids uuid[] := ARRAY[]::uuid[];
BEGIN
  IF NOT private.is_assignment_editable_by_me(p_assignment_id) THEN
    RAISE EXCEPTION 'This assessment cannot be changed right now.' USING ERRCODE = '42501';
  END IF;

  IF jsonb_typeof(p_responses) <> 'array' OR jsonb_array_length(p_responses) > 19 THEN
    RAISE EXCEPTION 'The feedback is not in the right format.' USING ERRCODE = '22023';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_responses) LOOP
    v_sort_order := (v_item ->> 'sort_order')::integer;
    v_rating := (v_item ->> 'rating')::integer;
    v_note := btrim(COALESCE(v_item ->> 'behaviour_note', ''));

    IF v_sort_order IS NULL OR v_sort_order NOT BETWEEN 1 AND 19
      OR v_rating IS NULL OR v_rating NOT BETWEEN 1 AND 5
      OR v_note = '' OR length(v_note) > 2000 THEN
      RAISE EXCEPTION 'Each answer needs an item number from 1 to 19, a rating from 1 to 5 and a behaviour note.' USING ERRCODE = '22023';
    END IF;

    SELECT c.id INTO v_competency_id FROM public.competencies c WHERE c.sort_order = v_sort_order;

    INSERT INTO public.responses (assignment_id, competency_id, rating, behaviour_note)
    VALUES (p_assignment_id, v_competency_id, v_rating, v_note)
    ON CONFLICT (assignment_id, competency_id)
    DO UPDATE SET rating = EXCLUDED.rating, behaviour_note = EXCLUDED.behaviour_note;

    v_kept_ids := array_append(v_kept_ids, v_competency_id);
  END LOOP;

  DELETE FROM public.responses
  WHERE assignment_id = p_assignment_id
    AND NOT (competency_id = ANY (v_kept_ids));

  UPDATE public.assignments SET status = 'draft' WHERE id = p_assignment_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.clear_assessment_draft(p_assignment_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT private.is_assignment_editable_by_me(p_assignment_id) THEN
    RAISE EXCEPTION 'This assessment cannot be changed right now.' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.responses WHERE assignment_id = p_assignment_id;
  UPDATE public.assignments SET status = 'not_started' WHERE id = p_assignment_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.save_assessment_draft(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_assessment_draft(uuid, jsonb) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.clear_assessment_draft(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clear_assessment_draft(uuid) TO authenticated;
