/*
# Department and position on every person

Department and position used to exist only on talents. HR uploads carry them
for everyone (assessors and managers too), so they now live on profiles as
well. When a person is a talent, the talent's own department and position are
kept in step on upload.

- profiles.department text (up to 100 characters), nullable
- profiles.position text (up to 100 characters), nullable
- Existing talents' values are copied onto their profiles once.
- Both columns are covered by the existing audit trigger on profiles.
*/

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS department text CHECK (department IS NULL OR length(department) <= 100),
  ADD COLUMN IF NOT EXISTS position text CHECK (position IS NULL OR length(position) <= 100);

UPDATE public.profiles p
SET department = COALESCE(p.department, t.department),
    position = COALESCE(p.position, t.position)
FROM public.talents t
WHERE t.profile_id = p.id AND (t.department IS NOT NULL OR t.position IS NOT NULL);
