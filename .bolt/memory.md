# Project memory

## Product intent & audience

- Leadership Self and 360 Assessment app: collects self-assessment and 360-degree feedback.
- Primary users: admins managing people, assessments, and notification settings; participants receiving reminder emails.
- Admin tooling is a first-class concern (People list, per-person notification dialog, settings page).

## Brand personality & voice

- Clean HR-tool aesthetic: professional, trustworthy, enterprise-appropriate.
- UI copy is functional and direct (e.g. "Skipped by preference", "Send test email").

## Visual design & UX direction

- React + TypeScript + Vite + Tailwind CSS; icons from lucide-react; imports via `@/` alias.
- Admin People list opens a per-person dialog for Notification settings.
- Reminder history list: last 20 entries, newest first; entries show timestamp + sent/skipped status.
- Test-email action lives in the notification settings dialog (admin-only).
- Prefer compact, data-dense layouts suited to admin/HR workflows.

## Decisions, constraints & rationale

- Supabase stack: auth, Postgres (via migrations), Edge Functions for email delivery.
- Role-based access control enforced; admin-only actions gated in UI and function logic.
- `send-email` Edge Function handles multiple email types (reminder, test_email); payload parsed via `parsePayload`.
- Preference checks gate email delivery; `test_email` deliberately does **not** bypass checks — a skipped test confirms checks work.
- Reminder history is persisted/logged so admins can audit send vs. skipped-by-preference outcomes.
- Typecheck, lint, and build must all pass before deploy; edge functions deployed independently.
- `.bolt/prompt` is authoritative for global UI/UX rules; see it rather than restating here.

- Email transport: Gmail API (send-only scope) is primary, Resend optional fallback. Resend/FROM_EMAIL are NOT required for a Gmail-only setup.
- Gmail refresh token lives in Vault; edge functions access it only via service-role SQL functions `gmail_token_store/read/delete` (vault schema is not exposed to the Data API, so never call vault directly or rpc("create_secret")).
- Gmail sends only as the connected account: From = `app_settings.gmail_account`; sender_email must match it. No Resend domain check for Gmail.
- Google OAuth callback returns to `APP_URL/?settings=sender&gmail=connected` (no URL router; App.tsx opens Sender settings from that query).
- Public `/privacy` page (no login) is required by Google's Branding page; `public/_redirects` keeps deep links working on Netlify.
- Setup steps live in SETUP-EMAIL.md.
- Gmail SMTP (smtp.gmail.com:465, App password) takes priority over the Gmail API when secrets `GMAIL_SMTP_USER` + `GMAIL_SMTP_APP_PASSWORD` are set (`_shared/gmailSmtp.ts`, used inside `sendViaGmail`). Supabase blocks ports 25/587, so always 465.
- Supabase project is `ihjpihouoidogkvthhik` (owned by the user, replaces the earlier Bolt-managed project). 25 migrations + 19 edge functions deployed 2026-11-17.

## User control (Workspace > Users, admin only)

- `profiles.is_active`, `deactivated_at`, `deactivated_by`. `private.is_admin()` requires an ACTIVE admin.
- All changes go through the `manage-user` edge function (actions: set_role, deactivate, reactivate, require_password_change, rename). Deactivate also bans the user in Supabase Auth (`ban_duration`), reactivate unbans.
- Guardrails: no self role-change/deactivation; the last active admin can't be removed. Never edit profiles.role or is_active directly from the client.
- UI: `src/features/users/UserControlPanel.tsx`, data: `userControl.ts`. AuthProvider signs out inactive users and maps "banned" errors to a deactivated message.

## Audit trail (Workspace > Audit trail, admin only)

