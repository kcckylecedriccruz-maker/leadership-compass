# Bolt prompt: Leadership Compass

Paste the text below into Bolt as the first message after you import this project.

---

This is **Leadership Compass**, a leadership self and 360 assessment app (React 18 + TypeScript + Vite + Tailwind,
lucide-react icons, Supabase for auth, Postgres and edge functions). Import modules with the `@/` alias.

Read `.bolt/memory.md`, `README.md` and `SETUP-EMAIL.md` before changing anything. Key points:

1. **Supabase project** `ihjpihouoidogkvthhik` is already set up: 25 migrations in `supabase/migrations` and 19 edge
   functions in `supabase/functions` are deployed. Do not recreate tables or re-run old migrations. Put any schema
   change in a NEW migration file with a later timestamp.
2. **User control** (Workspace > Users) is done through the `manage-user` edge function. Keep its guardrails: no
   self role change or self deactivation, and at least one active admin.
3. **Audit trail** (Workspace > Audit trail) reads `audit_log`, which is append-only. Never update or delete its rows.
   Never copy `responses` (ratings and notes) into it. New server actions should insert an audit row with
   `source: 'app'`.
4. **Email** goes through Gmail. Gmail SMTP (secrets `GMAIL_SMTP_USER`, `GMAIL_SMTP_APP_PASSWORD`, port 465) is
   preferred, then the Gmail API (OAuth), then Resend as an optional backup. Never put secrets in code or `.env`.
5. Before finishing any change, run `npm run typecheck`, `npm run lint` and `npm run build`; all must pass.

Do not change the design system in `src/index.css` and `tailwind.config.js` unless asked.
