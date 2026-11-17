/*
# Create leadership assessment core schema

Plain-English summary
This migration creates the tables that hold people, talents (the leaders being assessed), review cycles, the competency framework, assessment assignments, the ratings and notes given by assessors, email notification records and an audit trail. Access rules are added in a separate migration.

## 1. New tables
- profiles: one row per login account. id is the auth user id. Holds name, email, role (admin, manager, assessor, talent) and whether the person must change their password at next sign-in.
- talents: the people being assessed. Links to a profile, to their immediate manager profile, and records department and position.
- cycles: review rounds with name, open and close dates, status (draft, open, closed), reminder frequency, submit-alert switch and minimum group size for anonymous reporting.
- competencies: the 19 leadership competencies grouped into five categories, ordered by sort_order.
- assignments: one row per assessor per talent per cycle, with classification (immediate_manager, direct_report, peer, self), status (not_started, draft, submitted), submission and reminder timestamps, copy request flag and a hash of the edit link token.
- responses: one row per assignment per competency, holding a 1-5 rating and a required behaviour note.
- notifications: log of emails to send or sent, with recipient, status and error text.
- audit_log: record of important actions, with actor, action, entity and time.

## 2. Integrity rules
- Every table has a primary key. Foreign keys use RESTRICT so that deleting a parent record can never silently remove assessment data.
- Rating must be between 1 and 5. Behaviour note must not be blank.
- An assignment is unique per cycle, talent and assessor.
- A submitted assignment must have a submission time, and only submitted assignments may have one.
- Last-updated time on responses is maintained automatically.

## 3. Security
- Row level security is switched on for every table in this migration. Policies are added in the next migration; until then no non-admin access is possible.
- No access is granted to the anonymous role.

## Important notes
1. Competency seed data is added in a separate migration.
2. Dropping or renaming any column later would lose data and must be avoided.
*/

CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE RESTRICT,
  full_name text NOT NULL CHECK (length(btrim(full_name)) > 0),
  email text NOT NULL UNIQUE,
  role text NOT NULL CHECK (role IN ('admin', 'manager', 'assessor', 'talent')),
  must_change_password boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS public.talents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE RESTRICT,
  immediate_manager_id uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
  department text,
  position text
);

CREATE INDEX IF NOT EXISTS talents_immediate_manager_id_idx ON public.talents (immediate_manager_id);

CREATE TABLE IF NOT EXISTS public.cycles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  opens_at timestamptz NOT NULL,
  closes_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'open', 'closed')),
  reminder_every_days integer NOT NULL DEFAULT 7 CHECK (reminder_every_days > 0),
  alert_on_submit boolean NOT NULL DEFAULT true,
  min_group_size integer NOT NULL DEFAULT 3 CHECK (min_group_size >= 1),
  CHECK (closes_at > opens_at)
);

CREATE TABLE IF NOT EXISTS public.competencies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category text NOT NULL,
  name text NOT NULL UNIQUE,
  definition text NOT NULL,
  sort_order integer NOT NULL UNIQUE CHECK (sort_order BETWEEN 1 AND 19)
);

CREATE TABLE IF NOT EXISTS public.assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id uuid NOT NULL REFERENCES public.cycles(id) ON DELETE RESTRICT,
  talent_id uuid NOT NULL REFERENCES public.talents(id) ON DELETE RESTRICT,
  assessor_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  classification text NOT NULL CHECK (classification IN ('immediate_manager', 'direct_report', 'peer', 'self')),
  status text NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started', 'draft', 'submitted')),
  submitted_at timestamptz,
  last_reminded_at timestamptz,
  copy_requested boolean NOT NULL DEFAULT false,
  edit_token_hash text,
  UNIQUE (cycle_id, talent_id, assessor_id),
  CHECK ((status = 'submitted') = (submitted_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS assignments_talent_id_idx ON public.assignments (talent_id);
CREATE INDEX IF NOT EXISTS assignments_assessor_id_idx ON public.assignments (assessor_id);

CREATE TABLE IF NOT EXISTS public.responses (
  assignment_id uuid NOT NULL REFERENCES public.assignments(id) ON DELETE RESTRICT,
  competency_id uuid NOT NULL REFERENCES public.competencies(id) ON DELETE RESTRICT,
  rating smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  behaviour_note text NOT NULL CHECK (length(btrim(behaviour_note)) > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (assignment_id, competency_id)
);

CREATE INDEX IF NOT EXISTS responses_competency_id_idx ON public.responses (competency_id);

CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL,
  recipient_email text NOT NULL,
  assignment_id uuid REFERENCES public.assignments(id) ON DELETE RESTRICT,
  cycle_id uuid REFERENCES public.cycles(id) ON DELETE RESTRICT,
  sent_at timestamptz,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  error text
);

CREATE TABLE IF NOT EXISTS public.audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
  action text NOT NULL,
  entity text NOT NULL,
  entity_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS responses_set_updated_at ON public.responses;
CREATE TRIGGER responses_set_updated_at
BEFORE UPDATE ON public.responses
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.talents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cycles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.competencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.profiles, public.talents, public.cycles, public.competencies,
  public.assignments, public.responses, public.notifications, public.audit_log
  FROM anon;
