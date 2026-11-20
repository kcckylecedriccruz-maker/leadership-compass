/*
  # Allow a minimum group size of 0

  0 means "no minimum": anonymous groups (peers, direct reports, external raters) are shown in reports as soon as
  anyone in them has answered. In practice this behaves the same as 1.
*/
ALTER TABLE public.cycles DROP CONSTRAINT IF EXISTS cycles_min_group_size_check;
ALTER TABLE public.cycles ADD CONSTRAINT cycles_min_group_size_check CHECK (min_group_size >= 0);
