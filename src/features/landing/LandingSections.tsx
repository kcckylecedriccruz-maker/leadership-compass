import type { ReactNode } from 'react';
import { ClipboardCheck, Eye, Printer, Route, Target, TrendingUp, type LucideIcon } from 'lucide-react';

type Feature = { title: string; body: string; icon: LucideIcon };

const WHY_ITEMS: Feature[] = [
  {
    title: 'See your blind spots',
    body: 'Self-ratings only tell part of the story. Comparing them with how peers, direct reports and your manager see you shows where your impact differs from your intent.',
    icon: Eye,
  },
  {
    title: 'Focus on what moves the needle',
    body: 'Instead of a long list of traits, you get a short set of focus areas ranked by the gap between self and others.',
    icon: Target,
  },
  {
    title: 'Turn feedback into action',
    body: 'Every result links to practical steps and a dated plan, so feedback becomes behaviour you can see in your next quarter.',
    icon: TrendingUp,
  },
];

const HOW_STEPS: { title: string; body: string }[] = [
  {
    title: 'Administrator opens a cycle',
    body: 'Dates, reminders and the minimum group size are set once, so every response is handled the same way.',
  },
  {
    title: 'Assessors give feedback',
    body: 'Peers, direct reports, your manager and you rate each behaviour on the scale and add a short example where it helps.',
  },
  {
    title: 'Responses stay anonymous',
    body: 'Answers are combined before anyone sees them. Averages appear only when enough people have responded.',
  },
  {
    title: 'You receive your report',
    body: 'When the cycle closes, your results and recommendations appear on your home page.',
  },
];

const REPORT_ITEMS = [
  'Focus areas that show the biggest gaps between your self view and how others see you.',
  'Practical actions following the 70-20-10 approach: learning on the job, from others, and through formal study.',
  'A 30, 60, 90, 180 and 360 day plan you can track and revisit.',
];

const ADMIN_ITEMS = [
  'Create cycles, add talents with their immediate managers, and assign assessors for each view.',
  'Track who has submitted and who needs a reminder before the close date.',
  'Use the dashboard to see readiness and gaps across every talent in a cycle.',
  'Open any talent report to copy it or save it as a PDF.',
];

export function LandingSection({
  id,
  eyebrow,
  title,
  children,
}: {
  id: string;
  eyebrow: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className="space-y-10 scroll-mt-24">
      <div className="max-w-2xl space-y-3">
        <p className="eyebrow">{eyebrow}</p>
        <h2 id={`${id}-heading`} className="text-3xl sm:text-4xl">
          {title}
        </h2>
      </div>
      {children}
    </section>
  );
}

function FeatureCard({ feature }: { feature: Feature }) {
  const Icon = feature.icon;
  return (
    <div className="rounded-card border border-line bg-surface p-6 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
      <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-muted text-primary">
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <h3 className="mt-5 text-lg">{feature.title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-ink-muted">{feature.body}</p>
    </div>
  );
}

export function WhySection() {
  return (
    <LandingSection id="why" eyebrow="Why it matters" title="Why it matters for your growth">
      <div className="grid gap-5 md:grid-cols-3">
        {WHY_ITEMS.map((item) => (
          <FeatureCard key={item.title} feature={item} />
        ))}
      </div>
    </LandingSection>
  );
}

export function HowSection() {
  return (
    <LandingSection id="how" eyebrow="How it works" title="How it works">
      <ol className="grid gap-5 sm:grid-cols-2">
        {HOW_STEPS.map((step, index) => {
          return (
            <li key={step.title} className="flex gap-5 rounded-card border border-line bg-surface p-6 shadow-sm">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary text-base font-semibold text-on-primary">
                {index + 1}
              </span>
              <div className="space-y-2">
                <h3 className="text-lg">{step.title}</h3>
                <p className="text-sm leading-relaxed text-ink-muted">{step.body}</p>
              </div>
            </li>
          );
        })}
      </ol>
    </LandingSection>
  );
}

export function ReportSection() {
  return (
    <LandingSection id="report" eyebrow="Your report" title="Your report and recommendations">
      <div className="grid gap-8 lg:grid-cols-2 lg:items-center">
        <ul className="space-y-4">
          {REPORT_ITEMS.map((item) => (
            <li key={item} className="flex gap-3 text-base leading-relaxed">
              <Route className="mt-1 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
        <div className="rounded-card border border-line bg-surface p-6 shadow-sm sm:p-8">
          <Printer className="h-6 w-6 text-primary" aria-hidden="true" />
          <h3 className="mt-4 text-lg">Take it with you</h3>
          <p className="mt-2 text-base leading-relaxed text-ink-muted">
            Every report can be copied as text, or printed and saved as a PDF, so you can keep a record of your development.
          </p>
        </div>
      </div>
    </LandingSection>
  );
}

export function AdminSection() {
  return (
    <LandingSection id="admins" eyebrow="Administrators and managers" title="For admins and managers">
      <ul className="grid gap-4 md:grid-cols-2">
        {ADMIN_ITEMS.map((item) => (
          <li key={item} className="flex gap-3 rounded-card border border-line bg-surface p-5 text-sm leading-relaxed shadow-sm">
            <ClipboardCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </LandingSection>
  );
}
