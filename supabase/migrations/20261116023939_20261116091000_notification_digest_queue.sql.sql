/*
# Digest queue for submitted alerts

1. New Table
- `notification_digest_queue`: holds one row per queued submitted_alert, drained once a day by daily-scheduler.
  - `id` (uuid, primary key)
  - `profile_id` (uuid, references profiles(id) on delete cascade, NOT NULL)
  - `email_type` (text, NOT NULL)
  - `cycle_id` (uuid, references cycles(id) on delete cascade, NOT NULL)
  - `assignment_id` (uuid, references assignments(id) on delete cascade)
  - `created_at` (timestamptz, default now())

2. Security
- RLS enabled; no policies: only service_role (edge functions) reads and writes this table.
- Grants: all verbs to service_role only.

3. Notes
- Additive change only; no existing table or column is modified.
*/

CREATE TABLE IF NOT EXISTS public.notification_digest_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  email_type text NOT NULL,
  cycle_id uuid NOT NULL REFERENCES public.cycles(id) ON DELETE CASCADE,
  assignment_id uuid REFERENCES public.assignments(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.notification_digest_queue ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, DELETE ON public.notification_digest_queue TO service_role;
