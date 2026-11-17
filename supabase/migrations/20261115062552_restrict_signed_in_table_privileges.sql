/*
# Restrict signed-in access to the intended privileges

Plain-English summary
Supabase gives the signed-in role full read, write and delete access to new tables by default. Those defaults were overriding the narrow permissions set in the earlier access-rule migration, which would have exposed the assignment edit-token hash and allowed writes to read-only tables. This migration removes all default access and re-applies only the permissions the app needs. Row-level rules are unchanged.

## 1. Removed
- All table privileges previously held by the signed-in role on profiles, talents, cycles, competencies, assignments, responses, notifications and audit_log.

## 2. Re-granted (exactly what the app uses)
- profiles, talents, cycles: read, create, change, delete (row rules restrict to admins or the relevant people).
- competencies: read only.
- assignments: read all columns except the edit-token hash; create and change the listed columns; delete.
- responses: read; create and change only the rating and note columns; delete.
- notifications and audit_log: read only.

## 3. Security
- Anonymous visitors still have no access to any of these tables.

## Important notes
1. Writes to notifications and audit_log, and the edit-token hash, are reserved for trusted server code.
*/

REVOKE ALL ON public.profiles, public.talents, public.cycles, public.competencies,
  public.assignments, public.responses, public.notifications, public.audit_log
  FROM authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.talents TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cycles TO authenticated;
GRANT SELECT ON public.competencies TO authenticated;

GRANT SELECT (id, cycle_id, talent_id, assessor_id, classification, status, submitted_at, last_reminded_at, copy_requested)
  ON public.assignments TO authenticated;
GRANT INSERT (cycle_id, talent_id, assessor_id, classification) ON public.assignments TO authenticated;
GRANT UPDATE (cycle_id, talent_id, assessor_id, classification, status, submitted_at, last_reminded_at, copy_requested)
  ON public.assignments TO authenticated;
GRANT DELETE ON public.assignments TO authenticated;

GRANT SELECT ON public.responses TO authenticated;
GRANT INSERT (assignment_id, competency_id, rating, behaviour_note) ON public.responses TO authenticated;
GRANT UPDATE (rating, behaviour_note) ON public.responses TO authenticated;
GRANT DELETE ON public.responses TO authenticated;

GRANT SELECT ON public.notifications TO authenticated;
GRANT SELECT ON public.audit_log TO authenticated;
