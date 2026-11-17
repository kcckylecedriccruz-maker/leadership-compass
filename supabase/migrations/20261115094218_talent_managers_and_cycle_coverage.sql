/*
# Multiple immediate managers per talent, automatic manager assessments, and cycle coverage checks

Plain-English summary
- A talent can now have several immediate managers. One of them is marked primary.
- Every manager gets an Immediate manager assessment in every open and draft cycle.
- Removing a manager deletes only their unsubmitted, unstarted assessments. Submitted work is never touched.
- A cycle cannot be opened until every talent has at least one Immediate manager, one Direct report and one Peer assessment in it. This applies to manual and scheduled openings.
- Access rules that used the single manager column now read the new relationship table.
- Nothing is dropped or deleted. Roles are not changed.

## 1. New table: talent_managers
- talent_id (uuid, references talents)
- manager_profile_id (uuid, references profiles)
- is_primary (boolean, exactly one primary per talent)
- created_at (timestamptz)
- Primary key (talent_id, manager_profile_id) so each pair is unique.

## 2. Back-fill
- One talent_managers row per talent that had talents.immediate_manager_id, marked primary.
- Missing Immediate manager assessments are created in open and draft cycles for those managers. Pairs already assessing the talent in a cycle are left alone.
- Every backfilled row is written to the audit log.

## 3. Existing column kept as the primary manager
- talents.immediate_manager_id is kept and always mirrors the primary manager. It is not dropped.
- Direct writes to that column are blocked; it changes only through the sync below.

## 4. Automatic assessments and audit
- Adding a manager creates an Immediate manager assessment in every open and draft cycle, or reclassifies an unstarted assessment of that person for the talent.
- Removing a manager deletes only unsubmitted assessments without responses. If the manager has started feedback, the removal is refused with a message.
- Every add, remove, primary change and assessment change is written to the audit log.

## 5. Access rules updated
- Helpers, the talent and cycle read rules, and the assessor type rule use talent_managers instead of the single column.
- The old single-manager function is removed and replaced by set_talent_managers, which saves the full manager list and the primary in one step.

## 6. Cycle coverage
- public.cycle_coverage_gaps(cycle_id) lists talents missing a required group. Admins and the scheduler can call it.
- A database check blocks any change of a cycle to open while gaps exist. The error lists each talent and the missing groups.

## 7. Security
- talent_managers: signed-in users get SELECT only. Admins, the talent's managers and the talent can read rows through policy. Writes happen only through set_talent_managers and database triggers.
- set_talent_managers: admin only, EXECUTE granted to authenticated only.
- cycle_coverage_gaps: admin or service role only.
*/

