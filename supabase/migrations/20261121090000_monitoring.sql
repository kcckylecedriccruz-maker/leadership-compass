/*
  # Basic monitoring and analytics (first-party, privacy-friendly)

  - app_events: anonymous page views and browser errors. No user id, no IP, no names; paths are sanitised in the
    browser (secure-link tokens are replaced). Kept 90 days.
  - log_app_event(kind, path, detail): the only way to write; open to signed-in users and to the secure-link page.
  - app_monitoring(days): administrators only. Daily page views and errors, recent errors, top pages, AI feature use
    and sign-ins (from the audit trail).
*/
CREATE TABLE IF NOT EXISTS public.app_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('page_view', 'client_error')),
  path text NOT NULL CHECK (char_length(path) <= 200),
  detail text CHECK (detail IS NULL OR char_length(detail) <= 500),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS app_events_created_idx ON public.app_events (created_at);

ALTER TABLE public.app_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.app_events FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.log_app_event(p_kind text, p_path text, p_detail text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_kind NOT IN ('page_view', 'client_error') THEN
    RETURN;
  END IF;
  INSERT INTO public.app_events (kind, path, detail)
  VALUES (p_kind, left(coalesce(p_path, '/'), 200), left(p_detail, 500));
  -- Housekeeping: now and then, drop events older than 90 days.
  IF random() < 0.01 THEN
    DELETE FROM public.app_events WHERE created_at < now() - interval '90 days';
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.log_app_event(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_app_event(text, text, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.app_monitoring(p_days integer DEFAULT 14)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_since timestamptz := now() - make_interval(days => greatest(1, least(coalesce(p_days, 14), 90)));
BEGIN
  IF NOT private.is_admin() THEN
    RAISE EXCEPTION 'Only administrators can see monitoring.' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'daily', coalesce((
      SELECT jsonb_agg(d ORDER BY d.day)
      FROM (
        SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day,
          count(*) FILTER (WHERE kind = 'page_view') AS page_views,
          count(*) FILTER (WHERE kind = 'client_error') AS errors
        FROM public.app_events WHERE created_at >= v_since
        GROUP BY 1
      ) d), '[]'::jsonb),
    'top_pages', coalesce((
      SELECT jsonb_agg(t)
      FROM (
        SELECT path, count(*) AS views FROM public.app_events
        WHERE kind = 'page_view' AND created_at >= v_since
        GROUP BY path ORDER BY count(*) DESC LIMIT 8
      ) t), '[]'::jsonb),
    'recent_errors', coalesce((
      SELECT jsonb_agg(e)
      FROM (
        SELECT created_at, path, detail FROM public.app_events
        WHERE kind = 'client_error' AND created_at >= v_since
        ORDER BY created_at DESC LIMIT 15
      ) e), '[]'::jsonb),
    'ai_use', coalesce((
      SELECT jsonb_agg(a)
      FROM (
        SELECT action, count(*) AS uses FROM public.audit_log
        WHERE action LIKE 'ai.%' AND created_at >= v_since
        GROUP BY action ORDER BY count(*) DESC
      ) a), '[]'::jsonb),
    'sign_ins', (SELECT count(*) FROM public.audit_log WHERE action = 'auth.sign_in' AND created_at >= v_since),
    'active_people', (SELECT count(DISTINCT actor_id) FROM public.audit_log WHERE action = 'auth.sign_in' AND created_at >= v_since)
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.app_monitoring(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.app_monitoring(integer) TO authenticated;
