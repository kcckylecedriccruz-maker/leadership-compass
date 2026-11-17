/*
# NS9-NS17: test-email flag, sender settings, template overrides

1. Background
- Reminder history (NS9) needs a flag distinguishing real reminder sends from
  admin test sends, so tests never show up in reminder history or alerts.
- Sender identity settings (NS11-NS14) need a place to store the sender name,
  sender email, reply-to address, and Resend domain status.
- Template editing (NS16) needs a place to store per-email-type subject and
  body overrides made by admins.

2. Modified Tables
- `notifications`
  - ADD COLUMN `is_test` boolean NOT NULL DEFAULT false.
    Existing rows keep the default false (they are all real sends).
  - The status CHECK constraint is replaced: the 'pending' status value is no
    longer used (all existing rows are 'sent', 'failed', or
    'skipped_by_preference'; verified before migrating). The new constraint
    allows only 'sent', 'skipped_by_preference', 'failed'.
  - The column DEFAULT 'pending' is changed to NULL so no future row starts
    life with a status outside the new list.

3. New Tables
- `app_settings` (single row of application-wide settings)
  - `id` smallint PRIMARY KEY with CHECK (id = 1): guarantees one row only.
  - `sender_name` text: display name emails are sent from.
  - `sender_email` text: sending address emails are sent from.
  - `reply_to_email` text: reply-to address for outgoing emails.
  - `sender_domain_status` text NOT NULL DEFAULT 'not_set_up'
    CHECK IN ('verified', 'pending', 'not_set_up'): Resend domain state.
  - `sender_verified_at` timestamptz: when the domain was last seen verified.
  - `updated_by` uuid: admin who last changed settings.
  - `updated_at` timestamptz NOT NULL DEFAULT now().

- `email_templates` (one row per email type with an admin-customized copy)
  - `email_type` text PRIMARY KEY: the email kind this row customizes.
  - `subject` text NOT NULL: customized subject line.
  - `message` text NOT NULL: customized body text.
  - `updated_by` uuid: admin who last saved the override.
  - `updated_at` timestamptz NOT NULL DEFAULT now().

4. Security
- `app_settings`: RLS enabled. Admins can SELECT (read-only via the Data API);
  writes happen only through edge functions using the service role, so there
  are no INSERT/UPDATE/DELETE policies and no write grants to authenticated.
- `email_templates`: RLS enabled. Admins can SELECT; writes only via edge
  functions with service role.
- `notifications.is_test` is not client-writable beyond existing grants
  (authenticated has no INSERT/UPDATE grants on notifications at all).
- GRANT SELECT on app_settings and email_templates to authenticated + service_role
  (RLS restricts rows to admins; service_role bypasses RLS but still needs the grant).
- Existing GRANTs on notifications are unchanged.

5. Important Notes
- Additive only: no columns or tables are dropped, no data is deleted.
- The old CHECK constraint is dropped and recreated only because the exact
  same list change cannot be done with ADD CONSTRAINT; the data itself is
  untouched (all 44 existing rows are 'failed' and remain valid).
*/

ALTER TABLE notifications ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;

-- Reconcile the status list: drop the 'pending' value, keep existing rows intact
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_status_check_v2;
ALTER TABLE notifications ADD CONSTRAINT notifications_status_check_v2
  CHECK (status IN ('sent', 'skipped_by_preference', 'failed'));

DO $$ BEGIN
  ALTER TABLE notifications ALTER COLUMN status DROP DEFAULT;
EXCEPTION WHEN undefined_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS app_settings (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  sender_name text,
  sender_email text,
  reply_to_email text,
  sender_domain_status text NOT NULL DEFAULT 'not_set_up'
    CHECK (sender_domain_status IN ('verified', 'pending', 'not_set_up')),
  sender_verified_at timestamptz,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "app_settings_select_admin" ON app_settings;
CREATE POLICY "app_settings_select_admin" ON app_settings
  FOR SELECT TO authenticated
  USING (private.is_admin());

GRANT SELECT ON app_settings TO authenticated, service_role;

CREATE TABLE IF NOT EXISTS email_templates (
  email_type text PRIMARY KEY,
  subject text NOT NULL,
  message text NOT NULL,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE email_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "email_templates_select_admin" ON email_templates;
CREATE POLICY "email_templates_select_admin" ON email_templates
  FOR SELECT TO authenticated
  USING (private.is_admin());

GRANT SELECT ON email_templates TO authenticated, service_role;