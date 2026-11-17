/*
# Gmail refresh token: Vault access functions

1. Background
- Edge functions stored the Gmail refresh token with `rpc("create_secret")`
  and read it from `vault.decrypted_secrets` through the Data API. Neither
  works: `create_secret` lives in the `vault` schema (not exposed to the Data
  API) and `vault` is not an exposed schema. Connecting Gmail therefore failed
  with "The Gmail approval could not be stored" and sends found no token.

2. New Functions (schema public, callable by service_role only)
- `gmail_token_store(p_token text) returns uuid`: creates or updates the Vault
  secret named `gmail_refresh_token` and returns its id.
- `gmail_token_read(p_secret_id uuid) returns text`: returns the decrypted
  token for that id (null if missing).
- `gmail_token_delete(p_secret_id uuid) returns void`: deletes the secret.

3. Security
- SECURITY DEFINER with an empty search_path; every object is schema-qualified.
- EXECUTE revoked from PUBLIC, anon and authenticated; granted to service_role
  only, so browsers can never read or change the token.
*/

CREATE EXTENSION IF NOT EXISTS supabase_vault;

CREATE OR REPLACE FUNCTION public.gmail_token_store(p_token text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_token IS NULL OR length(p_token) = 0 THEN
    RAISE EXCEPTION 'token is required';
  END IF;

  SELECT s.id INTO v_id FROM vault.secrets s WHERE s.name = 'gmail_refresh_token' LIMIT 1;

  IF v_id IS NULL THEN
    v_id := vault.create_secret(p_token, 'gmail_refresh_token', 'Leadership Compass Gmail send-only refresh token');
  ELSE
    PERFORM vault.update_secret(v_id, p_token);
  END IF;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.gmail_token_read(p_secret_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT ds.decrypted_secret FROM vault.decrypted_secrets ds WHERE ds.id = p_secret_id LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.gmail_token_delete(p_secret_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  DELETE FROM vault.secrets WHERE id = p_secret_id;
$$;

REVOKE ALL ON FUNCTION public.gmail_token_store(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.gmail_token_read(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.gmail_token_delete(uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.gmail_token_store(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.gmail_token_read(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.gmail_token_delete(uuid) TO service_role;
