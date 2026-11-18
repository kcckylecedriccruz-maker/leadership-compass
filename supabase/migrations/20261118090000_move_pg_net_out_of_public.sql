/*
# Security advisor: move pg_net out of the public schema

The Supabase security advisor flags extensions installed in `public`, because
everything in `public` is visible through the Data API. pg_net cannot be moved
with ALTER EXTENSION ... SET SCHEMA, so it is recreated in the `extensions`
schema. Its functions always live in the `net` schema, so the daily-scheduler
cron job (which calls net.http_post) keeps working unchanged. Pending HTTP
requests in pg_net's own queue are dropped; the scheduler only fires once a day.
*/

CREATE SCHEMA IF NOT EXISTS extensions;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
    WHERE e.extname = 'pg_net' AND n.nspname = 'public'
  ) THEN
    DROP EXTENSION pg_net;
    CREATE EXTENSION pg_net WITH SCHEMA extensions;
  END IF;
END $$;
