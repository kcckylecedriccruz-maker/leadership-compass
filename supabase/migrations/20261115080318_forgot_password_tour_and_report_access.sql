/*
# Temporary passwords, welcome tour, action library and talent report access

Plain-English summary
This migration supports four new features: self-service temporary passwords, the welcome tour, the development action library used in reports, and letting a talent read their own report once their cycle has closed.

1. New columns on profiles
- temp_password_expires_at (timestamptz, nullable): when a temporary password stops being valid. Empty for normal accounts.
- tour_seen_at (timestamptz, nullable): when the user finished or skipped the welcome tour. Empty means the tour has not been seen yet.

2. New table: password_reset_requests
- Logs each accepted "forgot password" request (email and time) so the app can limit requests to 3 per email per hour.
- Row level security is on with no policies, so browsers can never read or write it. Only server-side code using the service role touches it.

3. New table: action_library
- One row per competency with four development fields: on_the_job, coaching, learning and measure.
- Shared reference content with no personal data. Signed-in users can read it; nobody can write it through the app.
- Seeded with 19 rows, joined to competencies by sort order so the seed works on a new database.

4. Changed functions
- complete_password_change: also clears temp_password_expires_at when the user sets a new password.
- mark_tour_seen (new): sets tour_seen_at for the signed-in user only, once.
- private.can_view_talent_report: admins and managers keep access. A talent can now also view their own scores and notes, but only when none of their cycles is still open (open means status open and close date not yet passed). This keeps in-progress results hidden.

5. Security
- mark_tour_seen runs as the owner and is granted to signed-in users only; anonymous users cannot run it.
- action_library grants SELECT to authenticated only.
- password_reset_requests grants to service_role only.

6. Notes
- No tables are dropped, no data is changed other than the one-time seed of action rows, and every statement is safe to run again.
*/

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS temp_password_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS tour_seen_at timestamptz;

CREATE TABLE IF NOT EXISTS public.password_reset_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS password_reset_requests_email_time_idx
  ON public.password_reset_requests (email, requested_at);

ALTER TABLE public.password_reset_requests ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT ON public.password_reset_requests TO service_role;

CREATE TABLE IF NOT EXISTS public.action_library (
  competency_id uuid PRIMARY KEY REFERENCES public.competencies (id) ON DELETE CASCADE,
  on_the_job text NOT NULL,
  coaching text NOT NULL,
  learning text NOT NULL,
  measure text NOT NULL
);

ALTER TABLE public.action_library ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.action_library TO authenticated;

DROP POLICY IF EXISTS "action_library_select" ON public.action_library;
CREATE POLICY "action_library_select" ON public.action_library FOR SELECT
  TO authenticated USING (true);

