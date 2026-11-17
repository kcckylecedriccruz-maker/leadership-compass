/*
# Add created_at to notifications

1. Modified Tables
- `notifications`: new column `created_at` (timestamptz, NOT NULL, default now()) so skipped
  sends (which have no sent_at timestamp) can still be listed by time in the reminder history.

2. Security
- No policy changes; notifications remain admin-read-only.
- service_role already has insert privileges needed to populate the column.

3. Notes
- Additive change only; existing rows keep all their data and receive now() as created_at.
*/

ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
