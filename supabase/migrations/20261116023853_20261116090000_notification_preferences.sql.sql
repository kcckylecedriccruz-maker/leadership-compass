/*
# Notification preferences (NS1-NS8)

1. New Table
- `notification_preferences`: per-user email settings.
  - `id` (uuid, primary key, default gen_random_uuid())
  - `profile_id` (uuid, references profiles(id) on delete cascade, NOT NULL)
  - `email_type` (text, NOT NULL; one of the app's email kinds)
  - `enabled` (boolean, NOT NULL, default true)
  - `delivery` (text, NOT NULL, default 'instant', CHECK in ('instant', 'daily_digest'))
  - `updated_at` (timestamptz, NOT NULL, default now())
  - UNIQUE (profile_id, email_type)

2. Modified Tables
- `notifications`: the `status` CHECK now also allows 'skipped_by_preference', so skipped sends can be logged.

3. Security
- RLS enabled on `notification_preferences`.
- Policies, scoped to `authenticated`:
  - SELECT: a user reads their own rows; admins read all rows.
  - INSERT: a user inserts only their own rows.
  - UPDATE: a user updates only their own rows.
  - DELETE: a user deletes their own rows; admins can delete any row (used by "Reset to defaults").
- Grants: SELECT, INSERT, UPDATE, DELETE to `authenticated`; SELECT plus DELETE (reset) handled by policies; service_role gets all verbs for edge functions.
- New SELECT-only grant on `notifications` is already in place from an earlier migration; no new grants needed there.

4. Notes
- No transaction control statements; idempotent via IF NOT EXISTS / DROP POLICY IF EXISTS.
- The status CHECK is replaced with a new one that keeps the existing allowed values and adds the new one; existing rows satisfy it.
*/

CREATE TABLE IF NOT EXISTS public.notification_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  email_type text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  delivery text NOT NULL DEFAULT 'instant' CHECK (delivery IN ('instant', 'daily_digest')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (profile_id, email_type)
);

CREATE INDEX IF NOT EXISTS notification_preferences_profile_id_idx
  ON public.notification_preferences (profile_id);

ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "notification_prefs_select_own_or_admin" ON public.notification_preferences;
CREATE POLICY "notification_prefs_select_own_or_admin" ON public.notification_preferences
  FOR SELECT TO authenticated
  USING (
    auth.uid() = profile_id
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'admin'
    )
  );

DROP POLICY IF EXISTS "notification_prefs_insert_own" ON public.notification_preferences;
CREATE POLICY "notification_prefs_insert_own" ON public.notification_preferences
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = profile_id);

DROP POLICY IF EXISTS "notification_prefs_update_own" ON public.notification_preferences;
CREATE POLICY "notification_prefs_update_own" ON public.notification_preferences
  FOR UPDATE TO authenticated
  USING (auth.uid() = profile_id)
  WITH CHECK (auth.uid() = profile_id);

DROP POLICY IF EXISTS "notification_prefs_delete_own_or_admin" ON public.notification_preferences;
CREATE POLICY "notification_prefs_delete_own_or_admin" ON public.notification_preferences
  FOR DELETE TO authenticated
  USING (
    auth.uid() = profile_id
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'admin'
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.notification_preferences TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notification_preferences TO service_role;

-- Widen the notifications.status CHECK to allow 'skipped_by_preference'.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.notifications'::regclass
      AND conname = 'notifications_status_check_v2'
  ) THEN
    ALTER TABLE public.notifications
      DROP CONSTRAINT IF EXISTS notifications_status_check;
    ALTER TABLE public.notifications
      ADD CONSTRAINT notifications_status_check_v2
      CHECK (status IN ('pending', 'sent', 'failed', 'skipped_by_preference'));
  END IF;
END
$$;
