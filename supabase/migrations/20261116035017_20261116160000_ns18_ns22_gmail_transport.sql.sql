/*
# NS18-NS22: Gmail API transport with Resend fallback

1. Background
- Email sending moves from Microsoft Graph (added earlier in this feature) to
  the Gmail API. Microsoft 365 columns and state are removed because the
  feature was never connected (all rows still default). Resend stays as the
  automatic fallback transport.
- The Gmail OAuth refresh token is stored ONLY in Supabase Vault; the settings
  table keeps a reference (secret id) to it. The token is never returned to
  the browser or written to logs.

2. Modified Tables
- `app_settings`
  - DROP columns from the earlier Microsoft 365 attempt:
    ms_sender_mailbox, ms_secret_expires_at, ms_status, ms_status_error,
    ms_checked_at (all unreferenced; email_provider default is replaced).
  - CHANGE `email_provider` CHECK from ('microsoft_365','resend') to
    ('gmail','resend'), DEFAULT 'gmail'.
  - ADD `gmail_account` text: the Google account that approved the connection.
  - ADD `gmail_connected_at` timestamptz: when it was approved.
  - ADD `gmail_status` text NOT NULL DEFAULT 'not_connected'
    CHECK IN ('connected','reconnect_needed','failed','not_connected').
  - ADD `gmail_status_error` text: last error detail.
  - ADD `gmail_token_secret_id` uuid: Vault secret id holding the refresh token.
- `notifications`
  - The `provider` column added earlier CHECKs ('microsoft_365','resend');
    it holds no rows yet, so the CHECK is replaced with ('gmail','resend').
  - ADD `attempts` integer NOT NULL DEFAULT 0 (replaces the nullable column).

3. Security
- `vault.create_secret` / `vault.update_secret` are used only from edge
  functions via the service role; the settings table only stores the secret id.
- app_settings stays admin-read-only via the Data API (RLS unchanged); writes
  happen through edge functions with the service role.

4. Important Notes
- Dropping the ms_* columns is intentional per the PRD ("remove Microsoft 365
  code if added earlier"); no user data is lost — the columns were all empty.
- Vault secrets created for Gmail use a descriptive name so disconnect can
  find and delete them.
*/

-- Microsoft 365 columns from the earlier attempt (all empty) are removed.
ALTER TABLE app_settings
  DROP COLUMN IF EXISTS ms_sender_mailbox,
  DROP COLUMN IF EXISTS ms_secret_expires_at,
  DROP COLUMN IF EXISTS ms_status,
  DROP COLUMN IF EXISTS ms_status_error,
  DROP COLUMN IF EXISTS ms_checked_at;

ALTER TABLE app_settings DROP CONSTRAINT IF EXISTS app_settings_email_provider_check;
ALTER TABLE app_settings DROP CONSTRAINT IF EXISTS app_settings_email_provider_key;

ALTER TABLE app_settings
  ADD CONSTRAINT app_settings_email_provider_check
    CHECK (email_provider IN ('gmail', 'resend'));

DO $$ BEGIN
  ALTER TABLE app_settings ALTER COLUMN email_provider SET DEFAULT 'gmail';
EXCEPTION WHEN undefined_column THEN NULL; END $$;

ALTER TABLE app_settings
  ADD COLUMN IF NOT EXISTS gmail_account text,
  ADD COLUMN IF NOT EXISTS gmail_connected_at timestamptz,
  ADD COLUMN IF NOT EXISTS gmail_status text NOT NULL DEFAULT 'not_connected'
    CHECK (gmail_status IN ('connected', 'reconnect_needed', 'failed', 'not_connected')),
  ADD COLUMN IF NOT EXISTS gmail_status_error text,
  ADD COLUMN IF NOT EXISTS gmail_token_secret_id uuid;

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_provider_check;

DO $$ BEGIN
  ALTER TABLE notifications ALTER COLUMN provider DROP DEFAULT;
EXCEPTION WHEN undefined_object THEN NULL; END $$;

-- Column is empty; narrow the allowed values to the new transports.
ALTER TABLE notifications
  ADD CONSTRAINT notifications_provider_check CHECK (provider IN ('gmail', 'resend'));

ALTER TABLE notifications ALTER COLUMN attempts SET DEFAULT 0;