INSERT INTO public.action_library (competency_id, on_the_job, coaching, learning, measure)
SELECT c.id, v.on_the_job, v.coaching, v.learning, v.measure
FROM (VALUES
  (1, 'Before each team meeting, name one behaviour you want to show and one you want to change, then ask a colleague afterwards how it landed.', 'Ask your manager for a monthly 15-minute review comparing your own view of your behaviour with what others see.', 'Work through a guided self-reflection tool and keep a weekly reflection journal for eight weeks.', 'At re-rating, your Self and Others scores for this competency are within 1 point of each other.'),
  (2, 'When a plan is disrupted, pause for 60 seconds, name the emotion, then state the next step to your team calmly.', 'Agree a short debrief with your manager after each high-pressure event, focused on what you did to stay steady.', 'Complete a resilience course or structured stress-management programme and practise one technique daily, such as paced breathing.', 'Colleagues rate this item 4 or higher at re-rating and the Others band moves up at least one level.'),
  (3, 'Raise one difficult fact or decision openly in a meeting where others might prefer silence, and explain your reasoning.', 'Ask a trusted peer to flag any moment when your words and actions did not match, and review these with them monthly.', 'Study the organisation code of conduct and a case-based ethics module, then write one lesson applied to your own role.', 'No unresolved integrity concerns in 360 comments and the Others score for this item is 4.0 or higher.'),
  (4, 'Apply one new idea from a course, book or peer within two weeks and report the result in your next team meeting.', 'Agree a learning goal with your manager and review progress at each one-to-one.', 'Complete one structured course in your development area within 90 days.', 'Course completed with at least one applied example shared, and the Others score for this item rises by 0.5 or more.'),
  (5, 'Block two hours each week for priority work, and reschedule or decline one low-value request each week.', 'Review your calendar with your manager monthly and agree which commitments to stop, delegate or protect.', 'Complete a prioritisation course and use a weekly planning method, such as a priority matrix, for 12 weeks.', 'Protected priority time appears in your calendar every week for 12 weeks, confirmed by your manager.'),
  (6, 'In each one-to-one, ask the person what they want to learn, then ask open questions before giving your view.', 'Ask your manager to observe one coaching conversation and give feedback on your questions and listening.', 'Complete a structured coaching skills programme and practise the GROW model with two team members.', 'Two team members name a development step they took after a coaching conversation, and the Others score reaches 4.0 or higher.'),
  (7, 'Hand over one meaningful task each month with a clear outcome, the decision rights and a check-in date, and let them choose the method.', 'Review each handover with your manager, noting where you were tempted to take the work back.', 'Study a delegation model, such as the levels of delegation framework, and apply it to your next three handovers.', 'Three handovers completed with the outcome delivered without you redoing the work, and the Others score improves.'),
  (8, 'Give one specific piece of recognition and one specific development comment each week, within 48 hours of the behaviour.', 'Ask your manager to review your feedback notes monthly and suggest more precise wording.', 'Complete a feedback skills course using the situation, behaviour and impact model and practise it in writing.', 'Team pulse survey feedback item reaches 4 or higher and the Others score for this item is 4.0 or above.'),
  (9, 'When disagreement surfaces, name the issue, ask each person for their view, and agree a next step before the meeting ends.', 'After each significant disagreement, debrief with your manager on what you said and what the other person needed.', 'Complete a conflict resolution workshop and practise interest-based negotiation in two real cases.', 'Two disagreements resolved with agreed actions recorded and neither escalated to senior leaders.'),
  (10, 'Keep every commitment you make in a visible tracker and tell people early if a commitment will slip.', 'Ask two colleagues each quarter to rate how reliable and open you are, and discuss the results with your manager.', 'Study a trust model, such as the trust equation, and document one trust-building action each week.', 'Commitment tracker shows 90 percent or more kept on time over 90 days, and the Others score improves.'),
  (11, 'Write a one-page view of how your team work links to the top three company priorities and share it with your manager.', 'Test your strategic view with your manager and a peer leader each quarter, and refine it from their challenge.', 'Complete a strategy or scenario planning module and apply one tool to a real decision.', 'Strategy one-pager agreed with your manager and the Others score for this item reaches 4.0 or higher.'),
  (12, 'For each significant decision, record the options, the criteria, the decision and the reasoning, and share it with those affected.', 'Review your three most recent decisions with your manager and identify what information you could have sought earlier.', 'Take a decision-making course covering structured options analysis and practise one framework on a live decision.', 'Decision log kept for 90 days and no decision reversed because of missing information.'),
  (13, 'Review your area budget and one key business metric each month, and explain to your team what drives the numbers.', 'Agree a monthly walk-through with a finance partner of your area results and the decisions they imply.', 'Complete a finance for non-finance managers course and build a simple model of one initiative return.', 'You present a budget review to your team within 90 days and the Others score improves by at least 0.5.'),
  (14, 'Spend time each month with a customer or with the team that serves customers, and bring one insight back to a team meeting.', 'Ask your manager to challenge how your decisions affect customers, and agree one customer measure to track.', 'Complete a customer experience course and map the journey for one service your team delivers.', 'Customer journey map shared with the team and one process changed because of customer feedback.'),
  (15, 'Set three measurable goals for your team each quarter, review progress weekly and act on any goal that is off track.', 'Review goal progress monthly with your manager and agree how to remove the biggest obstacle.', 'Complete a goal-setting and performance management course and apply objectives and key results to your team.', 'Three quarterly goals met or substantially met and the Others score for this item reaches 4.0 or higher.'),
  (16, 'Explain one change in plain language to your team, including why it matters, what it means for them and what will not change.', 'Ask your manager to review your change messages and suggest how to address the concerns you heard.', 'Complete a change leadership course and apply one change model, such as the stages of change, to a live change.', 'Team members can state the purpose of the change in their own words, confirmed in a short check-in.'),
  (17, 'When facts are unclear, state what you know, what you do not know, and the decision you will make by a set date.', 'After each uncertain period, review with your manager how you communicated and how you kept the team steady.', 'Practise scenario planning with a small team, documenting three likely futures and the actions for each.', 'Team reports feeling informed during uncertainty in a pulse check and the Others score improves.'),
  (18, 'Run one short experiment each quarter with a clear hypothesis, a budget and a review date, and share what you learn.', 'Test each experiment idea with your manager before you start, and agree what success looks like.', 'Complete an innovation or design thinking course and run one structured ideation session with your team.', 'At least one experiment completed and reviewed, with lessons documented and shared with the wider team.'),
  (19, 'Build one new routine from a change into your regular team meetings and check whether it is still used after 60 days.', 'Review with your manager which changes have stuck and which have slipped, and agree one reinforcement action.', 'Study a change sustainment approach, such as embedding change through systems and routines, and apply it to one change.', 'The new routine is still in use at the 60-day check and the Others score for this item is 4.0 or higher.')
) AS v(sort_order, on_the_job, coaching, learning, measure)
JOIN public.competencies c ON c.sort_order = v.sort_order
ON CONFLICT (competency_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.complete_password_change()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO ''
AS $function$
UPDATE public.profiles
SET must_change_password = false, temp_password_expires_at = NULL
WHERE id = auth.uid();
$function$;

CREATE OR REPLACE FUNCTION public.mark_tour_seen()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO ''
AS $function$
UPDATE public.profiles
SET tour_seen_at = now()
WHERE id = auth.uid() AND tour_seen_at IS NULL;
$function$;

REVOKE EXECUTE ON FUNCTION public.mark_tour_seen() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_tour_seen() TO authenticated;

CREATE OR REPLACE FUNCTION private.can_view_talent_report(p_talent_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $function$
SELECT private.is_admin()
  OR private.manages_talent(p_talent_id)
  OR (
    EXISTS (
      SELECT 1 FROM public.talents t
      WHERE t.id = p_talent_id AND t.profile_id = auth.uid()
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.assignments a
      JOIN public.cycles c ON c.id = a.cycle_id
      WHERE a.talent_id = p_talent_id
        AND c.status = 'open'
        AND c.closes_at > now()
    )
  );
$function$;
