/*
# Audit trail module and user control

Plain-English summary
Adds a complete, tamper-resistant audit trail and the account controls that
administrators need to manage who can use the app.

## 1. Audit trail
- audit_log gets two new columns:
  - source: 'app' for events written by the app's own functions (the existing
    entries), 'data_change' for automatic row-change entries, 'auth' for sign-in
    and sign-out events.
  - actor_email: the email of the person who acted, copied at write time so the
    trail still reads correctly if the profile later changes.
- Automatic change tracking: inserts, updates and deletes on profiles, talents,
  talent_managers, cycles, assignments and app_settings are recorded with the
  changed fields (before and after). Secret columns (edit_token_hash,
  gmail_token_secret_id) are never copied. responses (ratings and notes) are
  deliberately not copied so anonymous feedback stays anonymous.
- Sign-ins are recorded from auth.users.last_sign_in_at. Sign-outs are recorded
  by the app through record_audit_event().
- The audit log is append-only: UPDATE and DELETE are rejected by a trigger for
  every role, including the service role.
- Indexes on created_at, action, entity and actor for the Audit trail screen.

## 2. User control
- profiles gets is_active (default true), deactivated_at and deactivated_by.
- private.is_admin() now also requires the admin account to be active.
- Deactivation, reactivation and role changes run through the manage-user edge
  function, which also blocks or unblocks sign-in in Supabase Auth.

## 3. Security
- New functions use SET search_path = '' and SECURITY DEFINER only where needed.
- record_audit_event() only accepts a short allow-list of client actions.
*/

-- 1. Audit log columns and indexes -----------------------------------------
ALTER TABLE public.audit_log
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'app',
  ADD COLUMN IF NOT EXISTS actor_email text;

DO $$ BEGIN
  ALTER TABLE public.audit_log
    ADD CONSTRAINT audit_log_source_check CHECK (source IN ('app', 'data_change', 'auth'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS audit_log_created_at_idx ON public.audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_action_idx ON public.audit_log (action);
CREATE INDEX IF NOT EXISTS audit_log_entity_idx ON public.audit_log (entity, entity_id);
CREATE INDEX IF NOT EXISTS audit_log_actor_idx ON public.audit_log (actor_id);

-- Fill actor_email for every new row (and back-fill the old ones once).
CREATE OR REPLACE FUNCTION private.audit_log_fill_actor_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.actor_email IS NULL AND NEW.actor_id IS NOT NULL THEN
    SELECT p.email INTO NEW.actor_email FROM public.profiles p WHERE p.id = NEW.actor_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS audit_log_fill_actor_email ON public.audit_log;
CREATE TRIGGER audit_log_fill_actor_email
BEFORE INSERT ON public.audit_log
FOR EACH ROW EXECUTE FUNCTION private.audit_log_fill_actor_email();

UPDATE public.audit_log a
SET actor_email = p.email
FROM public.profiles p
WHERE a.actor_id = p.id AND a.actor_email IS NULL;

-- Append-only: nobody may change or remove history.
CREATE OR REPLACE FUNCTION private.audit_log_block_changes()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'The audit log is append-only.' USING ERRCODE = 'insufficient_privilege';
END;
$$;

DROP TRIGGER IF EXISTS audit_log_append_only ON public.audit_log;
CREATE TRIGGER audit_log_append_only
BEFORE UPDATE OR DELETE ON public.audit_log
FOR EACH ROW EXECUTE FUNCTION private.audit_log_block_changes();

-- 2. Automatic row-change tracking -----------------------------------------
CREATE OR REPLACE FUNCTION private.audit_row_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  hidden text[] := ARRAY['edit_token_hash', 'gmail_token_secret_id'];
  old_row jsonb := CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) - hidden ELSE NULL END;
  new_row jsonb := CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) - hidden ELSE NULL END;
  before_values jsonb := '{}'::jsonb;
  after_values jsonb := '{}'::jsonb;
  key text;
  row_id text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    FOR key IN SELECT jsonb_object_keys(new_row) LOOP
      IF old_row -> key IS DISTINCT FROM new_row -> key THEN
        before_values := before_values || jsonb_build_object(key, old_row -> key);
        after_values := after_values || jsonb_build_object(key, new_row -> key);
      END IF;
    END LOOP;
    -- Nothing visible changed (for example only a hidden column): skip.
    IF after_values = '{}'::jsonb THEN
      RETURN NEW;
    END IF;
  ELSIF TG_OP = 'INSERT' THEN
    after_values := new_row;
  ELSE
    before_values := old_row;
  END IF;

  row_id := COALESCE(new_row ->> 'id', old_row ->> 'id', new_row ->> 'talent_id', old_row ->> 'talent_id');

  INSERT INTO public.audit_log (actor_id, action, entity, entity_id, details, source)
  VALUES (
    auth.uid(),
    TG_TABLE_NAME || '.' || lower(TG_OP),
    TG_TABLE_NAME,
    row_id,
    jsonb_build_object('before', before_values, 'after', after_values),
    'data_change'
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;

DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['profiles', 'talents', 'talent_managers', 'cycles', 'assignments', 'app_settings'] LOOP
    IF to_regclass('public.' || tbl) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS audit_row_change ON public.%I', tbl);
      EXECUTE format(
        'CREATE TRIGGER audit_row_change AFTER INSERT OR UPDATE OR DELETE ON public.%I '
        'FOR EACH ROW EXECUTE FUNCTION private.audit_row_change()',
        tbl
      );
    END IF;
  END LOOP;
END $$;

-- 3. Sign-in tracking ------------------------------------------------------
CREATE OR REPLACE FUNCTION private.audit_sign_in()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.last_sign_in_at IS DISTINCT FROM OLD.last_sign_in_at
     AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = NEW.id) THEN
    INSERT INTO public.audit_log (actor_id, action, entity, entity_id, details, source)
    VALUES (NEW.id, 'auth.sign_in', 'profiles', NEW.id::text, '{}'::jsonb, 'auth');
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never let auditing block a sign-in.
  RAISE WARNING 'audit_sign_in failed: %', SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS audit_sign_in ON auth.users;
CREATE TRIGGER audit_sign_in
AFTER UPDATE OF last_sign_in_at ON auth.users
FOR EACH ROW EXECUTE FUNCTION private.audit_sign_in();

-- Client-side events (sign-out, exporting the audit trail).
CREATE OR REPLACE FUNCTION public.record_audit_event(p_action text, p_details jsonb DEFAULT '{}'::jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in first.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_action NOT IN ('auth.sign_out', 'audit.exported') THEN
    RAISE EXCEPTION 'Unknown audit action.' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_action = 'audit.exported' AND NOT private.is_admin() THEN
    RAISE EXCEPTION 'Only administrators can export the audit trail.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  INSERT INTO public.audit_log (actor_id, action, entity, entity_id, details, source)
  VALUES (
    auth.uid(),
    p_action,
    CASE WHEN p_action = 'audit.exported' THEN 'audit_log' ELSE 'profiles' END,
    auth.uid()::text,
    COALESCE(p_details, '{}'::jsonb),
    CASE WHEN p_action LIKE 'auth.%' THEN 'auth' ELSE 'app' END
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.record_audit_event(text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_audit_event(text, jsonb) TO authenticated;

-- 4. User control ------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS deactivated_at timestamptz,
  ADD COLUMN IF NOT EXISTS deactivated_by uuid REFERENCES public.profiles(id) ON DELETE RESTRICT;

-- Only active administrators have administrator rights.
CREATE OR REPLACE FUNCTION private.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin' AND p.is_active
  );
$$;
