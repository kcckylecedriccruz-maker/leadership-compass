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
- Phase 2 `bulk-link-people` only handles rows whose effective role is talent (existing accounts keep their current role). Reporting-line rules mirror create-talent; keep them in sync.
