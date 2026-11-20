import { supabase } from '@/lib/supabase';

/**
 * First-party, privacy-friendly analytics: anonymous page views and browser errors only. No user id, no names,
 * and secure-link tokens never leave the browser (the path is sanitised).
 */
export function safePath(pathname: string): string {
  return pathname.replace(/^\/e\/[^/]+/, '/e/[link]').slice(0, 200) || '/';
}

function send(kind: 'page_view' | 'client_error', path: string, detail: string | null) {
  // Fire and forget: monitoring must never break the app.
  void supabase
    .rpc('log_app_event', { p_kind: kind, p_path: path, p_detail: detail })
    .then(
      () => undefined,
      () => undefined,
    );
}

let lastView = '';

/** Records a page or screen view, e.g. trackView('My assessments'). Repeats of the same view are ignored. */
export function trackView(view: string) {
  const path = `${safePath(window.location.pathname)}#${view}`.slice(0, 200);
  if (path === lastView) return;
  lastView = path;
  send('page_view', path, null);
}

let errorsSent = 0;

/** Reports uncaught browser errors (at most 10 per page load). */
export function startErrorMonitoring() {
  const report = (message: string) => {
    if (errorsSent >= 10) return;
    errorsSent += 1;
    // Strip anything that looks like a link token or an email address from the message.
    const clean = message.replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[email]').replace(/[0-9a-f-]{36}\.\d+\.[\w-]{20,}/gi, '[link]');
    send('client_error', safePath(window.location.pathname), clean.slice(0, 500));
  };
  window.addEventListener('error', (event) => report(event.message || 'Unknown error'));
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason instanceof Error ? event.reason.message : String(event.reason ?? 'Unhandled rejection');
    report(reason);
  });
}
