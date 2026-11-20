import { useCallback, useState } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import { Notice } from '@/components/Notice';
import { generatePersonSummary, type PersonSummary } from '@/features/ai/aiApi';
import { formatDate } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import { useAsyncData } from '@/lib/useAsyncData';

/** Administrators: AI feedback summary and development plan for one person in one cycle. */
export function AiSummary({ cycleId, talentId }: { cycleId: string; talentId: string }) {
  const load = useCallback(async () => {
    const { data } = await supabase
      .from('ai_person_summaries')
      .select('content, generated_at')
      .eq('cycle_id', cycleId)
      .eq('talent_id', talentId)
      .maybeSingle();
    return data as { content: PersonSummary; generated_at: string } | null;
  }, [cycleId, talentId]);
  const { state, reload } = useAsyncData(load);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setBusy(true);
    setError(null);
    const result = await generatePersonSummary(cycleId, talentId);
    setBusy(false);
    if (!result.ok) return setError(result.message);
    reload();
  }

  const saved = state.status === 'ready' ? state.data : null;

  return (
    <section className="space-y-5" aria-labelledby="ai-summary-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 id="ai-summary-heading" className="flex items-center gap-2 text-xl">
            <Sparkles className="h-5 w-5 text-primary" aria-hidden="true" />
            AI feedback summary
          </h2>
          <p className="max-w-2xl text-sm text-ink-muted">
            The AI reads this person’s scores and written feedback (names removed) and drafts themes and a 30/60/90-day plan.
            Visible to administrators only. Check it against the report before using it.
          </p>
        </div>
        <button type="button" className="btn-primary" onClick={() => void generate()} disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Sparkles className="h-4 w-4" aria-hidden="true" />}
          {busy ? 'Writing… (up to a minute)' : saved ? 'Regenerate' : 'Generate summary'}
        </button>
      </div>

      {error && <Notice>{error}</Notice>}
      {state.status === 'loading' && <p className="text-sm text-ink-muted">Loading...</p>}
      {state.status === 'ready' && !saved && !busy && (
        <p className="rounded-card border border-dashed border-line p-6 text-center text-sm text-ink-muted">No summary yet.</p>
      )}

      {saved && (
        <article className="space-y-6 rounded-card border border-line bg-surface p-5 sm:p-6">
          <p className="text-xs font-semibold uppercase tracking-wide text-primary">
            AI-generated · {formatDate(saved.generated_at)}
          </p>
          <p className="leading-relaxed">{saved.content.overview}</p>
          <div className="grid gap-6 md:grid-cols-2">
            <EvidenceList title="Strengths" items={saved.content.strengths} />
            <EvidenceList title="Development areas" items={saved.content.development_areas} />
          </div>
          {saved.content.blind_spots.length > 0 && (
            <div className="space-y-2">
              <h3 className="font-semibold">Blind spots and hidden strengths</h3>
              <ul className="space-y-2 text-sm">
                {saved.content.blind_spots.map((item) => (
                  <li key={item.competency}>
                    <span className="font-semibold">{item.competency}:</span> <span className="text-ink-muted">{item.explanation}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="grid gap-4 md:grid-cols-3">
            {(
              [
                ['First 30 days', saved.content.plan_30_days],
                ['Days 31–60', saved.content.plan_60_days],
                ['Days 61–90', saved.content.plan_90_days],
              ] as const
            ).map(([title, items]) => (
              <div key={title} className="rounded-xl border border-line p-4">
                <h3 className="mb-2 text-sm font-semibold">{title}</h3>
                <ul className="list-disc space-y-1 pl-5 text-sm text-ink-muted">
                  {items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </article>
      )}
    </section>
  );
}

export function EvidenceList({ title, items }: { title: string; items: { competency: string; evidence: string }[] }) {
  return (
    <div className="space-y-2">
      <h3 className="font-semibold">{title}</h3>
      <ul className="space-y-2 text-sm">
        {items.map((item) => (
          <li key={item.competency}>
            <span className="font-semibold">{item.competency}:</span> <span className="text-ink-muted">{item.evidence}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