CREATE TABLE IF NOT EXISTS public.talent_managers (
  talent_id uuid NOT NULL REFERENCES public.talents(id) ON DELETE RESTRICT,
  manager_profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (talent_id, manager_profile_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS talent_managers_one_primary_idx
  ON public.talent_managers (talent_id) WHERE is_primary;
CREATE INDEX IF NOT EXISTS talent_managers_manager_idx
  ON public.talent_managers (manager_profile_id);

ALTER TABLE public.talent_managers ENABLE ROW LEVEL SECURITY;

INSERT INTO public.talent_managers (talent_id, manager_profile_id, is_primary)
SELECT t.id, t.immediate_manager_id, true
FROM public.talents t
WHERE t.immediate_manager_id IS NOT NULL
ON CONFLICT (talent_id, manager_profile_id) DO NOTHING;

INSERT INTO public.audit_log (actor_id, action, entity, entity_id, details)
SELECT NULL, 'talent.manager_backfilled', 'talent', tm.talent_id::text,
  jsonb_build_object('manager_profile_id', tm.manager_profile_id, 'is_primary', tm.is_primary, 'source', 'immediate_manager_id')
FROM public.talent_managers tm;

WITH created AS (
  INSERT INTO public.assignments (cycle_id, talent_id, assessor_id, classification)
  SELECT c.id, tm.talent_id, tm.manager_profile_id, 'immediate_manager'
  FROM public.talent_managers tm
  CROSS JOIN public.cycles c
  WHERE c.status IN ('open', 'draft')
    AND NOT EXISTS (
      SELECT 1 FROM public.assignments a
      WHERE a.cycle_id = c.id AND a.talent_id = tm.talent_id AND a.assessor_id = tm.manager_profile_id
    )
  RETURNING id, cycle_id, talent_id, assessor_id
)
INSERT INTO public.audit_log (actor_id, action, entity, entity_id, details)
SELECT NULL, 'assignment.added', 'assignment', created.id::text,
  jsonb_build_object('cycle_id', created.cycle_id, 'talent_id', created.talent_id, 'assessor_id', created.assessor_id, 'classification', 'immediate_manager', 'source', 'backfill')
FROM created;

CREATE OR REPLACE FUNCTION private.sync_talent_managers(p_talent_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_primary uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.talent_managers WHERE talent_id = p_talent_id AND is_primary) THEN
    UPDATE public.talent_managers tm
    SET is_primary = true
    WHERE tm.talent_id = p_talent_id
      AND tm.manager_profile_id = (
        SELECT x.manager_profile_id
        FROM public.talent_managers x
        WHERE x.talent_id = p_talent_id
        ORDER BY x.created_at, x.manager_profile_id
        LIMIT 1
      );
  END IF;

  SELECT tm.manager_profile_id INTO v_primary
  FROM public.talent_managers tm
  WHERE tm.talent_id = p_talent_id AND tm.is_primary;

  PERFORM set_config('app.talent_manager_sync', 'on', true);
  UPDATE public.talents
  SET immediate_manager_id = v_primary
  WHERE id = p_talent_id AND immediate_manager_id IS DISTINCT FROM v_primary;
END;
$function$;

CREATE OR REPLACE FUNCTION private.guard_talent_immediate_manager()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
BEGIN
  IF NEW.immediate_manager_id IS DISTINCT FROM OLD.immediate_manager_id
     AND coalesce(current_setting('app.talent_manager_sync', true), '') <> 'on' THEN
    RAISE EXCEPTION 'Change immediate managers with the manager picker so every change is recorded.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS talents_immediate_manager_guard ON public.talents;
CREATE TRIGGER talents_immediate_manager_guard
  BEFORE UPDATE OF immediate_manager_id ON public.talents
  FOR EACH ROW EXECUTE FUNCTION private.guard_talent_immediate_manager();

CREATE OR REPLACE FUNCTION private.talent_manager_before_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.talents t WHERE t.id = NEW.talent_id AND t.profile_id = NEW.manager_profile_id
  ) THEN
    RAISE EXCEPTION 'A talent cannot be their own immediate manager.' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION private.talent_manager_after_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_cycle record;
  v_existing public.assignments%ROWTYPE;
  v_new_id uuid;
BEGIN
  FOR v_cycle IN SELECT c.id FROM public.cycles c WHERE c.status IN ('open', 'draft') LOOP
    SELECT * INTO v_existing
    FROM public.assignments a
    WHERE a.cycle_id = v_cycle.id AND a.talent_id = NEW.talent_id AND a.assessor_id = NEW.manager_profile_id
    FOR UPDATE;

    IF FOUND THEN
      IF v_existing.classification = 'immediate_manager' THEN
        CONTINUE;
      END IF;
      IF v_existing.status = 'submitted' OR EXISTS (SELECT 1 FROM public.responses r WHERE r.assignment_id = v_existing.id) THEN
        RAISE EXCEPTION 'This person has already started feedback for this talent in an open or draft cycle, so they cannot be made the immediate manager there.' USING ERRCODE = 'P0001';
      END IF;

      UPDATE public.assignments SET classification = 'immediate_manager' WHERE id = v_existing.id;
      INSERT INTO public.audit_log (actor_id, action, entity, entity_id, details)
      VALUES (auth.uid(), 'assignment.classification_changed', 'assignment', v_existing.id::text,
        jsonb_build_object('cycle_id', v_cycle.id, 'talent_id', NEW.talent_id, 'assessor_id', NEW.manager_profile_id, 'from', v_existing.classification, 'to', 'immediate_manager'));
    ELSE
      INSERT INTO public.assignments (cycle_id, talent_id, assessor_id, classification)
      VALUES (v_cycle.id, NEW.talent_id, NEW.manager_profile_id, 'immediate_manager')
      RETURNING id INTO v_new_id;
      INSERT INTO public.audit_log (actor_id, action, entity, entity_id, details)
      VALUES (auth.uid(), 'assignment.added', 'assignment', v_new_id::text,
        jsonb_build_object('cycle_id', v_cycle.id, 'talent_id', NEW.talent_id, 'assessor_id', NEW.manager_profile_id, 'classification', 'immediate_manager'));
    END IF;
  END LOOP;

  INSERT INTO public.audit_log (actor_id, action, entity, entity_id, details)
  VALUES (auth.uid(), 'talent.manager_added', 'talent', NEW.talent_id::text,
    jsonb_build_object('manager_profile_id', NEW.manager_profile_id, 'is_primary', NEW.is_primary));

  PERFORM private.sync_talent_managers(NEW.talent_id);
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION private.talent_manager_after_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_cycle record;
  v_row record;
BEGIN
  FOR v_cycle IN SELECT c.id FROM public.cycles c WHERE c.status IN ('open', 'draft') LOOP
    FOR v_row IN
      SELECT a.id, a.cycle_id
      FROM public.assignments a
      WHERE a.cycle_id = v_cycle.id
        AND a.talent_id = OLD.talent_id
        AND a.assessor_id = OLD.manager_profile_id
        AND a.classification = 'immediate_manager'
        AND a.status <> 'submitted'
      FOR UPDATE
    LOOP
      IF EXISTS (SELECT 1 FROM public.responses r WHERE r.assignment_id = v_row.id) THEN
        RAISE EXCEPTION 'This manager has already started feedback for this talent, so they cannot be removed yet.' USING ERRCODE = 'P0001';
      END IF;

      UPDATE public.notifications SET assignment_id = NULL WHERE assignment_id = v_row.id;
      DELETE FROM public.assignments WHERE id = v_row.id;
      INSERT INTO public.audit_log (actor_id, action, entity, entity_id, details)
      VALUES (auth.uid(), 'assignment.removed', 'assignment', v_row.id::text,
        jsonb_build_object('cycle_id', v_row.cycle_id, 'talent_id', OLD.talent_id, 'assessor_id', OLD.manager_profile_id, 'classification', 'immediate_manager'));
    END LOOP;
  END LOOP;

  INSERT INTO public.audit_log (actor_id, action, entity, entity_id, details)
  VALUES (auth.uid(), 'talent.manager_removed', 'talent', OLD.talent_id::text,
    jsonb_build_object('manager_profile_id', OLD.manager_profile_id, 'was_primary', OLD.is_primary));

  PERFORM private.sync_talent_managers(OLD.talent_id);
  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS talent_managers_before_insert ON public.talent_managers;
CREATE TRIGGER talent_managers_before_insert
  BEFORE INSERT ON public.talent_managers
  FOR EACH ROW EXECUTE FUNCTION private.talent_manager_before_insert();

DROP TRIGGER IF EXISTS talent_managers_after_insert ON public.talent_managers;
CREATE TRIGGER talent_managers_after_insert
  AFTER INSERT ON public.talent_managers
  FOR EACH ROW EXECUTE FUNCTION private.talent_manager_after_insert();

DROP TRIGGER IF EXISTS talent_managers_after_delete ON public.talent_managers;
CREATE TRIGGER talent_managers_after_delete
  AFTER DELETE ON public.talent_managers
  FOR EACH ROW EXECUTE FUNCTION private.talent_manager_after_delete();

CREATE OR REPLACE FUNCTION private.manages_talent(p_talent_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $function$
SELECT EXISTS (
  SELECT 1 FROM public.talent_managers tm
  WHERE tm.talent_id = p_talent_id AND tm.manager_profile_id = auth.uid()
);
$function$;

CREATE OR REPLACE FUNCTION private.can_read_profile(p_profile_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $function$
SELECT p_profile_id = auth.uid()
OR private.is_admin()
OR EXISTS (
  SELECT 1 FROM public.talents t
  WHERE t.profile_id = p_profile_id
    AND (private.manages_talent(t.id) OR private.is_assessor_of_talent(t.id))
)
OR EXISTS (
  SELECT 1 FROM public.assignments a
  WHERE a.assessor_id = p_profile_id
    AND private.manages_talent(a.talent_id)
);
$function$;

CREATE OR REPLACE FUNCTION private.can_read_cycle(p_cycle_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $function$
SELECT private.is_admin()
OR EXISTS (
  SELECT 1 FROM public.talent_managers tm WHERE tm.manager_profile_id = auth.uid()
)
OR EXISTS (
  SELECT 1 FROM public.assignments a
  WHERE a.cycle_id = p_cycle_id
    AND (a.assessor_id = auth.uid() OR private.manages_talent(a.talent_id))
);
$function$;

DROP POLICY IF EXISTS talents_select ON public.talents;
CREATE POLICY talents_select ON public.talents
  FOR SELECT TO authenticated
  USING (private.is_admin() OR private.manages_talent(id) OR private.is_assessor_of_talent(id));

GRANT SELECT ON public.talent_managers TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.talent_managers TO service_role;

DROP POLICY IF EXISTS talent_managers_select ON public.talent_managers;
CREATE POLICY talent_managers_select ON public.talent_managers
  FOR SELECT TO authenticated
  USING (
    private.is_admin()
    OR manager_profile_id = auth.uid()
    OR private.manages_talent(talent_id)
    OR EXISTS (SELECT 1 FROM public.talents t WHERE t.id = talent_id AND t.profile_id = auth.uid())
  );

CREATE OR REPLACE FUNCTION public.set_assignment_classification(p_assignment_id uuid, p_classification text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
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
v_is_manager := EXISTS (
  SELECT 1 FROM public.talent_managers tm
  WHERE tm.talent_id = v_assignment.talent_id AND tm.manager_profile_id = v_assignment.assessor_id
);

IF p_classification = 'self' AND NOT v_is_self THEN
RAISE EXCEPTION 'Self can only be used when the talent is the assessor.' USING ERRCODE = '22023';
END IF;
IF p_classification = 'immediate_manager' AND NOT v_is_manager THEN
RAISE EXCEPTION 'Immediate manager can only be used for one of the talent''s immediate managers.' USING ERRCODE = '22023';
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
$function$;

DROP FUNCTION IF EXISTS public.set_talent_immediate_manager(uuid, uuid);

CREATE OR REPLACE FUNCTION public.set_talent_managers(p_talent_id uuid, p_manager_ids uuid[], p_primary_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
v_talent public.talents%ROWTYPE;
v_ids uuid[];
v_previous_primary uuid;
v_removed integer;
v_added integer;
BEGIN
IF NOT private.is_admin() THEN
RAISE EXCEPTION 'You do not have permission to change this talent.' USING ERRCODE = '42501';
END IF;

SELECT * INTO v_talent FROM public.talents WHERE id = p_talent_id FOR UPDATE;
IF NOT FOUND THEN
RAISE EXCEPTION 'This talent could not be found.' USING ERRCODE = 'P0002';
END IF;

SELECT coalesce(array_agg(DISTINCT m), '{}'::uuid[]) INTO v_ids FROM unnest(coalesce(p_manager_ids, '{}'::uuid[])) AS m;

IF cardinality(v_ids) = 0 THEN
RAISE EXCEPTION 'Choose at least one immediate manager.' USING ERRCODE = '22023';
END IF;
IF p_primary_id IS NULL OR NOT (p_primary_id = ANY (v_ids)) THEN
RAISE EXCEPTION 'Choose one primary immediate manager.' USING ERRCODE = '22023';
END IF;
IF v_talent.profile_id = ANY (v_ids) THEN
RAISE EXCEPTION 'A talent cannot be their own immediate manager.' USING ERRCODE = '22023';
END IF;
IF (SELECT count(*) FROM public.profiles p WHERE p.id = ANY (v_ids)) <> cardinality(v_ids) THEN
RAISE EXCEPTION 'One of the selected people could not be found.' USING ERRCODE = 'P0002';
END IF;

SELECT tm.manager_profile_id INTO v_previous_primary
FROM public.talent_managers tm
WHERE tm.talent_id = p_talent_id AND tm.is_primary;

DELETE FROM public.talent_managers tm
WHERE tm.talent_id = p_talent_id AND NOT (tm.manager_profile_id = ANY (v_ids));
GET DIAGNOSTICS v_removed = ROW_COUNT;

INSERT INTO public.talent_managers (talent_id, manager_profile_id, is_primary)
SELECT p_talent_id, m, false FROM unnest(v_ids) AS m
ON CONFLICT (talent_id, manager_profile_id) DO NOTHING;
GET DIAGNOSTICS v_added = ROW_COUNT;

UPDATE public.talent_managers
SET is_primary = false
WHERE talent_id = p_talent_id AND is_primary AND manager_profile_id <> p_primary_id;

UPDATE public.talent_managers
SET is_primary = true
WHERE talent_id = p_talent_id AND manager_profile_id = p_primary_id AND NOT is_primary;

PERFORM private.sync_talent_managers(p_talent_id);

IF v_previous_primary IS DISTINCT FROM p_primary_id THEN
INSERT INTO public.audit_log (actor_id, action, entity, entity_id, details)
VALUES (auth.uid(), 'talent.primary_manager_changed', 'talent', p_talent_id::text,
jsonb_build_object('from_manager_id', v_previous_primary, 'to_manager_id', p_primary_id));
END IF;

RETURN jsonb_build_object('added', v_added, 'removed', v_removed, 'primary_manager_id', p_primary_id);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.set_talent_managers(uuid, uuid[], uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_talent_managers(uuid, uuid[], uuid) TO authenticated;

CREATE OR REPLACE FUNCTION private.cycle_coverage_gaps(p_cycle_id uuid)
RETURNS TABLE (gap_talent_id uuid, gap_talent_name text, gap_missing text[])
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $function$
SELECT x.talent_id, x.talent_name,
ARRAY(
SELECT m FROM unnest(ARRAY[
CASE WHEN x.managers = 0 THEN 'Immediate manager' END,
CASE WHEN x.direct_reports = 0 THEN 'Direct report' END,
CASE WHEN x.peers = 0 THEN 'Peer' END
]) AS m
WHERE m IS NOT NULL
)
FROM (
SELECT t.id AS talent_id,
p.full_name AS talent_name,
count(a.id) FILTER (WHERE a.classification = 'immediate_manager') AS managers,
count(a.id) FILTER (WHERE a.classification = 'direct_report') AS direct_reports,
count(a.id) FILTER (WHERE a.classification = 'peer') AS peers
FROM public.talents t
JOIN public.profiles p ON p.id = t.profile_id
LEFT JOIN public.assignments a ON a.talent_id = t.id AND a.cycle_id = p_cycle_id
GROUP BY t.id, p.full_name
) x
WHERE x.managers = 0 OR x.direct_reports = 0 OR x.peers = 0
ORDER BY x.talent_name;
$function$;

CREATE OR REPLACE FUNCTION public.cycle_coverage_gaps(p_cycle_id uuid)
RETURNS TABLE (gap_talent_id uuid, gap_talent_name text, gap_missing text[])
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
IF NOT (auth.role() = 'service_role' OR private.is_admin()) THEN
RAISE EXCEPTION 'You do not have permission to check this cycle.' USING ERRCODE = '42501';
END IF;
RETURN QUERY SELECT * FROM private.cycle_coverage_gaps(p_cycle_id);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.cycle_coverage_gaps(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cycle_coverage_gaps(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION private.enforce_cycle_coverage()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
v_gaps text;
BEGIN
SELECT string_agg(g.gap_talent_name || ' (missing ' || array_to_string(g.gap_missing, ', ') || ')', '; ' ORDER BY g.gap_talent_name)
INTO v_gaps
FROM private.cycle_coverage_gaps(NEW.id) g;

IF v_gaps IS NOT NULL THEN
RAISE EXCEPTION 'This cycle cannot open until every talent has an Immediate manager, a Direct report and a Peer: %', v_gaps USING ERRCODE = 'P0001';
END IF;
RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS cycles_coverage_before_open ON public.cycles;
CREATE TRIGGER cycles_coverage_before_open
  BEFORE UPDATE OF status ON public.cycles
  FOR EACH ROW
  WHEN (NEW.status = 'open' AND OLD.status IS DISTINCT FROM 'open')
  EXECUTE FUNCTION private.enforce_cycle_coverage();
