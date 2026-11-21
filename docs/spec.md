# Leadership Compass – Specification

Version 1.1 (revised after review, see the end of this document)
Live app: https://leadership-compass.leadership-compass.workers.dev

## 1. Purpose

Leadership Compass runs leadership **self and 360-degree assessments** for one organisation. It replaces spreadsheets
and email chains with: an org structure that decides who evaluates whom, review cycles, a guided feedback form, anonymous
reports, and AI help for raters, administrators and managers.

## 2. Users and roles

| Role | Who | Can do |
| --- | --- | --- |
| Administrator | HR / programme owner | Everything: users, org structure, cycles, assignments, reports, sharing, AI insights, monitoring, audit trail, email settings |
| Employee | Everyone else | Self-assessment and the evaluations generated for them; suggest peers; own report after the cycle closes |
| Manager (derived) | An employee with direct reports | Also: approve or add peers for the team, quick-add direct reports, add external raters, open reports an admin shared, team AI insights |
| External rater | Client, partner, contractor | Gives feedback to an employee by secure link only; never signs in |
| Outside person | Contractor, partner, client contact | Is evaluated by chosen employees; no account, no self-assessment |

Module access (view / edit per module) lets an administrator delegate Dashboard, Cycles, Org structure, Assignments,
Users and Audit to non-admins. Notifications/Settings, Insights and Monitoring stay admin-only.

## 3. Functional requirements

### 3.1 Accounts and people
- F1. Admins add users one by one (with immediate manager and groups) or by Excel bulk upload (template with checks).
- F2. New people activate with a 6-digit emailed code and choose a password (12+ characters, not their email).
- F3. Admins edit name, sign-in email, department, position, manager and any number of groups. An email change notifies
  the old and new address.
- F4. Everyone edits their own name, department and position (My profile) and can change their email after confirming a
  code sent to the new address.
- F5. Admins deactivate and reactivate accounts. A deactivated account can be **deleted with a 3-day recovery window**;
  after that, name, email and login are removed, given feedback stays anonymous, and reports move to "Deleted people".

### 3.2 Org structure and evaluations
- F6. Reporting lines (immediate manager; skip-level computed). No reporting loops.
- F7. Peers per employee (no minimum or maximum): employee suggests, immediate manager approves; admins and managers add directly.
- F8. Exclusions per person: not rated by others, does not rate others, no self-assessment.
- F9. A cycle chooses which relationships to include (self, manager, skip-level, upward, upward skip-level, peers,
  external people) and builds the evaluations from the org structure when it opens; admins can refresh.
- F10. Manual evaluations via Assignments (searchable employee list with org-chart suggestions, or someone new, or an external rater).
- F11. Admins restart a cycle (answers cleared) or delete it, confirmed by typing its name.

### 3.3 Giving feedback
- F12. 19 competencies in 4 categories; each needs a 1–5 rating and an observable behaviour example. Drafts save; submit locks; a link in the confirmation lets the rater change answers until close.
- F13. People without an active account answer through a **secure link** (one per person per cycle, signed token, revocable, expires at close).
- F14. AI help on every item: *What does this mean?* (saved explanation), *Help me understand* (questions in English or Filipino, rating suggestion from the note), *Suggest behaviours* (scenarios, examples, starters to copy), *Improve with AI* (note coach).

### 3.4 Reports and insights
- F15. Consolidated report per person and cycle: scores by rater group, bands, perception, readiness, behaviour notes, recommendations. Anonymous groups below the minimum group size are hidden.
- F16. Admin-only: individual feedback, sharing with the immediate or skip-level manager (any employee for outside people), AI feedback summary with a 30/60/90-day plan.
- F17. Workspace Insights (admin): cycle insights including themes from all written feedback, ask a question about the scores, compare cycles, person trend, form-help editor. Team insights for managers.
- F18. Dashboard grouped into Employees, Outside people and Deleted people; review status per cycle (submitted / in progress / not started, by assessor or by person).

### 3.5 Notifications, audit, monitoring
- F19. Emails through Gmail: invitations (with secure link where needed), reminders, confirmations, alerts, codes.
- F19a. In-app notification bell: red count of pending peer suggestions (immediate manager), forms to complete, new shared reports and (admins) unreleased improvement plans; items link to where they are handled; opened shared reports stay listed uncounted until removed; refreshes every minute.
- F20. Append-only audit trail of app actions, data changes and sign-ins.
- F21. Monitoring: anonymous page views and browser errors, AI use and sign-ins (admin tab), plus an uptime check every 6 hours.

## 4. AI design

- One server function (`ai-insights`) calls the provider chosen by `AI_PROVIDER`: **Google Gemini (free tier, default)** or Anthropic Claude.
- Structured JSON output with a fixed schema per feature, so the UI always gets the same shape.
- Privacy: names of everyone in the system are removed from free text; people in score data become codes ([P3]) that are restored after the answer. Insight questions use scores only. Everything AI-generated is labelled.
- Limits: when the free quota is reached, users see a friendly "try again later" message; nothing else breaks.

## 5. Non-functional requirements

- Security: row-level security on every table; privileged actions only in server functions; secrets only as function secrets; strict security headers and CSP; no secrets in the repository.
- Privacy: anonymity rules in reports; first-party analytics without personal data; deletion with anonymisation.
- Usability: works on phones; light and dark mode; accessible labels.
- Quality: lint, type-check, unit tests and build in CI on every push.

## 6. Acceptance criteria (examples)

- Opening a cycle creates a self-assessment for every included employee and the manager, skip-level, upward and peer evaluations that match the org chart.
- A secure link opens only its person's forms in that cycle; a resent link makes the old one fail.
- A deactivated account marked for deletion can be recovered for 3 days; after that its name and email are gone.
- AI requests never contain a person's name; the page-view log never contains a secure-link token (unit-tested).

---

## Review and revisions

The first version of this specification (v1.0) was reviewed against the running app and user feedback. Findings and
the resulting revisions:

| # | Review finding | Revision in v1.1 |
| --- | --- | --- |
| R1 | "Assessor" and "Talent" were separate roles, but in practice everyone is both. | Roles reduced to Administrator and Employee; manager features derived from the org structure (F6–F9). |
| R2 | Evaluations were assigned by hand and easy to miss. | Cycles generate evaluations from the org chart with include switches and refresh (F9). |
| R3 | People without an account (new hires, clients) could not take part. | Secure links, quick-add employees, external raters and outside people (F13, roles table). |
| R4 | Add assessor rejected Skip-level and External types. | Server and dialog updated for every type; searchable employee list (F10). |
| R5 | Raters did not always understand the items. | AI help on each item: explanations, questions in English/Filipino, behaviour suggestions, note coach (F14). |
| R6 | A paid AI provider was a barrier for the project. | Default provider switched to Gemini's free tier; Claude kept as an option (section 4). |
| R7 | Admins needed to see progress and health at a glance. | Review status per cycle and a Monitoring tab plus uptime checks (F18, F21). |
| R8 | Deleting people must not break past reports. | 3-day recoverable deletion with anonymisation (F5). |
