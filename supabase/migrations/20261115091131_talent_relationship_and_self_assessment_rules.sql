/*
# Talent relationship and Self assessment rules

Plain-English summary
- A person can be an assessor, a talent and a manager at the same time. Being a talent is a relationship (one talents row per person), not a role, so this migration does not change anyone's role.
- A talent cannot be their own immediate manager.
- On a talent's own assessment, the only allowed assessor type is Self, and the only assessor allowed on a Self assessment is the talent.

1. Changed behaviour
- talents: a new trigger rejects an immediate manager that is the same person as the talent.
- assignments: a new trigger rejects any assessor type other than Self when the assessor is the talent, and rejects Self when the assessor is someone other than the talent.

2. Data
- No rows are changed, deleted or re-created. Existing rows were checked and already satisfy both rules.

3. Security
- The trigger functions run as the caller with an empty search_path and are not exposed as API functions.
*/

CREATE OR REPLACE FUNCTION private.enforce_talent_manager_not_self()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.immediate_manager_id IS NOT NULL AND NEW.immediate_manager_id = NEW.profile_id THEN
    RAISE EXCEPTION 'A talent cannot be their own immediate manager.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS talents_manager_not_self ON public.talents;
CREATE TRIGGER talents_manager_not_self
BEFORE INSERT OR UPDATE OF immediate_manager_id, profile_id ON public.talents
FOR EACH ROW EXECUTE FUNCTION private.enforce_talent_manager_not_self();

CREATE OR REPLACE FUNCTION private.enforce_self_assessment_rules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  talent_profile_id uuid;
BEGIN
  SELECT t.profile_id INTO talent_profile_id FROM public.talents t WHERE t.id = NEW.talent_id;
  IF NEW.assessor_id = talent_profile_id AND NEW.classification <> 'self' THEN
    RAISE EXCEPTION 'A talent can only be assessed as Self on their own assessment.';
  END IF;
  IF NEW.classification = 'self' AND NEW.assessor_id IS DISTINCT FROM talent_profile_id THEN
    RAISE EXCEPTION 'A Self assessment must be completed by the talent it is about.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS assignments_self_rules ON public.assignments;
CREATE TRIGGER assignments_self_rules
BEFORE INSERT OR UPDATE OF talent_id, assessor_id, classification ON public.assignments
FOR EACH ROW EXECUTE FUNCTION private.enforce_self_assessment_rules();
