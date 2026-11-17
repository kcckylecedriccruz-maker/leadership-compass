-- Lock assessor edits at the cycle close date
--
-- Assessor edits (draft saves, submissions, reopen) previously depended only on the cycle status,
-- which the daily scheduler sets. Between a cycle's close date and the next scheduler run, forms
-- stayed editable. This makes the database check the close date directly.
-- Idempotent: CREATE OR REPLACE.

CREATE OR REPLACE FUNCTION private.is_assignment_editable_by_me(p_assignment_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $function$
SELECT EXISTS (
  SELECT 1
  FROM public.assignments a
  JOIN public.cycles c ON c.id = a.cycle_id
  WHERE a.id = p_assignment_id
    AND a.assessor_id = auth.uid()
    AND a.status <> 'submitted'
    AND c.status = 'open'
    AND now() < c.closes_at
);
$function$;
