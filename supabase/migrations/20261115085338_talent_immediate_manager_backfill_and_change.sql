/*
# Sync talent immediate managers with assignments

1. Backfill (one time, additive)
- Only talents whose immediate_manager_id is empty are considered.
- A manager is taken from their Immediate manager assignments, preferring the most recent open cycle.
- Talents whose Immediate manager assignments point at more than one person are NOT changed; they are reported as conflicts.
- Each backfilled talent gets an audit_log entry.
- No existing values are overwritten and no rows are deleted.

2. New function: set_talent_immediate_manager(talent, manager)
- Admin only. Sets talents.immediate_manager_id and replaces the assessor on Immediate manager assignments in open or draft cycles.
- Only assignments with status not_started are replaced. Draft and submitted assignments are never changed and are returned as skipped.
- If the new manager is already an assessor for the talent in one of those cycles, the whole change is rejected.
- Writes an audit_log entry describing the change.

3. Security
- Function runs as SECURITY DEFINER with an empty search_path and an explicit admin check.
- EXECUTE is revoked from PUBLIC and anon and granted to authenticated only.

## Notes
1. Existing talents, assignments and cycles are not deleted or reset.
2. The backfill is a one-time statement and is safe to re-run because it only touches talents with an empty manager.
*/

WITH candidates AS (
  SELECT
    t.id AS talent_id,
    (
      SELECT a.assessor_id
      FROM public.assignments a
      JOIN public.cycles c ON c.id = a.cycle_id
      WHERE a.talent_id = t.id AND a.classification = 'immediate_manager'
      ORDER BY (c.status = 'open') DESC, c.opens_at DESC
      LIMIT 1
    ) AS manager_id,
    (
      SELECT count(DISTINCT a.assessor_id)
      FROM public.assignments a
      WHERE a.talent_id = t.id AND a.classification = 'immediate_manager'
    ) AS distinct_managers
  FROM public.talents t
  WHERE t.immediate_manager_id IS NULL
),
backfilled AS (
  UPDATE public.talents t
  SET immediate_manager_id = c.manager_id
  FROM candidates c
  WHERE t.id = c.talent_id
    AND c.manager_id IS NOT NULL
    AND c.distinct_managers = 1
  RETURNING t.id AS talent_id, t.immediate_manager_id AS manager_id
)
INSERT INTO public.audit_log (actor_id, action, entity, entity_id, details)
SELECT
  NULL,
  'talent.immediate_manager_backfilled',
  'talent',
  b.talent_id::text,
  jsonb_build_object('manager_id', b.manager_id, 'source', 'immediate_manager assignment')
FROM backfilled b;

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

  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_manager_id AND role IN ('manager', 'admin')) THEN
    RAISE EXCEPTION 'The immediate manager must be a manager account.' USING ERRCODE = '22023';
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
