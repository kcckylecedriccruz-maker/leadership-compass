/*
  # Employees change their own email with a 6-digit code

  - email_change_codes: one-time codes sent to the NEW address, stored as hashes only, valid 15 minutes,
    at most 5 attempts. RLS on with no client policies: only the edit-profile function reads or writes it.
*/
CREATE TABLE IF NOT EXISTS public.email_change_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  new_email text NOT NULL,
  code_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS email_change_codes_profile_created_idx ON public.email_change_codes (profile_id, created_at);

ALTER TABLE public.email_change_codes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.email_change_codes FROM anon, authenticated;
