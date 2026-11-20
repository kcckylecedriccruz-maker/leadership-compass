/*
# Server code may assign peers

The bulk upload runs as server code (service role), which has no signed-in
user. assign_peer now also accepts the service role; signed-in callers still
need to be the employee's immediate manager, an org-structure editor or an
administrator. Anonymous callers cannot execute it at all.
*/

DO $$
DECLARE
  def text;
  rewritten text;
BEGIN
  def := pg_get_functiondef('public.assign_peer(uuid, uuid)'::regprocedure);
  rewritten := replace(def, 'IF NOT private.can_manage_peers_of(p_employee) THEN',
    'IF NOT (auth.role() = ''service_role'' OR private.can_manage_peers_of(p_employee)) THEN');
  IF rewritten = def THEN
    RAISE EXCEPTION 'Could not find the permission check in assign_peer';
  END IF;
  EXECUTE rewritten;
END $$;

GRANT EXECUTE ON FUNCTION public.assign_peer(uuid, uuid) TO service_role;
