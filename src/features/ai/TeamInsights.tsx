import { useState } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import { Notice } from '@/components/Notice';
import { teamInsights, type TeamResult } from '@/features/ai/aiApi';

/** Managers: AI coaching insights from the reports an administrator shared with them (scores only). */
export function TeamInsights() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TeamResult | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    setResult(null);
    const response = await teamInsights();
    setBusy(false);
    if (!response.ok) return setError(response.message);
    setResult(response.data);
  }

  return (
    <section className="space-y-4" aria-labelledby="team-ai-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 id="team-ai-heading" className="flex items-center gap-2 text-xl">
            <Sparkles className="h-5 w-5 text-primary" aria-hidden="true" />
            Team insights
          </h2>
          <p className="max-w-2xl text-sm text-ink-muted">
            AI coaching notes based only on the reports shared with you. Names are removed before sending. Use it to prepare
            conversations, not as a verdict.
          </p>
        </div>
        <button type="button" className="btn-secondary" onClick={() => void run()} disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Sparkles className="h-4 w-4" aria-hidden="true" />}
          {busy ? 'Working…' : 'Generate team insights'}
        </button>
      </div>
      {error && <Notice tone="info">{error}</Notice>}
      {result && (
        <article className="space-y-4 rounded-card border border-line bg-surface p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-primary">AI-generated</p>
          <p className="leading-relaxed">{result.overview}</p>
          <div className="grid gap-4 md:grid-cols-2">
            <List title="Team strengths" items={result.strengths} />
            <List title="Team development needs" items={result.needs} />
          </div>
          {result.per_person.length > 0 && (
            <div className="space-y-2">
              <h3 className="font-semibold">Per person</h3>
              <ul className="space-y-2 text-sm">
                {result.per_person.map((p) => (
                  <li key={p.person} className="rounded-xl border border-line p-3">
                    <p className="font-semibold">{p.person}</p>
                    <p className="text-ink-muted">{p.highlight}</p>
                    <p>
                      <span className="font-semibold">Try: </span>
                      {p.suggestion}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <List title="Coaching tips" items={result.coaching_tips} />
        </article>
      )}
    </section>
  );
}

function List({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="space-y-1">
      <h3 className="font-semibold">{title}</h3>
      <ul className="list-disc space-y-1 pl-5 text-sm text-ink-muted">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}
