/*
# Account activation codes

1. Changes
- `profiles.activated_at` (timestamptz, nullable): set when a person creates their own password through the activation page. Existing accounts that have already left the forced password change are backfilled as active.
- `activation_codes` table: one-time 6-digit codes, stored as hashes only. Columns: email, code_hash, expires_at, attempts, created_at.

2. Security
- RLS enabled on `activation_codes` with no client policies, so only server functions can read or write it.
- Grants: `service_role` only, used by the request-activation-code and activate-account edge functions.

3. Notes
- Codes expire 15 minutes after issue and are cancelled after 5 wrong attempts (enforced by the functions).
- Rate limiting of 3 requests per email per hour is checked against `activation_codes.created_at`.
*/

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS activated_at timestamptz;

UPDATE profiles SET activated_at = now()
WHERE activated_at IS NULL AND must_change_password = false;

CREATE TABLE IF NOT EXISTS activation_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  code_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS activation_codes_email_created_idx ON activation_codes (email, created_at);

ALTER TABLE activation_codes ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON activation_codes TO service_role;
