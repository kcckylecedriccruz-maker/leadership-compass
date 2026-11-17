/*
# Immediate manager is a relationship, not a role

1. Changed function
- set_talent_immediate_manager no longer requires the chosen person to have the manager or admin role.
- Any active person can be set as a talent's immediate manager. Their role is never changed.

2. Unchanged
- Admin-only access, assignment replacement rules (not_started only in open or draft cycles), and audit logging are the same.
- No talents, assignments, cycles, profiles or roles are deleted or modified by this migration.

3. Security
- Still SECURITY DEFINER with an empty search_path, and EXECUTE granted to authenticated only.
*/

CREATE OR REPLACE FUNCTION public.set_talent_immediate_manager(p_talent_id uuid, p_manager_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_talent public.talents%ROWTYPE;
  v_row record;
  v_replaced jsonb := '[]'::jsonb;
  v_skipped jsonb := '[]'::jsonb;
BEGIN
  IF NOT private.is_admin() THEN
    RAISE EXCEPTION 'You do not have permission to change this talent.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_talent FROM public.talents WHERE id = p_talent_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This talent could not be found.' USING ERRCODE = 'P0002';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_manager_id) THEN
    RAISE EXCEPTION 'The selected person could not be found.' USING ERRCODE = 'P0002';
  END IF;

  IF v_talent.immediate_manager_id IS NOT DISTINCT FROM p_manager_id THEN
    RETURN jsonb_build_object('replaced', v_replaced, 'skipped', v_skipped);
  END IF;

  UPDATE public.talents SET immediate_manager_id = p_manager_id WHERE id = p_talent_id;

  FOR v_row IN
    SELECT a.id, a.cycle_id, a.assessor_id, a.status
    FROM public.assignments a
    JOIN public.cycles c ON c.id = a.cycle_id
    WHERE a.talent_id = p_talent_id
      AND a.classification = 'immediate_manager'
      AND c.status IN ('open', 'draft')
      AND a.assessor_id IS DISTINCT FROM p_manager_id
    FOR UPDATE OF a
  LOOP
    IF v_row.status <> 'not_started' THEN
      v_skipped := v_skipped || jsonb_build_object(
        'assignment_id', v_row.id,
        'cycle_id', v_row.cycle_id,
        'status', v_row.status
      );
      CONTINUE;
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.assignments
      WHERE cycle_id = v_row.cycle_id AND talent_id = p_talent_id AND assessor_id = p_manager_id
    ) THEN
      RAISE EXCEPTION 'The new manager is already an assessor for this talent in an open or draft cycle.' USING ERRCODE = '23505';
    END IF;

    UPDATE public.assignments SET assessor_id = p_manager_id WHERE id = v_row.id;
    v_replaced := v_replaced || jsonb_build_object(
      'assignment_id', v_row.id,
      'cycle_id', v_row.cycle_id,
      'from_assessor_id', v_row.assessor_id
    );
  END LOOP;

  INSERT INTO public.audit_log (actor_id, action, entity, entity_id, details)
  VALUES (
    auth.uid(),
    'talent.immediate_manager_changed',
    'talent',
    p_talent_id::text,
    jsonb_build_object(
      'from_manager_id', v_talent.immediate_manager_id,
      'to_manager_id', p_manager_id,
      'replaced_assignments', v_replaced,
      'skipped_assignments', v_skipped
    )
  );

  RETURN jsonb_build_object('replaced', v_replaced, 'skipped', v_skipped);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_talent_immediate_manager(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_talent_immediate_manager(uuid, uuid) TO authenticated;
