/*
# Route assignment writes through audited paths only

Plain-English summary
Admins could previously change or delete an assessment directly through the data interface, which skipped the audit trail. Adding, removing and changing the type of an assessment now happen only through the server functions and the admin-only actions, which record every change.

## 1. Modified access (public.assignments)
- Signed-in users can no longer insert or delete assessments directly.
- Signed-in users can no longer change who the assessor is, the talent, the cycle, or the assessor type directly.
- Signed-in users can still update the progress fields (status, submitted date, last reminder date, copy requested), as before.

## 2. Security
- No row access rules change. Admins keep their existing read access.
- Changes are routed through invite-assessor (add), remove_assignment (remove) and set_assignment_classification (type change), each of which writes to the audit log.

## Important notes
1. Permissions are removed for the signed-in role only. The server functions run with their own rights and are unaffected.
2. This is idempotent and safe to re-run.
*/

REVOKE INSERT, DELETE ON public.assignments FROM authenticated;
REVOKE UPDATE ON public.assignments FROM authenticated;
GRANT UPDATE (status, submitted_at, last_reminded_at, copy_requested) ON public.assignments TO authenticated;