- `audit_log` columns: actor_id, actor_email (auto-filled), action, entity, entity_id, details (jsonb before/after), source ('app' | 'data_change' | 'auth'), created_at.
- APPEND-ONLY: a trigger rejects UPDATE/DELETE for every role. Never write code that edits or deletes audit rows.
- Trigger `audit_row_change` logs inserts/updates/deletes on profiles, talents, talent_managers, cycles, assignments, app_settings; strips edit_token_hash and gmail_token_secret_id. `responses` is NEVER audited (anonymity).
- Sign-ins logged by a trigger on auth.users (never blocks sign-in); sign-out and CSV export via `rpc('record_audit_event')`, allow-listed actions only.
- UI: `src/features/audit/AuditTrailPanel.tsx`, queries: `auditQueries.ts` (filters, 50/page, CSV export up to 10,000 rows).
- New edge functions that change data should insert an `audit_log` row with source 'app' and a dotted action name (e.g. `user.role_changed`).

## Open questions & assumptions

- Visual/dialog flows can't be browser-verified in this environment; verified via build checks only.
- Exact history table/column names and migration content not captured here; refer to code/migrations for schema specifics.
## Module access and user creation (2026-11-17)

- One sign-in page (no Admin / Assessor selector). `signIn(email, password)`.
- `module_access(profile_id, module, level)`: modules dashboard, cycles, people, talents, assignments, users, audit, settings; levels view/edit. Admins implicitly edit everything.
- DB helpers `private.can_view(module)` / `private.can_edit(module)`; edge functions use `_shared/access.ts` (`hasModule`, `hasModuleById`). Never gate new admin features on `role === 'admin'` alone; use the module check.
- `Profile.modules` holds the signed-in person's levels; `canView`/`canEdit` in `src/lib/types.ts`. Panels take a `canEdit` prop and hide actions when false.
- Users are created by the `create-user` edge function: random hidden password, `account_invite` email, the person sets their password via `/activate`. All roles (admins too) can activate.
- Report RPCs `competency_scores`, `readiness_ranking`, `behaviour_notes` now exist (migration 20261117140000); peer/direct-report groups below the cycle's min group size are hidden.

## Groups and bulk upload (2026-11-17)

- `user_groups` (unique name, case-insensitive) + `user_group_members`; RLS: view with Users/People view, write with Users edit. UI: `GroupsDialog.tsx`; filter + badges in `UserControlPanel.tsx`.
- Bulk upload: `src/features/users/bulkUpload.ts` (template via write-excel-file, parsing via read-excel-file, both pinned exact versions) and `BulkUploadDialog.tsx` (lazy-loaded so the Excel libraries stay out of the main bundle).
- Server: `bulk-create-users` (max 25 rows per call) and `create-user` share `_shared/userCreation.ts` (`createOneUser`, `ensureGroups`). Keep all account-creation rules there.
- Bulk template columns: Full name*, Email*, Role*, Department, Position, Immediate manager, Direct reports, Peers, Groups, Send invite. `profiles.department/position` exist for everyone (migration 20261117200000).
- Phase 2 `bulk-link-people` runs for every row: sets profiles.manager_id, sets the manager of each listed direct report, and adds peers via rpc("assign_peer"). Needs Users edit + Org structure (talents) edit.

## Org model (migrations 20261120100000, 20261120110000, 20261120120000)
- Roles are only 'admin' and 'employee'. Everyone is assessed and gives feedback; "manager" is derived (has rows where profiles.manager_id = id), never a role.
- profiles.manager_id is the source of truth for reporting lines (loop guard trigger; mirrored into talent_managers and talents.immediate_manager_id for compatibility). Every profile automatically has a talents row. Skip-level = manager's manager, computed.
- profiles.exclude_rated / exclude_rater / exclude_self: exclusions from being rated, rating others, self-assessment. Changing manager_id or exclusions needs can_edit('talents').
- Assignment kinds: self, immediate_manager, skip_level_manager, direct_report, skip_level_report, peer. assignments.origin: auto | peer | manual. Cycles have include_* switches and evaluations_generated_at.
- public.generate_cycle_evaluations(cycle) builds from private.desired_evaluations; runs on open (trigger cycles_generate_on_open) and on admin refresh. It only removes auto/peer rows that are not started and have no answers; never touch manual rows.
- Peers: peer_relationships with RPCs suggest_peer, assign_peer, decide_peer, remove_peer. No minimum or maximum. Employee suggests, immediate manager approves; admin/manager assign directly.
- Reports: admin-only by default. report_shares + share_report/unshare_report let admins share consolidated or individual reports with the immediate or skip-level manager. individual_feedback(cycle, talent) names only managers' feedback. Employees see their own report after the cycle closes (private.can_view_cycle_report).
- send-cycle-invites edge function sends invitations for an open cycle immediately (60 per call; loop until remaining = 0).
- restart_cycle(cycle, confirm_name) / delete_cycle(cycle, confirm_name): admin only, name must match. Restart deletes responses, resets assignments to not_started, clears shares/notices, sets draft. Delete removes notifications, notices, shares, responses, assignments, then the cycle. Both write one audit_log row (counts only).

