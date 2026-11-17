/*
# Assignment management: access rules, audited changes and audit details

Plain-English summary
This migration lets managers see the people and cycles they need to set up assessments, adds two admin-only actions that change or remove an assessment (both recorded in the audit trail), and gives the audit trail a place to store what changed. Nothing is dropped, renamed or retyped.

## 1. Modified tables
- audit_log: new column details (jsonb, defaults to an empty object) holding the before and after values of a change.

## 2. Modified access helpers
- private.can_read_profile: an immediate manager can now also read the profiles of assessors on assessments for talents they manage, so assessor names show on their screen.
- private.can_read_cycle: an immediate manager can read every cycle, so they can choose one when setting up assessments. Cycles hold names and dates only.

## 3. New functions (admin only, audited)
- set_assignment_classification(assignment id, new classification): changes an assessor's type after checking it still fits the assessor (Self must be the talent, Immediate manager must be the talent's manager, Direct report and Peer must be neither). Writes an audit entry.
- remove_assignment(assignment id): removes an assessment. Refused if the assessor has started or submitted any ratings, so no feedback is ever lost. Email log entries for the removed assessment are kept but unlinked. Writes an audit entry.

## 4. Security
- Both new functions check the caller is an admin on the server, set a fixed search path, and are callable only by signed-in users (not the anonymous role).
- No table gains new direct write access.

## Important notes
1. Assessor type rules are enforced here and again in the server function that adds assessors, so they cannot be bypassed from the browser.
2. Removing an assessment never deletes ratings. If ratings exist, removal is refused.
*/

ALTER TABLE public.audit_log ADD COLUMN IF NOT EXISTS details jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE OR REPLACE FUNCTION private.can_read_profile(p_profile_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p_profile_id = auth.uid()
    OR private.is_admin()
    OR EXISTS (
      SELECT 1 FROM public.talents t
      WHERE t.profile_id = p_profile_id
        AND (t.immediate_manager_id = auth.uid() OR private.is_assessor_of_talent(t.id))
    )
    OR EXISTS (
      SELECT 1 FROM public.assignments a
      WHERE a.assessor_id = p_profile_id
        AND private.manages_talent(a.talent_id)
    );
$$;

CREATE OR REPLACE FUNCTION private.can_read_cycle(p_cycle_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT private.is_admin()
    OR EXISTS (
      SELECT 1 FROM public.talents t WHERE t.immediate_manager_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.assignments a
      WHERE a.cycle_id = p_cycle_id
        AND (a.assessor_id = auth.uid() OR private.manages_talent(a.talent_id))
    );
$$;

CREATE OR REPLACE FUNCTION public.set_assignment_classification(p_assignment_id uuid, p_classification text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_assignment public.assignments%ROWTYPE;
  v_talent public.talents%ROWTYPE;
  v_is_self boolean;
  v_is_manager boolean;
BEGIN
  IF NOT private.is_admin() THEN
    RAISE EXCEPTION 'You do not have permission to change this assessment.' USING ERRCODE = '42501';
  END IF;

  IF p_classification NOT IN ('immediate_manager', 'direct_report', 'peer', 'self') THEN
    RAISE EXCEPTION 'Choose a valid assessor type.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_assignment FROM public.assignments WHERE id = p_assignment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This assessment could not be found.' USING ERRCODE = 'P0002';
  END IF;

  IF v_assignment.classification = p_classification THEN
    RETURN;
  END IF;

  SELECT * INTO v_talent FROM public.talents WHERE id = v_assignment.talent_id;
  v_is_self := v_assignment.assessor_id = v_talent.profile_id;
  v_is_manager := COALESCE(v_assignment.assessor_id = v_talent.immediate_manager_id, false);

  IF p_classification = 'self' AND NOT v_is_self THEN
    RAISE EXCEPTION 'Self can only be used when the talent is the assessor.' USING ERRCODE = '22023';
  END IF;
  IF p_classification = 'immediate_manager' AND NOT v_is_manager THEN
    RAISE EXCEPTION 'Immediate manager can only be used for the talent''s immediate manager.' USING ERRCODE = '22023';
  END IF;
  IF p_classification IN ('direct_report', 'peer') AND (v_is_self OR v_is_manager) THEN
    RAISE EXCEPTION 'The talent or their immediate manager must keep the Self or Immediate manager type.' USING ERRCODE = '22023';
  END IF;

  UPDATE public.assignments SET classification = p_classification WHERE id = p_assignment_id;

  INSERT INTO public.audit_log (actor_id, action, entity, entity_id, details)
  VALUES (
    auth.uid(),
    'assignment.classification_changed',
    'assignment',
    p_assignment_id::text,
    jsonb_build_object(
      'cycle_id', v_assignment.cycle_id,
      'talent_id', v_assignment.talent_id,
      'assessor_id', v_assignment.assessor_id,
      'from', v_assignment.classification,
      'to', p_classification
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_assignment(p_assignment_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_assignment public.assignments%ROWTYPE;
BEGIN
  IF NOT private.is_admin() THEN
    RAISE EXCEPTION 'You do not have permission to remove this assessment.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_assignment FROM public.assignments WHERE id = p_assignment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This assessment could not be found.' USING ERRCODE = 'P0002';
  END IF;

  IF EXISTS (SELECT 1 FROM public.responses WHERE assignment_id = p_assignment_id) THEN
    RAISE EXCEPTION 'This assessor has already started feedback, so the assessment cannot be removed.' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.notifications SET assignment_id = NULL WHERE assignment_id = p_assignment_id;
  DELETE FROM public.assignments WHERE id = p_assignment_id;

  INSERT INTO public.audit_log (actor_id, action, entity, entity_id, details)
  VALUES (
    auth.uid(),
    'assignment.removed',
    'assignment',
    p_assignment_id::text,
    jsonb_build_object(
      'cycle_id', v_assignment.cycle_id,
      'talent_id', v_assignment.talent_id,
      'assessor_id', v_assignment.assessor_id,
      'classification', v_assignment.classification
    )
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_assignment_classification(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_assignment_classification(uuid, text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.remove_assignment(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remove_assignment(uuid) TO authenticated;
