# CLAUDE.md – guide for AI coding agents

**Owners:** Kyle Cedric Cruz and Vivian Cruz

Leadership Compass: leadership self and 360 assessments (React + Vite + TypeScript front end, Supabase Postgres +
Deno edge functions, Cloudflare hosting (Netlify backup), Gmail email, Gemini/Claude AI). Read `docs/spec.md` and `docs/ARCHITECTURE.md` first.

## Commands
- `npm run dev` – local app (port 5173) · `npm run build` · `npm run lint` · `npx tsc -b` · `npm test` (Vitest)
- Edge functions type check: `cd supabase/functions && npx -y deno@2.5.6 check --node-modules-dir=none */index.ts` (delete `deno.lock` afterwards)
- Database changes: add a new file in `supabase/migrations/` (never edit an applied one), then `npx -y supabase db push --remote=<ref> --yes`
- Deploy functions: `npx -y supabase functions deploy --remote=<ref> --use-api --yes`
- Deploy the site: `npm run build`, then Cloudflare (main) `npx wrangler@4.158.0 deploy` and, when it has credits, Netlify (backup)

## Rules
- Security first: every table has RLS; privileged writes go through SECURITY DEFINER SQL functions or edge functions with `SET search_path = ''`.
- Never put secrets in code or the repo. Keys are Supabase function secrets (set with the scripts in `scripts/`).
- Never send names to the AI: use `nameScrubber` and `Pseudonyms` in `supabase/functions/ai-insights/data.ts`.
- Anonymity: Peer, Direct report and External feedback is anonymous and hidden below the cycle's minimum group size.
- `audit_log` is append-only. New data-changing server code writes an audit row.
- Roles are only `admin` and `employee`; "manager" is derived from `profiles.manager_id`.
- Use `@/` imports, Tailwind tokens (`bg-surface`, `text-ink-muted`, `btn-primary`…), and existing components (`Modal`, `Notice`, `FormField`, `Badge`).
- Dependencies: pin exact versions that are at least two weeks old.
- Add or update unit tests for pure logic; keep `npm test`, lint, type-check and build green (CI runs them).

## Where things are
- `src/features/*` – feature folders (assessments, cycles, org, users, reports, ai, link, monitoring, notifications)
- `src/pages/*` – top-level pages · `src/lib/*` – shared helpers
- `supabase/functions/*` – edge functions; shared code in `_shared/`
- `supabase/migrations/*` – schema history