## Evaluating without an account (migration 20261120140000)
- profiles.person_type 'employee' | 'external' (+ organisation). Externals: no talents row, never rated, never a manager or peer, login created banned; request-activation-code, activate-account and forgot-password ignore them. Hide them from User control and the org tree (orgData.people is employees only; externalsOf per employee).
- external_raters(employee_id, rater_id): like approved peers; kind/origin 'external'; cycles.include_external. apply_external_rater / withdraw_external_rater are service-role only.
- evaluation_links(profile_id, cycle_id, version, revoked_at): token = id.version.HMAC (key LINK_SIGNING_SECRET or the service role key); never store tokens. _shared/evaluationLinks.ts has currentLinkToken / rotateLink / revokeLink / resolveLink / usesLink.
- People who use links: externals and anyone with activated_at null. send-email puts the link in invite, reminder and submission_confirmation for them; evaluation_link is a separate always-on email.
- Public page /e/<token> (EvaluationLinkPage) reuses AssessmentForm with link actions. Submissions share _shared/submission.ts with submit-assessment; keep them in one place.

## Outside people and account deletion (migration 20261120160000)
- external_evaluators(external_id, evaluator_id): admin-only RPCs add_outside_evaluator / remove_outside_evaluator. Outside people get a talents row (manage-people add_outside_person), no self-assessment; evaluations are kind 'peer', origin 'external'. share_report allows any active employee for an outside person.
- Deletion: request_account_deletion / cancel_account_deletion (admin, deactivated accounts only). purge_due_deletions() (service role) anonymises after 3 days; purge-deleted-accounts (hourly pg_cron, CRON_SECRET) then deletes the auth user. profiles no longer has an FK to auth.users. manage-user refuses any change while deletion is pending. Deleted profiles have deleted_at set and are hidden from User control.
- readiness_ranking returns category employee | outside | deleted (ranked within each); the Dashboard groups by it.

## AI features (migrations 20261120180000, 20261120190000)
- Edge function ai-insights (verify_jwt false; it authenticates itself, and coach_note also accepts a secure-link token). Claude via npm:@anthropic-ai/sdk@1.6.0, model claude-opus-5-5, structured outputs (output_config.format json_schema), server-side fallbacks. Key: ANTHROPIC_API_KEY secret (scripts/set-anthropic-key.ps1).
- Never send names: nameScrubber() on free text, Pseudonyms ([P3] codes) on data, restore() after the answer.
- Tables: ai_person_summaries, ai_cycle_insights (admin read only; writes via the function). competencies.help jsonb {plain, looks_like[], not_like[], think_about}.
- restart_cycle clears AI rows; delete_cycle cascades.
- AI provider: _shared/ai.ts picks AI_PROVIDER (gemini default, claude optional). Gemini = Interactions API REST (POST /v1beta/interactions, x-goog-api-key, Api-Revision 2026-05-20, response_format json schema, generation_config.thinking_level); text from steps[type=model_output].content[type=text]. 429 = free limit reached.
