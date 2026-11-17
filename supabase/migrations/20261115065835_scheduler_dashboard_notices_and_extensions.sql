/*
# Scheduler support: once-only dashboard alerts and scheduling extensions

Plain-English summary
The daily scheduler and the submit function both announce when every assessor for a talent has finished. This migration adds a record of each announcement so it is sent only once, and enables the two database extensions the daily schedule uses. Talents that were already complete before this change are marked as announced, so they are not emailed again.

## 1. New table
- dashboard_ready_notices: one row per cycle and talent whose dashboard-ready email has been sent. It has the cycle, the talent and the time it was sent. The pair of cycle and talent is unique.

## 2. Extensions
- pg_net: lets the database make web requests, used by the daily schedule.
- pg_cron: runs the daily schedule.

## 3. Security
- Row level security is enabled on dashboard_ready_notices with no policies, so signed-in and anonymous users cannot read or change it.
- Only the server-side service role can read and insert rows. Public and signed-in access is revoked.

## Important notes
1. The daily schedule itself is created separately, because it contains the project's function address and a secret that must not be stored in this file.
2. Backfill: every cycle and talent where all assessments were already submitted is recorded here, so the new scheduler does not resend those announcements.
*/

CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS pg_cron;

CREATE TABLE IF NOT EXISTS public.dashboard_ready_notices (
  cycle_id uuid NOT NULL REFERENCES public.cycles(id) ON DELETE RESTRICT,
  talent_id uuid NOT NULL REFERENCES public.talents(id) ON DELETE RESTRICT,
  sent_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (cycle_id, talent_id)
);

ALTER TABLE public.dashboard_ready_notices ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.dashboard_ready_notices FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.dashboard_ready_notices TO service_role;

INSERT INTO public.dashboard_ready_notices (cycle_id, talent_id)
SELECT a.cycle_id, a.talent_id
FROM public.assignments a
GROUP BY a.cycle_id, a.talent_id
HAVING bool_and(a.status = 'submitted')
ON CONFLICT (cycle_id, talent_id) DO NOTHING;
