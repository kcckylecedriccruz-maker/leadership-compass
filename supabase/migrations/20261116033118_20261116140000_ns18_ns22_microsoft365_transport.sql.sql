/*
# NS18-NS22: Microsoft 365 email transport with Resend fallback

1. Background
- Email delivery moves to Microsoft Graph (Microsoft 365) as the primary
  transport, with Resend kept as an automatic fallback. The active provider
  and the health of the Microsoft 365 connection are stored so admins can see
  and control them.

2. Modified Tables
- `app_settings`
  - ADD COLUMN `email_provider` text NOT NULL DEFAULT 'microsoft_365'
    CHECK IN ('microsoft_365', 'resend'): which transport sends email.
  - ADD COLUMN `ms_sender_mailbox` text: the Microsoft 365 mailbox emails
    are sent from (can differ from the generic sender email).
  - ADD COLUMN `ms_secret_expires_at` date: when the Microsoft client secret
    expires, entered by the admin (used for 30/7-day expiry alerts).
  - ADD COLUMN `ms_status` text NOT NULL DEFAULT 'unknown'
    CHECK IN ('connected', 'permission_missing', 'failed', 'unknown'):
    last connection-check result.
  - ADD COLUMN `ms_status_error` text: error detail from the last check.
  - ADD COLUMN `ms_checked_at` timestamptz: when the last check ran.
- `notifications`
  - ADD COLUMN `provider` text CHECK IN ('microsoft_365', 'resend'):
    which transport actually handled the send.
  - ADD COLUMN `attempts` integer: how many send attempts were made.

3. Security
- No policy changes: app_settings remains admin-read-only through the Data
  API, writes stay with edge functions via the service role. notifications
  grants are unchanged.
- Existing rows: app_settings defaults apply (provider microsoft_365,
  status unknown); notifications.provider/attempts stay NULL for old rows.

4. Important Notes
- Additive only; no data is dropped or rewritten.
*/

ALTER TABLE app_settings
  ADD COLUMN IF NOT EXISTS email_provider text NOT NULL DEFAULT 'microsoft_365'
    CHECK (email_provider IN ('microsoft_365', 'resend')),
  ADD COLUMN IF NOT EXISTS ms_sender_mailbox text,
  ADD COLUMN IF NOT EXISTS ms_secret_expires_at date,
  ADD COLUMN IF NOT EXISTS ms_status text NOT NULL DEFAULT 'unknown'
    CHECK (ms_status IN ('connected', 'permission_missing', 'failed', 'unknown')),
  ADD COLUMN IF NOT EXISTS ms_status_error text,
  ADD COLUMN IF NOT EXISTS ms_checked_at timestamptz;

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS provider text CHECK (provider IN ('microsoft_365', 'resend')),
  ADD COLUMN IF NOT EXISTS attempts integer;