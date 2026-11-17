# Leadership Compass

A web app for running leadership self and 360 assessments. See yourself the way others see you, and chart your growth. Administrators set up review cycles and talents, managers and admins assign assessors, assessors complete feedback forms, and results are reported on a dashboard. Built with React 18, TypeScript, Vite, Tailwind CSS and Supabase.

## Secrets and where to set them

Secrets are never stored in the code. Set each one where indicated.

| Name | Where to set it | What it is for |
| --- | --- | --- |
| `GMAIL_SMTP_USER` | Edge function secrets | Gmail address that sends notifications and alerts (Gmail SMTP). See SETUP-EMAIL.md. |
| `GMAIL_SMTP_APP_PASSWORD` | Edge function secrets | Google App password for that address. |
| `RESEND_API_KEY` | Edge function secrets | Optional backup sender (Resend API key). |
| `FROM_EMAIL` | Edge function secrets | The sender address shown on emails, for example `Assessments <no-reply@yourdomain.com>`. The domain must be verified in Resend. |
| `APP_URL` | Edge function secrets | The public address of the app, for example `https://assess.yourcompany.com`. Used to build links in emails. |
| `INTERNAL_SECRET` | Edge function secrets | Shared secret that lets the app's own functions ask the email function to send mail. Use a long random string. |
| `CRON_SECRET` | Edge function secrets | Shared secret that proves a scheduler call is genuine. Use a long random string. |
| `cron_secret` | Database vault (name must match exactly) | Holds the same value as `CRON_SECRET`, so the scheduled job can send it. |

### Setting edge function secrets

1. Open the Supabase dashboard for this project.
2. Go to **Project Settings > Edge Functions** and add each secret above (`RESEND_API_KEY`, `FROM_EMAIL`, `APP_URL`, `INTERNAL_SECRET`, `CRON_SECRET`).
3. Use the same `INTERNAL_SECRET` and `CRON_SECRET` values wherever they are referenced; they are checked by exact match.

### Setting the vault entry for the scheduler

In the Supabase dashboard, open **SQL Editor** and run the statement below, replacing the placeholder with the same value you used for `CRON_SECRET`. Run it once. If the entry already exists, update it with `vault.update_secret` instead.

```sql
select vault.create_secret('<the same value as CRON_SECRET>', 'cron_secret');
```

Do not commit the value to the repository.

## First administrator

Accounts are created by an administrator, so the first admin must be created from the command line once. The script refuses to run if an admin already exists.

1. Set these environment variables in your terminal (not in the repository):
   - `SUPABASE_URL` - the project URL.
   - `SUPABASE_SERVICE_ROLE_KEY` - the service role key from **Project Settings > API**. Treat it as a password.
   - `ADMIN_EMAIL` - the admin's work email.
   - `ADMIN_FULL_NAME` - the admin's full name.
   - `ADMIN_PASSWORD` - a temporary password of at least 8 characters.
2. Run `node scripts/create-first-admin.mjs`.
3. The admin signs in and is asked to choose a new password straight away.

## Scheduler

A scheduled job named `daily-scheduler` runs every day at 00:00 UTC (08:00 in Manila). It sends reminders for open assessments, closes cycles whose end date has passed, and sends the "dashboard ready" notice once per talent. It is set up in the database with `pg_cron` and `pg_net`, and calls the `daily-scheduler` edge function with the `x-cron-secret` header read from the vault.

### Manual test run

Run this once after setting the secrets to confirm the scheduler is accepted. Replace the placeholders with your project URL and the `CRON_SECRET` value.

```bash
curl -i -X POST "https://<project-ref>.supabase.co/functions/v1/daily-scheduler" \
  -H "x-cron-secret: <CRON_SECRET>" \
  -H "Content-Type: application/json"
```

A `200` response means the run worked. A `401` means the value does not match between the function secret and the vault. Check the `audit_log` table for scheduler entries after a successful run.

## Adding cycles and assigning assessors

1. **Create a cycle.** Sign in as an administrator, open **Cycles**, and add a cycle with its opening and closing dates, reminder frequency and minimum group size. Keep it in draft until you are ready, then open it.
2. **Add talents.** Open **Talents** and create each talent with their manager, department and position. Creating a talent also creates their login.
3. **Assign assessors.** Open **Assignments**, choose the cycle and talent, and invite assessors. Each assessor receives an email with a link to their feedback form. Assessors can only see the talents assigned to them.
4. **Track progress.** The **Reports** tab shows completion for each assignment. The **Dashboard** tab shows readiness once results are available.

