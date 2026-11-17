/*
# Opening a cycle warns instead of blocking; Settings is admin-only

1. Opening a cycle
- Before: a cycle could not be opened until every talent had at least one
  Immediate manager, Direct report and Peer assessor (trigger
  cycles_coverage_before_open). With no way around it, assessors never saw
  their forms.
- Now: admins can open a cycle at any time. The Cycles screen lists each
  talent's missing assessor types (public.cycle_coverage_gaps, unchanged).
- Anonymity is unchanged: reports still hide peer and direct-report scores and
  notes when fewer people than the cycle's minimum group size responded.

2. Settings (notifications and sender settings) is for administrators only
- module_level_for returns 0 for 'settings' unless the person is an active admin.
- Any settings rows already granted are removed.
*/

DROP TRIGGER IF EXISTS cycles_coverage_before_open ON public.cycles;

CREATE OR REPLACE FUNCTION public.module_level_for(p_profile_id uuid, p_module text)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p.id IS NULL OR NOT p.is_active THEN 0
    WHEN p.role = 'admin' THEN 2
    WHEN p_module = 'settings' THEN 0
    ELSE COALESCE((
      SELECT CASE m.level WHEN 'edit' THEN 2 WHEN 'view' THEN 1 ELSE 0 END
      FROM public.module_access m
      WHERE m.profile_id = p.id AND m.module = p_module
    ), 0)
  END
  FROM (SELECT 1) one
  LEFT JOIN public.profiles p ON p.id = p_profile_id;
$$;

DELETE FROM public.module_access WHERE module = 'settings';
