import { CheckCircle2 } from 'lucide-react';
import { BrandMark } from '@/components/BrandMark';
import { SignInPanel } from '@/features/auth/SignInPanel';
import { AdminSection, HowSection, ReportSection, WhySection } from '@/features/landing/LandingSections';

const NAV_LINKS = [
  { href: '#why', label: 'Why it matters' },
  { href: '#how', label: 'How it works' },
  { href: '#report', label: 'Your report' },
  { href: '#admins', label: 'For admins' },
];

const HIGHLIGHTS = [
  'Anonymous feedback from peers, direct reports and your manager',
  'One clear report across 19 leadership competencies',
  'A practical 30 to 360 day development plan',
];

export function LoginPage() {
  return (
    <div className="min-h-screen w-full">
      <header className="sticky top-0 z-20 border-b border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <BrandMark compact />
          <nav aria-label="Page sections" className="hidden md:block">
            <ul className="flex items-center gap-1">
              {NAV_LINKS.map((link) => (
                <li key={link.href}>
                  <a
                    href={link.href}
                    className="px-3 py-2 text-sm font-semibold text-ink-muted transition-colors duration-200 hover:text-primary"
                  >
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          <a href="#sign-in-heading" className="btn-accent px-4 py-2.5">
            Sign in
          </a>
        </div>
      </header>

      {/* Deep-blue hero band, like formideaph.com. Hard-coded white text: the band stays dark in both themes. */}
      <section className="relative overflow-hidden bg-brand-deep text-white">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_15%_20%,rgba(46,163,242,0.35),transparent_45%),radial-gradient(circle_at_85%_90%,rgba(216,48,36,0.25),transparent_40%)]"
        />
        <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-4 py-14 sm:px-6 sm:py-20 lg:grid-cols-2 lg:gap-16">
          <div className="space-y-6">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/80">
              Formidea business consultancy &amp; learning
            </p>
            <h1 className="text-4xl font-extrabold uppercase leading-[1.05] sm:text-5xl">
              See yourself the way others see you
            </h1>
            <p className="max-w-xl text-lg leading-relaxed text-white/85">
              Leadership Compass runs self and 360-degree leadership assessments and turns them into a report and a plan
              you can act on.
            </p>
            <ul className="space-y-3">
              {HIGHLIGHTS.map((item) => (
                <li key={item} className="flex items-start gap-3 text-base text-white/90">
                  <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-[#6cc2f8]" aria-hidden="true" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
          <div className="mx-auto w-full max-w-md text-ink lg:max-w-none">
            <SignInPanel />
          </div>
        </div>
        <div aria-hidden="true" className="relative flex h-1.5">
          <span className="flex-[3] bg-primary" />
          <span className="flex-1 bg-sky" />
          <span className="flex-1 bg-accent" />
        </div>
      </section>

      <main className="mx-auto max-w-6xl space-y-24 px-4 py-20 sm:px-6">
        <WhySection />
        <HowSection />
        <ReportSection />
        <AdminSection />
      </main>

      <footer className="bg-brand-deep text-white">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-10 text-sm sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <BrandMark compact inverted />
          <span className="max-w-md text-white/75">
            Responses are anonymous. Group averages appear only when enough people have responded.
          </span>
        </div>
      </footer>
    </div>
  );
}