Reopening a submitted form, changing an assessor's classification, and removing an assignment are all recorded in the audit log.

## User control

Everyone signs in on the same page; what they see depends on their role and module access.

Administrators open **Workspace > Users** to:

- **add a user** (name, work email, role, optional module access). The person gets an invitation email, opens
  `/activate`, receives a 6-digit code and chooses their own password. Nobody else ever sees or sets it.
- resend an invitation to someone who has not activated yet,
- change a person's role (administrator, manager, assessor, talent),
- set **module access**: for each module (Dashboard, Cycles, People, Talents, Assignments, Users, Audit trail,
  Settings) choose None, View or Edit. Administrators always have full access.
- deactivate an account (blocks sign-in; their assessment data is kept) and reactivate it,
- require a new password at next sign-in, and correct a person's name.

Module access is enforced in the database (row-level security and RPC checks) and in the edge functions, not only in
the screen. Someone with Users edit access who is not an administrator can manage non-admin accounts only; only
administrators can create administrators or change module access. You cannot change your own role, access or status,
and the last active administrator cannot be removed. Accounts are created by `create-user` and changed by
`manage-user`; both write audit entries.

### Groups and bulk upload

- **Groups** (Workspace > Users > Groups): named groupings such as a team, batch or cohort. A person can be in several
  groups. Filter the user list by group; pick groups when adding a user. Stored in `user_groups` and
  `user_group_members`; anyone with Users edit access can change them, and every change is audited.
- **Bulk upload** (Workspace > Users > Bulk upload): download the Excel template and upload it back. Columns: Full
  name*, Email*, Role*, Department, Position, Immediate manager (email), Direct reports (emails), Peers (emails), Groups,
  Send invite. The template highlights bad cells in red inside Excel and has an Instructions sheet.
  - Checks before anything is created: required fields, valid and unique emails, known roles, lengths, Yes/No, unknown
    columns, references (manager, direct reports, peers must be in the file or already have an account), self references,
    someone listed as both direct report and peer, reporting loops, admins uploaded only by admins, the example rows.
  - Two phases: `bulk-create-users` creates (or, with "Update people who already have an account", updates name,
    department, position and groups of) every account first; then `bulk-link-people` adds reporting lines for rows whose
    role is talent: the manager makes them a talent (same steps as Add talent) and direct reports and peers become
    assessors in every draft or open cycle. Roles are never changed by an upload.
  - Rows with problems can be downloaded as Excel to fix and re-upload; results can be downloaded too. Up to 500 people.

## Audit trail

Administrators open **Workspace > Audit trail** to search, filter (source, record type, date range), page through and
export (CSV) the audit log. It contains:

- **App actions** written by the edge functions (invites, submissions, reopenings, user control, sender settings, scheduler runs).
- **Data changes** recorded automatically by database triggers on profiles, talents, talent managers, cycles,
  assignments and app settings, with before and after values. Secret columns and feedback ratings and notes are never copied.
- **Sign-ins and sign-outs**.

The log is append-only: a trigger rejects every update and delete. Exporting is itself recorded.

## Deploying these changes

1. Apply the migration `supabase/migrations/20261117120000_audit_trail_and_user_control.sql`.
2. Deploy the new `manage-user` edge function and redeploy `send-email`, `send-test-email` and `check-gmail-connection`.
3. Set the Gmail SMTP secrets (see SETUP-EMAIL.md).

The migrations enable `pg_cron` but do not create the daily job. On a new project, after setting `CRON_SECRET` and the
`cron_secret` vault entry, run in SQL Editor (replace `<project-ref>`):

```sql
select cron.schedule('daily-scheduler', '0 0 * * *', $job$
  select net.http_post(
    url := 'https://<project-ref>.supabase.co/functions/v1/daily-scheduler',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')),
    body := '{}'::jsonb);
$job$);
```

On Windows, `& .\scripts\setup-first-admin.ps1` creates the first administrator for the linked project. It reads the
service role key through the Supabase CLI and asks for the password with hidden input.

## Development

- `npm run typecheck` checks types.
- `npm run lint` runs the linter.
- `npm run build` creates the production build.
