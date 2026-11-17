/*
# Keep partial assessor drafts

Plain-English summary
Assessors can now save an item with only a rating, only a behaviour note, or neither. Saving keeps every item the assessor has touched and never removes an item that was saved earlier. Only Submit requires all 19 items to have both a rating and a behaviour note.

## 1. Changed columns
- responses.rating: may now be empty while an assessment is a draft. When present it must still be 1 to 5.
- responses.behaviour_note: may now be empty while an assessment is a draft. An empty note is stored as nothing, never as blank text.

## 2. Changed function
- save_assessment_draft(assignment id, list of answers): saves every item in the list, complete or partial. It no longer deletes stored items that are missing from the list.

## 3. Security
- Unchanged. Only the assessor can call it, and only while the assessment is editable and the cycle is open. Grants are unchanged.

## Important notes
1. Submitting still goes through the submit-assessment function, which requires all 19 items to have both a rating and a behaviour note before it marks the assessment submitted.
2. Submitted feedback is therefore always complete, because the submit function writes only complete answers.
*/

ALTER TABLE public.responses ALTER COLUMN rating DROP NOT NULL;
ALTER TABLE public.responses ALTER COLUMN behaviour_note DROP NOT NULL;

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
    v_note := NULLIF(btrim(COALESCE(v_item ->> 'behaviour_note', '')), '');

    IF v_sort_order IS NULL OR v_sort_order NOT BETWEEN 1 AND 19
      OR (v_rating IS NOT NULL AND v_rating NOT BETWEEN 1 AND 5)
      OR (v_note IS NOT NULL AND length(v_note) > 2000) THEN
      RAISE EXCEPTION 'Each answer needs an item number from 1 to 19, a rating from 1 to 5 if one is given, and a behaviour note of up to 2000 characters.' USING ERRCODE = '22023';
    END IF;

    SELECT c.id INTO v_competency_id FROM public.competencies c WHERE c.sort_order = v_sort_order;

    INSERT INTO public.responses (assignment_id, competency_id, rating, behaviour_note)
    VALUES (p_assignment_id, v_competency_id, v_rating, v_note)
    ON CONFLICT (assignment_id, competency_id)
    DO UPDATE SET rating = EXCLUDED.rating, behaviour_note = EXCLUDED.behaviour_note;
  END LOOP;

  UPDATE public.assignments SET status = 'draft' WHERE id = p_assignment_id;
END;
$$;

COMMENT ON FUNCTION public.save_assessment_draft(uuid, jsonb) IS
'Saves the assessor''s draft for one assessment. Every item sent is stored, including partial items with only a rating or only a behaviour note. Items not sent are left as they are; nothing already saved is deleted. Only the assessor can call it, and only while the assessment is editable and the cycle is open. Submission requires all 19 items and is handled by the submit-assessment function.';
