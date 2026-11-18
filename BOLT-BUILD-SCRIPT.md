# Leadership Compass by Formidea: Bolt build script

A sequence of prompts that rebuilds this application in [Bolt.new](https://bolt.new), phase by phase.

## Which path to use

| Path | When | How |
| --- | --- | --- |
| **A. Import (fastest, exact)** | You want this exact app in Bolt | Import `leadership-compass-bolt.zip` (or the project folder) into Bolt, then paste `BOLT-PROMPT.md` as the first message. |
| **B. Rebuild with this script** | You want Bolt to generate the app from a specification, or start a fresh project | Paste the prompts below **one at a time, in order**. Wait for each to finish, run its **Check**, then paste the next. |

## How to use this script

- Start a new Bolt project with the **React + Vite + TypeScript** template and connect **Supabase** when Bolt asks (Bolt's Supabase integration). Every prompt assumes that connection.
- Paste each prompt exactly, one per message. Do not combine them: Bolt builds better in small, testable steps.
- After each prompt, run the **Check**. If it fails, tell Bolt what you saw, for example: *"The Users tab shows 'We could not load users'. Fix it."*
- Secrets (Gmail App password, service role key) are **never** pasted into chat or code. You add them in Supabase > Edge Functions > Secrets yourself (Prompt 9).
- Typecheck, lint and build must pass after every prompt. Ask Bolt to run `npm run typecheck && npm run lint && npm run build` if it does not.

---

## Prompt 1: Foundations, brand and rules

```
Build "Leadership Compass by Formidea", a leadership self and 360-degree assessment web app.

Stack and rules (apply to every later step):
- React 18 + TypeScript + Vite + Tailwind CSS, icons from lucide-react only, Supabase for auth, Postgres and Edge Functions.
- Import modules with the "@/..." alias for src/ (configure it in vite.config.ts and tsconfig).
- Every database change goes in a NEW timestamped SQL migration. Never edit an old migration.
- Every table has row-level security. Privileged actions run in Supabase Edge Functions (Deno) that check the caller.
- Write plain, direct UI copy. Accessible: labelled inputs, keyboard-usable dialogs with focus trap and Escape to close.
- Must work at 375 px wide with no sideways scrolling, and in dark mode.

Brand (Formidea, formideaph.com). Put colours in CSS variables on :root with a dark-mode set under
@media (prefers-color-scheme: dark), and map them in tailwind.config.js:
- Font: "Public Sans" from Google Fonts (400-800), system fallbacks.
- Light: canvas #f4f7fa, surface #ffffff, muted #edf2f7, line #dbe3eb, ink #16202a, ink-muted #5c6773,
  primary #005b99 (hover #00477a, text on it #ffffff), sky #2ea3f2, accent #d83024 (hover #b5261c, text #ffffff),
  brand-deep #003a63, danger #b42318 (soft #fdf1f0), band-strength #1d7a4c, band-developing #a95d06,
  band-development #b42318, band-unrated #66747f, focus ring #2ea3f2.
- Dark: canvas #0a121b, surface #101c28, muted #162636, line #233649, ink #e8eef5, ink-muted #9fb0c2,
  primary #4fb3f5 (hover #7cc6f7, text #04111c), sky #6cc2f8, accent #ff6b5e, brand-deep #06223a,
  danger #ff8a80 (soft #3a211f), focus #6cc2f8.
- Corners: card 10px, xl 6px, 2xl 8px. Headings weight 700.
- Component classes in index.css: .btn-primary (blue), .btn-secondary (outlined), .btn-accent (red, for the main
  action on public pages only), .field-input, .eyebrow (12px uppercase, 0.14em letter spacing, primary colour).
- A BrandMark component: a 40px blue tile holding a white compass with a red needle (inline SVG), the text
  "Leadership Compass" (bold) and below it "BY FORMIDEA" (10px uppercase, tracked). Same compass as public/favicon.svg.
- Page title "Leadership Compass · Formidea", theme-color #005b99.

Create reusable components: Modal (sizes default and wide), Notice (error and info tones), Badge (neutral,
success, warning), FormField, StatusScreens (loading and error). Create src/lib/supabase.ts from
VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY, and a callEdgeFunction(slug, body, typeGuard) helper that sends
the signed-in user's access token and returns { ok, data } or { ok: false, message }.
```

**Check:** the app starts, shows Public Sans text, and `npm run build` passes.

---

## Prompt 2: Core database

```
Create the core schema in one migration, with row-level security on every table and no access for anon.

Tables:
- profiles: id (= auth.users.id), full_name, email (unique), role (admin | manager | assessor | talent),
  must_change_password bool default true, temp_password_expires_at, tour_seen_at, activated_at,
  is_active bool default true, deactivated_at, deactivated_by, department text (<=100), position text (<=100).
- talents: id, profile_id (unique), department, position, immediate_manager_id (mirrors the primary manager).
- talent_managers: talent_id, manager_profile_id, is_primary; a talent cannot be their own manager.
- cycles: id, name, opens_at, closes_at (> opens_at), status draft | open | closed, reminder_every_days (default 7),
  alert_on_submit (default true), min_group_size (default 3).
- competencies: id, category, name (unique), definition, sort_order 1..19.
- assignments: id, cycle_id, talent_id, assessor_id, classification immediate_manager | direct_report | peer | self,
  status not_started | draft | submitted, submitted_at, last_reminded_at, copy_requested, edit_token_hash;
  unique (cycle_id, talent_id, assessor_id); a self assessment must be done by the talent themselves.
- responses: assignment_id + competency_id (PK), rating 1..5, behaviour_note (not blank, <=2000), updated_at.
- action_library: competency_id (PK), on_the_job, coaching, learning, measure.
- activation_codes, password_reset_requests (service role only).
Foreign keys use ON DELETE RESTRICT so assessment data is never removed by cascade.

Seed the 19 competencies in 4 categories (sort order in brackets) with a one-sentence definition each, and one
action_library row per competency:
- Leading Self: Self-Awareness (1), Emotional Resilience (2), Integrity & Ethics (3), Continuous Learning (4),
  Time & Energy Management (5)
- Leading Others: Coaching & Developing Others (6), Delegation & Empowerment (7), Feedback & Recognition (8),
  Conflict Management (9), Building Trust (10)
- Leading the Business: Strategic Thinking (11), Decision Making (12), Business & Financial Acumen (13),
  Customer Focus (14), Results Orientation (15)
- Leading Change: Change Advocacy (16), Managing Uncertainty (17), Innovation (18), Sustaining Change (19)

Access helpers in a private schema (SECURITY DEFINER, search_path ''): is_admin() (active admin only),
manages_talent(talent), is_assessor_of_talent(talent), can_read_profile(profile), can_read_cycle(cycle),
is_assignment_assessor(assignment), is_assignment_editable_by_me(assignment) (my assignment, not submitted,
cycle open and before closes_at), can_view_talent_report(talent) (admin, a manager of the talent, or the talent
themselves once none of their cycles is open).

When a talent_managers row is inserted, a trigger creates an immediate_manager assignment for that talent in
every draft or open cycle (or converts an unstarted assignment to immediate_manager).

RPCs: save_assessment_draft(assignment, responses jsonb) (stores partial items, sets status draft),
clear_assessment_draft, set_talent_managers(talent, manager_ids, primary_id), set_assignment_classification,
remove_assignment (only before feedback starts), complete_password_change (clears the flag, sets activated_at),
mark_tour_seen, cycle_coverage_gaps(cycle) (talents missing an immediate manager, direct report or peer).
```

**Check:** in Supabase > Table Editor you see all tables and 19 competencies.

---

## Prompt 3: Audit trail (database)

```
Add an append-only audit trail in a new migration.

- audit_log: id, created_at, actor_id, actor_email (filled by a BEFORE INSERT trigger from profiles), action,
  entity, entity_id, details jsonb (before/after), source app | data_change | auth. Indexes on created_at,
  action, (entity, entity_id), actor_id.
- A trigger rejects every UPDATE and DELETE on audit_log, for every role.
- A generic AFTER INSERT/UPDATE/DELETE trigger audit_row_change on profiles, talents, talent_managers, cycles,
  assignments and app_settings writes action "<table>.<insert|update|delete>" with only the changed fields.
  It strips edit_token_hash and gmail_token_secret_id. Never audit responses (anonymity).
- A trigger on auth.users records "auth.sign_in" when last_sign_in_at changes; wrap it in an exception
  handler so auditing can never block a sign-in.
- RPC record_audit_event(action, details) for the client, allow-listed to "auth.sign_out" and
  "audit.exported" (admins only).
- Only admins (and later, people with Audit view access) can SELECT audit_log.
```

**Check:** edit a cycle in the Table Editor, then select from audit_log: a `cycles.update` row shows before/after.

---

## Prompt 4: Sign-in, activation and the app shell

```
Build authentication and the signed-in shell.

- ONE sign-in page for everyone (no admin/member selector): email + password, "Forgot password?" dialog,
  and "Invited but no password yet? Create your account" linking to /activate. Main button uses .btn-accent.
- AuthProvider: load the profile (select '*') plus whether the person manages talents or is a talent.
  If is_active is false, sign out and show "This account has been deactivated. Contact your administrator if you
  need access." Map Supabase "banned" sign-in errors to the same message. If must_change_password, show a
  change-password page. On sign-out, call record_audit_event('auth.sign_out') without blocking.
- /activate (public): step 1 email -> edge function request-activation-code emails a 6-digit code (always answers
  "If you've been invited, we've emailed you a 6-digit code."; 3 requests per hour; 15-minute expiry). Step 2 code
  + new password (12+ characters, not the email, typed twice) -> edge function activate-account sets the password,
  activated_at, writes audit "profile.activated", returns { email, message }, then the page signs the person in.
  Any 2xx response counts as success. All roles can activate, admins included.
- /privacy: a public privacy page.
- Landing page (signed out): white sticky header with BrandMark, section links and a red "Sign in" button; a
  full-width deep-blue hero (brand-deep with soft sky and red radial glows) with the eyebrow "FORMIDEA BUSINESS
  CONSULTANCY & LEARNING", an uppercase extra-bold headline "See yourself the way others see you", a short
  paragraph, three check-marked highlights, and the sign-in card beside it; a blue/sky/red stripe under the hero;
  sections Why it matters, How it works, Your report, For admins; a deep-blue footer.
- Signed-in shell: sticky header with the brand stripe, BrandMark, name and role, Welcome tour, a Notifications
  button ONLY for admins, and Sign out. Home tabs: "My assessments" (assessors and talents), "My report"
  (talents), "Workspace" (admins and anyone with module access), "My team" (managers).
```

**Check:** you can open /activate and /privacy signed out, and the landing page matches the brand.

---

## Prompt 5: First admin and secrets setup

```
Add scripts/create-first-admin.mjs: with SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ADMIN_EMAIL, ADMIN_FULL_NAME
and ADMIN_PASSWORD from the environment, it refuses if an admin exists, otherwise creates the auth user (email
confirmed) and an admin profile with must_change_password true.

Add scripts/setup-first-admin.ps1 for Windows: reads the linked project ref from supabase/.temp/project-ref, gets
the service role key through `npx supabase projects api-keys`, asks for email, name and a hidden temporary
password (Read-Host -AsSecureString), runs the .mjs script and clears the variables afterwards.
Document both in the README. Never print or store the key or password.
```

**Check:** run the PowerShell script, sign in as the admin, and you are asked to choose a new password.

---

## Prompt 6: Module access and user control

```
Add per-module access and the Users screen.

Database (new migration):
- module_access(profile_id, module, level view|edit, updated_at, updated_by). Modules: dashboard, cycles, people,
  talents, assignments, users, audit, settings.
- public.module_level_for(profile, module) for the service role: 0 if missing or inactive, 2 for active admins,
  0 for "settings" unless admin (Settings / Notifications is admin-only and can never be granted), otherwise the
  granted level (view 1, edit 2). private.module_level / can_view / can_edit for the signed-in user.
- Extra permissive RLS policies so module viewers can read what each screen needs and editors can write cycles,
  talents and profile names; a trigger blocks anyone but an admin or server code from changing a profile's role,
  email or active status. Point set_talent_managers at talents edit and the assignment RPCs at assignments edit.
- Audit module_access changes.

Edge functions (shared helper _shared/access.ts with callerFromRequest, hasModule, hasModuleById):
- create-user (Users edit): name, email, role, department, position, groups, optional module access, sendInvite.
  Random password nobody sees; profile must_change_password false; sends an "account_invite" email; audit
  "user.created". Only admins create admins or grant module access. Put this logic in _shared/userCreation.ts.
- manage-user (Users edit): set_role, deactivate (ban in Supabase Auth, ban_duration 876000h, reason),
  reactivate, require_password_change, rename, set_module_access (admin only). Nobody changes their own role,
  access or status; the last active admin cannot be removed; non-admin editors cannot touch admins. Audit each.
- resend-invite: admins, Users or Assignments editors, and managers for their own people.

Frontend:
- Profile gets modules: Record<Module, 0|1|2>; helpers canView, canEdit, hasWorkspaceAccess.
- Workspace tabs come from module access: Dashboard, Cycles, People, Talents, Assignments, Users, Audit trail.
  View-only tabs show "(view)" and their panels hide every add/edit button.
- Users panel: stat tiles (accounts, active, invite pending, active admins); search; filters for role, status
  and group; each person shows role, status badges, groups, position and department, module access summary
  and last sign-in (from audit_log auth.sign_in). Actions: Resend invite, Rename, Role, Access (None/View/Edit
  per module; Dashboard and Audit trail are view-only; Settings is not listed), Reset password, Deactivate or
  Reactivate. Buttons: Groups, Bulk upload, Add user.
```

**Check:** create an assessor with Cycles = View; signed in as them, Workspace shows only Cycles (view) with no New cycle button.

---

## Prompt 7: Groups

```
Add user groups.
- user_groups(id, name unique case-insensitive <=100, description <=500, created_at, created_by) and
  user_group_members(group_id, profile_id, added_at, added_by), cascade from groups only. RLS: read with Users or
  People view (and your own memberships), write with Users edit. Audit both tables.
- Groups dialog from the Users panel: list with member counts; New group; rename; delete (people stay); Members
  view with a searchable checklist. Add user lets you pick groups. The Users list filters by group and shows
  group badges.
```

**Check:** create "Batch 1", add two people, filter the Users list by Batch 1.

---

## Prompt 8: Cycles, talents, assignments and the assessment form

```
Build the workspace modules and the assessor form.
- Cycles: list and dialog (name, open/close dates, status, reminder days, alert on submit, min group size).
  Opening a cycle NEVER blocks: each draft or open cycle card shows a warning listing talents that still lack an
  immediate manager, direct report or peer (from cycle_coverage_gaps), with a note that small groups stay hidden.
- Talents: create (new or existing person, department, position, one or more managers with a primary one), edit,
  resend invite, send temporary password. Edge functions create-talent and add-existing-talents (Talents edit) add
  self assessments in draft/open cycles and send notices.
- People: everyone with an account, relationship badges, select people to add as talents (bulk), and admin-only
  per-person notification settings.
- Assignments: per cycle and talent, add assessors (edge function invite-assessor, creates accounts when needed and
  emails an invite), change classification, remove before feedback starts. Managers see only their talents.
- My assessments: open and draft cycles; draft-cycle items show "Not open yet" with no button. The form lists the
  19 competencies by category, a 1-5 rating and a required behaviour note each, autosaves drafts, and submits
  through edge function submit-assessment (all 19 complete, cycle open and before close, audit, emails a
  confirmation and, if enabled, an alert to admins and managers). Reopen links let an assessor reopen once.
```

**Check:** open a cycle, add a talent with a manager, and the manager sees "Start feedback".

---

## Prompt 9: Gmail notifications (admin-only)

```
Email goes through one Gmail account. Edge function send-email (called only with the x-internal-secret header)
renders and logs every email in notifications (status sent | skipped | failed, provider, attempts).
- Transport order: (1) Gmail SMTP with an App password: secrets GMAIL_SMTP_USER and GMAIL_SMTP_APP_PASSWORD,
  smtp.gmail.com port 465 TLS (Supabase blocks 25/587), using npm:nodemailer; (2) Gmail API with OAuth (send-only
  scope, refresh token in Vault) if SMTP is not set; (3) Resend as an optional fallback. Alert admins when a
  fallback is used or the Gmail daily limit is near (personal Gmail about 500 a day, Workspace about 2,000).
- Email types: account_invite, account_activation, account_already_active, temporary_password, invite,
  reminder, submission_confirmation, submitted_alert, talent_added, dashboard_ready, cycle_closed, test_email.
  Clean HTML in Formidea blue with a text version; optional emails have Manage notifications and Unsubscribe
  links; security emails cannot be turned off.
- notification_preferences (per person and type, enabled, delivery instant | digest) and
  notification_digest_queue; edge functions update-notification-settings and unsubscribe.
- app_settings (sender name, reply-to, provider, Gmail status) and email_templates (admin wording overrides).
- Notifications page and Sender settings: ADMIN ONLY. "Check connection" sends a real test email before the status
  shows Connected. Edge functions update-sender-settings, connect-gmail, gmail-oauth-callback,
  check-gmail-connection, send-test-email all require an admin.
- Add scripts/set-gmail-secrets.ps1: asks for the Gmail address and a hidden 16-letter App password and saves both
  with `npx supabase secrets set --env-file` from a temporary file that is deleted afterwards.
Secrets also needed: APP_URL (public address, no trailing slash), INTERNAL_SECRET, CRON_SECRET.
```

**Check:** as admin, Notifications > Sender settings > Check connection delivers a test email.

---

## Prompt 10: Scheduler, reports and dashboard

```
- Edge function daily-scheduler (x-cron-secret header, value also stored in Vault as cron_secret): opens draft
  cycles whose open date has passed, sends reminders every reminder_every_days to unfinished assessments, sends
  digests, closes cycles after their close date, and sends "dashboard ready" once per talent when everyone has
  submitted. Schedule it with pg_cron at 00:00 UTC using net.http_post and the Vault secret (document the SQL).
- Report RPCs (SECURITY DEFINER, filtered by can_view_talent_report or Dashboard view):
  competency_scores(cycle): per talent and competency, averages from submitted forms for self, manager, peer,
  direct report and others (all non-self). Hide peer and direct-report groups below min_group_size.
  gap_to_target = 5 - others. band: Strength >= 4, Developing >= 3, else Development need.
  perception: Blind spot if self - others >= 1, Hidden strength if others - self >= 1, else Aligned.
  readiness_ranking(cycle): average gap per category (Leading Self, Leading Others, Leading the Business,
  Leading Change) and overall, categories_above_one, status Ready (overall <= 1 and none above 1),
  Developing (at most one above 1), Not yet ready, or Insufficient feedback, and rank by overall gap.
  behaviour_notes(cycle, talent): submitted notes, hiding groups below the minimum size, in a shuffled order.
- Dashboard: cycle picker and a ranked readiness list; Report page: readiness by category, scores table with band
  and perception, strengths, blind spots, 3 focus areas with actions from action_library, and a 30/60/90/180/360
  day plan. Talents see "My report" once their cycles are closed.
```

**Check:** submit test feedback in a closed test cycle and open the talent's report.

---

## Prompt 11: Audit trail screen

```
Add Workspace > Audit trail (admins and Audit viewers): newest first, 50 per page, search by action, email or
record id, filters for source (App action, Data change, Sign-in / out), record type and date range. Each entry
shows time, a readable action, who did it ("System" when there is no actor) and the record; expanding it shows a
Before/After table for changed fields and any other details. Export CSV (up to 10,000 rows, cells quoted and
protected against spreadsheet formulas), recorded as "audit.exported".
```

**Check:** the Audit trail lists your sign-in and the changes from earlier prompts.

---

## Prompt 12: Excel bulk upload

```
Add Users > Bulk upload, using read-excel-file and write-excel-file (pin exact versions; load the dialog lazily
so the Excel code stays out of the main bundle).

Template (download button): sheet "Users" with columns
Full name * | Email * | Role * | Department | Position | Immediate manager (email) | Direct reports (emails) |
Peers (emails) | Groups | Send invite
(required headers in dark blue, others in Formidea blue, frozen header row, five example rows with
@example.com emails that are ignored on upload) and conditional formatting that turns cells red for: name missing
when there is an email, email without "@" or repeated, unknown role, manager equal to the person's own email,
Send invite not Yes/No. Sheet "Instructions" explains every column, the rules and lists existing groups.

Parsing and checks (in the browser, before anything is sent):
- .xlsx only, <= 5 MB, <= 500 people; header row found anywhere (title rows above are fine); header matching ignores
  case, "*" and brackets and accepts aliases (Name, Work email, Job title, Reports to, ...); unknown columns are
  listed as not used; blank rows skipped.
- Per row: required name, valid unique email, role (accepts Administrator, Leader, Rater, ...), lengths <= 100
  for department/position/group names, <= 20 groups, Send invite Yes/No (blank = Yes); only admins upload admins.
- Between rows: manager, direct reports and peers must be in the file or already have an account; no
  self-reference; nobody both direct report and peer; direct reports or peers need a manager on the same row;
  detect reporting loops (A -> B -> A). Reporting lines apply only when the person's role is talent (existing
  accounts keep their current role); on other rows show a note that they are ignored.
- Existing accounts are skipped, or updated when "Update people who already have an account" is ticked (name,
  department, position, groups, reporting lines; never the role).
Preview table: Row, Person, Role, Department · Position, Reporting lines, Groups, Check (Ready / problem /
skipped / notes), with "Download rows with problems" (Excel with a Problems column) and "Upload N people".

Upload in two phases, 25 rows per request, with a progress bar:
1. Edge function bulk-create-users (Users edit): create or update each account with the shared createOneUser /
   updateExistingUser, create missing groups, send invites, audit "user.bulk_upload".
2. Edge function bulk-link-people (Users, Talents and Assignments edit): for talents, add the manager (making the
   person a talent with self and manager assessments, or adding a manager to an existing talent) and add direct
   reports and peers as assessors in every draft or open cycle; send feedback invites now for open cycles only.
Results: created / updated / skipped / failed per row with reasons, downloadable as Excel.
```

**Check:** upload the template with two real rows (a talent whose manager is the other row) and see both created and linked.

---

## After the build

1. Push migrations and deploy functions: `npx supabase db push` and `npx supabase functions deploy`.
2. Set secrets (Prompt 9) and create the cron job (Prompt 10).
3. Create the first admin (Prompt 5) and sign in.
4. Set `APP_URL` to the published address so links in emails work.

The full specification is in the PRD: *Leadership Compass — Product Requirements*.
