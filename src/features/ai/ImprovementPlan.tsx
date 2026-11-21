import { useCallback, useState } from 'react';
import { Loader2, Sparkles, TrendingUp } from 'lucide-react';
import { useAuth } from '@/auth/useAuth';
import { Notice } from '@/components/Notice';
import { generateImprovementPlan, releaseImprovementPlan, type ImprovementPlanContent } from '@/features/ai/aiApi';
import { formatDate } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import { useAsyncData } from '@/lib/useAsyncData';

type Language = 'en' | 'fil';
type PlanRow = { language: Language; content: ImprovementPlanContent; generated_at: string; released_at: string | null };

/**
 * "How to improve": AI interventions built from all feedback, written as themes only.
 * Admins and managers the report was shared with can create it; the employee sees it once an admin releases it.
 */
export function ImprovementPlan({ cycleId, talentId }: { cycleId: string; talentId: string }) {
  const { state: auth } = useAuth();
  const isAdmin = auth.status === 'signed_in' && auth.profile.role === 'admin';
  const userId = auth.status === 'signed_in' ? auth.profile.id : '';
  const load = useCallback(async () => {
    const [plans, shares] = await Promise.all([
      supabase.from('ai_improvement_plans').select('language, content, generated_at, released_at').eq('cycle_id', cycleId).eq('talent_id', talentId),
      supabase.from('report_shares').select('id').eq('cycle_id', cycleId).eq('talent_id', talentId).eq('shared_with', userId).limit(1),
    ]);
    return { plans: (plans.data ?? []) as PlanRow[], shared: (shares.data ?? []).length > 0 };
  }, [cycleId, talentId, userId]);
  const { state, reload } = useAsyncData(load);
  const [language, setLanguage] = useState<Language>('en');
  const [busy, setBusy] = useState<'generate' | 'release' | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (state.status === 'loading') return <p className="text-sm text-ink-muted">Loading...</p>;
  if (state.status === 'error') return <Notice>We could not load the improvement suggestions.</Notice>;

  const { plans, shared } = state.data;
  const canGenerate = isAdmin || shared;
  // Employees see only released plans; show whichever language exists if the chosen one does not.
  const plan = plans.find((p) => p.language === language) ?? (canGenerate ? undefined : plans[0]);
  const anyReleased = plans.some((p) => p.released_at);

  async function generate() {
    setBusy('generate');
    setError(null);
    const result = await generateImprovementPlan(cycleId, talentId, language);
    setBusy(null);
    if (!result.ok) return setError(result.message);
    reload();
  }

  async function release(value: boolean) {
    setBusy('release');
    setError(null);
    const result = await releaseImprovementPlan(cycleId, talentId, value);
    setBusy(null);
    if (!result.ok) return setError(result.message);
    reload();
  }

  return (
    <section className="space-y-5" aria-labelledby="improve-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 id="improve-heading" className="flex items-center gap-2 text-xl">
            <TrendingUp className="h-5 w-5 text-primary" aria-hidden="true" />
            How to improve
          </h2>
          <p className="max-w-2xl text-sm text-ink-muted">
            {canGenerate
              ? 'AI-suggested interventions based on all feedback, written as general themes so nothing can be traced to a rater. Check them before using.'
              : 'Suggestions to help you grow, based on your feedback.'}
          </p>
        </div>
        {canGenerate && (
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-lg bg-muted p-0.5 text-xs" role="group" aria-label="Language">
              {(
                [
                  ['en', 'English'],
                  ['fil', 'Filipino'],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={language === id}
                  onClick={() => setLanguage(id)}
                  className={`rounded-md px-2 py-1 font-semibold ${language === id ? 'bg-surface shadow-sm' : 'text-ink-muted'}`}
                >
                  {label}
                </button>
              ))}
            </div>
            <button type="button" className="btn-primary" onClick={() => void generate()} disabled={busy !== null}>
              {busy === 'generate' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Sparkles className="h-4 w-4" aria-hidden="true" />}
              {busy === 'generate' ? 'Writing… (up to a minute)' : plan ? 'Regenerate' : 'Suggest interventions'}
            </button>
          </div>
        )}
      </div>

      {isAdmin && plans.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface p-3 text-sm">
          <span>
            {anyReleased
              ? 'Released: the employee can see these suggestions in My report once their report is available.'
              : 'Not released: only administrators and managers this report is shared with can see these suggestions.'}
          </span>
          <button type="button" className="btn-secondary px-3 py-1.5 text-xs" onClick={() => void release(!anyReleased)} disabled={busy !== null}>
            {busy === 'release' && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
            {anyReleased ? 'Withdraw from employee' : 'Release to employee'}
          </button>
        </div>
      )}

      {error && <Notice>{error}</Notice>}

      {!plan && !busy && (
        <p className="rounded-card border border-dashed border-line p-6 text-center text-sm text-ink-muted">
          {canGenerate
            ? `No suggestions in ${language === 'fil' ? 'Filipino' : 'English'} yet.`
            : 'No improvement suggestions have been shared with you yet. Your HR team or manager will release them when ready.'}
        </p>
      )}

      {plan && (
        <article className="space-y-6 rounded-card border border-line bg-surface p-5 sm:p-6">
          <p className="text-xs font-semibold uppercase tracking-wide text-primary">
            AI-generated · {formatDate(plan.generated_at)}
            {plan.released_at ? ' · Released' : ''}
          </p>
          <p className="leading-relaxed">{plan.content.overview}</p>

          <div className="space-y-4">
            <h3 className="font-semibold">Focus areas</h3>
            {plan.content.focus_areas.map((area) => (
              <div key={area.competency} className="space-y-2 rounded-xl border border-line p-4">
                <p className="font-semibold">{area.competency}</p>
                <p className="text-sm text-ink-muted">{area.why}</p>
                <div className="grid gap-3 md:grid-cols-2">
                  <List title="Practise at work" items={area.on_the_job} />
                  <List title="Learn" items={area.learning} />
                </div>
                <p className="text-sm">
                  <span className="font-semibold">Talk with your manager about: </span>
                  {area.coaching_conversation}
                </p>
                <p className="text-sm">
                  <span className="font-semibold">How you’ll know it’s working: </span>
                  {area.measure}
                </p>
              </div>
            ))}
          </div>

          {plan.content.build_on_strengths.length > 0 && (
            <div className="space-y-2">
              <h3 className="font-semibold">Build on your strengths</h3>
              <ul className="space-y-1 text-sm">
                {plan.content.build_on_strengths.map((s) => (
                  <li key={s.strength}>
                    <span className="font-semibold">{s.strength}:</span> <span className="text-ink-muted">{s.how}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-3">
            {(
              [
                ['First 30 days', plan.content.plan_30_days],
                ['Days 31–60', plan.content.plan_60_days],
                ['Days 61–90', plan.content.plan_90_days],
              ] as const
            ).map(([title, items]) => (
              <div key={title} className="rounded-xl border border-line p-4">
                <List title={title} items={items} />
              </div>
            ))}
          </div>

          <List title="Questions to bring to your manager" items={plan.content.manager_questions} />
        </article>
      )}
    </section>
  );
}

function List({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="space-y-1">
      <p className="text-sm font-semibold">{title}</p>
      <ul className="list-disc space-y-1 pl-5 text-sm text-ink-muted">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}
