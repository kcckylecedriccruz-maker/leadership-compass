import { BrandMark, APP_NAME } from '@/components/BrandMark';

// Public privacy notice (no sign-in). Google's consent screen links here from
// Google Auth Platform > Branding > Application privacy policy link.
const SECTIONS: { title: string; body: string[] }[] = [
  {
    title: 'What we collect',
    body: [
      'Your name, work email address and role in the assessment (talent, assessor, immediate manager or administrator).',
      'Assessment ratings (1 to 5) and the behaviour notes written for each competency.',
      'Notification preferences and a log of the emails sent to you (type, time and whether it was sent or skipped).',
    ],
  },
  {
    title: 'Why we use it',
    body: [
      'To run leadership self and 360 assessments, send invitations and reminders, and produce development reports and recommendations.',
    ],
  },
  {
    title: 'Who can see what',
    body: [
      'Peer and Direct report ratings are anonymous and shown only as group results. Immediate manager and Self ratings are not anonymous.',
      'Results are visible only to the talent, their immediate manager(s) and administrators.',
      'Emails never contain ratings, notes or assessor names.',
    ],
  },
  {
    title: 'AI features',
    body: [
      'Some features use Claude, an AI service by Anthropic: feedback summaries and insights for administrators, team insights for managers, help text for the form, and the optional Improve with AI button for behaviour notes.',
      'Before anything is sent, the names of people in the system are removed from written feedback, and people in score data are replaced by codes. Ratings and anonymised feedback text are sent only when someone uses one of these features.',
      'Everything AI-generated is labelled as such and should be checked by a person before it is relied on.',
    ],
  },
  {
    title: 'Email',
    body: [
      `${APP_NAME} sends notification emails from its own Gmail account through the Gmail API. The app is granted permission to send email only. It cannot read, change or delete anything in any mailbox.`,
      'You can turn optional emails off in Notification settings or with the unsubscribe link in each email. Account and security emails are always sent.',
    ],
  },
  {
    title: 'Storage and retention',
    body: [
      'Data is stored in a secured Supabase database with access rules for each role. The Gmail permission is stored encrypted and never shown to anyone.',
      'Data is kept for as long as your organisation runs the assessment programme and is deleted on request or under your organisation’s retention policy.',
    ],
  },
  {
    title: 'Questions and requests',
    body: [
      'To ask about your data, correct it or request deletion, contact your HR or Learning & Development team, who administer this app.',
    ],
  },
];

export function PrivacyPage() {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-12">
      <a href="/" className="inline-block">
        <BrandMark />
      </a>
      <h1 className="mt-8 text-2xl">Privacy notice</h1>
      <p className="mt-2 text-sm text-ink-muted">How {APP_NAME} handles your information.</p>
      <div className="mt-8 space-y-8">
        {SECTIONS.map((section) => (
          <section key={section.title} className="space-y-2">
            <h2 className="text-lg font-semibold">{section.title}</h2>
            {section.body.map((paragraph) => (
              <p key={paragraph} className="text-sm leading-relaxed text-ink-muted">
                {paragraph}
              </p>
            ))}
          </section>
        ))}
      </div>
    </main>
  );
}
