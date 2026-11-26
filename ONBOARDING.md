# Onboarding – Leadership Compass

**Owners:** Kyle Cedric Cruz and Vivian Cruz

Welcome! This guide gets you (and your Claude Code) up to speed on **Leadership Compass**, a web app for leadership
self and 360-degree assessments with AI help. Live app: https://leadership-compass.leadership-compass.workers.dev

## 1. What it does (in one minute)
- **Org structure** decides who evaluates whom: self, immediate manager, skip-level manager, direct reports, skip-level
  reports, peers, external raters (clients/partners) and outside people.
- **Cycles** generate the evaluations when they open; admins can refresh, restart or delete a cycle and see review status.
- **Feedback form**: 19 competencies, a 1–5 rating and an observable behaviour example each, with AI help
  (*What does this mean?*, *Help me understand* in English/Filipino with a rating suggestion, *Suggest behaviours*,
  *Improve with AI*).
- **Reports**: anonymous by rater group (minimum group size), admin-only individual feedback and sharing, AI feedback
  summary with a 30/60/90-day plan; admins can open reports before the cycle closes. **How to improve**: AI
  interventions per focus area, manager notes, released to the employee by an admin.
- **Notification bell** next to My profile: red count of pending forms, peer approvals, shared reports and plans.
- **Insights** (admin): cycle insights with themes from written feedback, ask a question about the scores, compare
  cycles, person trend; **Team insights** for managers.
- People **without an account** answer through **secure links**; quick-add employees; account deletion with a 3-day
  recovery window; audit trail; monitoring.

Roles are only **Administrator** and **Employee**; "Manager" is derived from having direct reports.

## 2. Read these first
1. `CLAUDE.md` – rules for AI coding agents (your Claude reads it automatically).
2. `docs/spec.md` – features, acceptance criteria and the review/revision history.
3. `docs/ARCHITECTURE.md` – system diagram, data model, key decisions.
4. `README.md` – full setup, deployment and reference.
5. `docs/PRD.md` – 1-page product requirements (the full PRD is a shared Claude document; ask for access).

## 3. Stack
React 18 + TypeScript + Vite + Tailwind · Supabase (Postgres with RLS, Auth, Deno edge functions, pg_cron) ·
Cloudflare hosting (Netlify backup) · Gmail SMTP for email · Google Gemini (free tier, default) or Anthropic Claude for AI ·
Vitest + GitHub Actions for CI.

## 4. Run it locally
1. Install Node.js 22+ and Git.
2. Clone the repository and run `npm install`.
3. Create `.env` in the project root with the **public** values (ask the project owner):
   ```
   VITE_SUPABASE_URL=https://<project-ref>.supabase.co
   VITE_SUPABASE_ANON_KEY=<public anon key>
   ```
   The anon key is meant to be public; all data is protected by row-level security.
4. `npm run dev` → http://localhost:5173. Sign in with an account the owner creates for you.
5. Before every commit: `npm run lint`, `npx tsc -b`, `npm test`, `npm run build`.

You do **not** need the Gemini, Gmail or other server keys to develop the front end. They live only as Supabase
function secrets. Never put a key in code, chat or the repository.

## 5. Where things are
| Path | What |
| --- | --- |
| `src/features/*` | Feature folders: assessments, cycles, org, users, reports, ai, link, monitoring, assignments, notifications |
| `src/pages/*` | Top-level pages (workspace, link page, profile, login) |
| `src/lib/*` | Shared helpers (Supabase client, telemetry, formatting, types) |
| `supabase/migrations/*` | Database schema history (never edit an applied file; add a new one) |
| `supabase/functions/*` | Edge functions; shared code in `_shared/` (`ai.ts`, `gemini.ts`, `claude.ts`, `evaluationLinks.ts`, `submission.ts`) |
| `.github/workflows/*` | CI and uptime check |
| `docs/*` | Spec, architecture, PRD, project deliverables |
| `scripts/*` | Helper scripts (set secrets, public link) |

## 6. Working rules (summary of CLAUDE.md)
- Security first: RLS on every table; privileged writes only via SECURITY DEFINER SQL or edge functions.
- Never send names to the AI (`nameScrubber`, `Pseudonyms` in `supabase/functions/ai-insights/data.ts`).
- Keep anonymity rules; `audit_log` is append-only.
- Pin new dependencies to exact versions at least two weeks old.
- Add unit tests for new pure logic; keep CI green.
- Work on a branch and open a pull request; the owner deploys database and function changes unless you have access.

## 7. Current status and open to-dos
Done: all features above live; 15 unit tests; CI and uptime workflows; monitoring; spec, architecture, PRD.

Open:
- [x] Code on GitHub (public), CI green.
- [x] AI features tested live (Gemini free tier) with `docs/TEST_CHECKLIST.md`.
- [x] v2 GitHub issue created from `docs/V2_ISSUE.md`.
- [x] Idea-validation evidence (`docs/VALIDATION.md`) and reflection (`docs/REFLECTION.md`).
- [ ] Owner-only: 2-minute demo (`docs/DEMO_SCRIPT.md`).

Note: this is an individually graded course project; agree with the owner on what help is allowed.

## 8. Good first tasks
- Run through `docs/TEST_CHECKLIST.md` on a local or test account and report anything broken.
- Add unit tests for `src/features/assignments/assignmentCoverage.ts` or the report recommendation logic.
- Implement the v2 issue (note-quality and completion trends on the Dashboard).
