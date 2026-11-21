/*
  # Early reports are for administrators only

  Replaces the per-cycle employee switch from 20261121100000:
  - Employees (including managers) see their own report only after the cycle closes; managers see only reports an
    administrator shared with them. The early_report column is removed.
  - Administrators can open any report while the cycle is open, before everyone has responded (including their own
    report from My report). In that early view every submitted group is shown, including groups below the minimum
    group size, and written notes appear as they arrive. Closed cycles keep the usual minimum-group-size rule.
*/

-- The helper keeps its name (competency_scores and behaviour_notes call it) but now means "an administrator viewing an
-- open cycle".
CREATE OR REPLACE FUNCTION private.is_early_self_view(p_cycle_id uuid, p_talent_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT private.is_admin() AND EXISTS (SELECT 1 FROM public.cycles c WHERE c.id = p_cycle_id AND c.status = 'open');
$$;

CREATE OR REPLACE FUNCTION private.can_view_cycle_report(p_cycle_id uuid, p_talent_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT private.is_admin()
    OR private.can_view('dashboard')
    OR EXISTS (
      SELECT 1 FROM public.talents t JOIN public.cycles c ON c.id = p_cycle_id
      WHERE t.id = p_talent_id AND t.profile_id = auth.uid() AND c.status = 'closed'
    )
    OR EXISTS (
      SELECT 1 FROM public.report_shares s
      WHERE s.cycle_id = p_cycle_id AND s.talent_id = p_talent_id AND s.shared_with = auth.uid()
    );
$$;

ALTER TABLE public.cycles DROP COLUMN IF EXISTS early_report;
