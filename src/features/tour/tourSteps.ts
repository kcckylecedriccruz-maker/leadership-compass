import type { Role } from '@/lib/types';

export type TourStep = { title: string; body: string };

const MEMBER_STEPS: TourStep[] = [
  {
    title: 'Welcome',
    body: 'Welcome to Leadership Compass. This short tour shows you where everything is. You can replay it at any time from the header.',
  },
  {
    title: 'Why it matters',
    body: 'Feedback from the people around you shows how your leadership is experienced. Honest answers turn into a clear, practical growth plan.',
  },
  {
    title: 'Give feedback',
    body: 'Open each assessment assigned to you and rate the behaviours on the scale. Add a short, specific example wherever you can.',
  },
  {
    title: 'Save, Review, Submit',
    body: 'Your answers save as you go. When you are ready, review them and submit. After submitting, use the Edit link in your confirmation email to make changes until the cycle closes.',
  },
  {
    title: 'Anonymity',
    body: 'Responses are combined before anyone sees them. Averages appear only when enough people have responded, and comments are shared without names.',
  },
  {
    title: 'Your results',
    body: 'When the cycle closes, your results appear on your home page, with your own view, how others see you, and where to focus.',
  },
  {
    title: 'Report and recommendations',
    body: 'Your report sets out focus areas, practical actions using the 70-20-10 approach, and a plan for 30, 60, 90, 180 and 360 days.',
  },
];

const ADMIN_STEPS: TourStep[] = [
  {
    title: 'Welcome',
    body: 'Welcome, administrator. This tour shows how to run an assessment from start to finish.',
  },
  {
    title: 'Set up a cycle',
    body: 'Create a cycle with its open and close dates. Choose the minimum group size needed before peer averages are shown.',
  },
  {
    title: 'Add talents and assign assessors',
    body: 'Add each talent with their immediate manager, then assign assessors for peer, direct report and self views.',
  },
  {
    title: 'Invites and activation',
    body: 'Invitations go out automatically with a create-your-account link. People who have not activated yet show as Invited, and you can resend their invite from the same list. If someone is locked out, send them a temporary password from the Talents list.',
  },
  {
    title: 'Track completion',
    body: 'The Assignments tab shows who has submitted and who still needs a reminder, so you can follow up before the close date.',
  },
  {
    title: 'Dashboard',
    body: 'The Dashboard lists each talent in a cycle with readiness status and gaps, ranked to show who needs the most support.',
  },
  {
    title: 'Open a talent report',
    body: 'Open a talent report for scores, behaviour notes and recommendations. You can copy it or save it as a PDF.',
  },
];

export function tourStepsFor(role: Role): TourStep[] {
  return role === 'admin' ? ADMIN_STEPS : MEMBER_STEPS;
}
