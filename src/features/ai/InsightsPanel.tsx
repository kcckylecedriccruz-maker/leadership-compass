import { useCallback, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowRight, ArrowUp, Loader2, Sparkles } from 'lucide-react';
import { Notice } from '@/components/Notice';
import { EvidenceList } from '@/features/ai/AiSummary';
import {
  askInsights,
  compareCycles,
  draftExplanations,
  generateCycleInsights,
  personTrend,
  saveExplanation,
  type AskResult,
  type CompareResult,
  type CompetencyHelp,
  type CycleInsights,
  type TrendResult,
} from '@/features/ai/aiApi';
import { loadNoteSummary } from '@/features/ai/planNotesApi';
import { formatDate } from '@/lib/format';
import type { CompetencyRecord } from '@/lib/records';
import { supabase } from '@/lib/supabase';
import { useAsyncData } from '@/lib/useAsyncData';

type Tab = 'cycle' | 'ask' | 'compare' | 'trend' | 'feedback' | 'help';

const TABS: { id: Tab; label: string }[] = [
  { id: 'cycle', label: 'Cycle insights' },
  { id: 'ask', label: 'Ask a question' },
  { id: 'compare', label: 'Compare cycles' },
  { id: 'trend', label: 'Person trend' },
  { id: 'feedback', label: 'Manager feedback' },
  { id: 'help', label: 'Form help' },
];

type Basics = {
  cycles: { id: string; name: string; status: string }[];
  people: { id: string; name: string }[];
  groups: string[];
  departments: string[];
};

async function loadBasics(): Promise<Basics> {
  const [cycles, talents, groups] = await Promise.all([
    supabase.from('cycles').select('id, name, status').order('opens_at', { ascending: false }),
    supabase.from('talents').select('id, department, profile:profiles!profile_id(full_name, deleted_at)'),
    supabase.from('user_groups').select('name').order('name'),
  ]);
  type T = { id: string; department: string | null; profile: { full_name: string; deleted_at: string | null } | null };
  const rows = (talents.data ?? []) as unknown as T[];
  return {
    cycles: (cycles.data ?? []) as Basics['cycles'],
    people: rows
      .filter((t) => t.profile && !t.profile.deleted_at)
      .map((t) => ({ id: t.id, name: t.profile!.full_name }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    groups: ((groups.data ?? []) as { name: string }[]).map((g) => g.name),
    departments: [...new Set(rows.map((t) => t.department).filter((d): d is string => Boolean(d)))].sort(),
  };
}

/** Administrators: AI insights across the organisation (names removed before sending). */
export function InsightsPanel() {
  const { state } = useAsyncData(loadBasics);
  const [tab, setTab] = useState<Tab>('cycle');

  return (
    <section className="space-y-6" aria-labelledby="insights-heading">
      <div className="space-y-1">
        <h2 id="insights-heading" className="flex items-center gap-2 text-2xl">
          <Sparkles className="h-6 w-6 text-primary" aria-hidden="true" />
          Insights
        </h2>
        <p className="text-sm leading-relaxed text-ink-muted">
          AI-generated (Google Gemini). Names are removed before anything is sent; people appear as codes and are named again here.
          AI can be wrong, so check important conclusions against the reports.
        </p>
      </div>
      <div role="tablist" aria-label="Insight tools" className="flex gap-1 overflow-x-auto rounded-2xl bg-muted p-1">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            onClick={() => setTab(item.id)}
            className={`shrink-0 whitespace-nowrap rounded-xl px-3 py-2 text-sm font-semibold ${tab === item.id ? 'bg-surface shadow-sm' : 'text-ink-muted hover:text-ink'}`}
          >
            {item.label}
          </button>
        ))}
      </div>
      {state.status === 'loading' && <p className="text-sm text-ink-muted">Loading...</p>}
      {state.status === 'error' && <Notice>We could not load cycles and people.</Notice>}
      {state.status === 'ready' && tab === 'cycle' && <CycleInsightsTool basics={state.data} />}
      {state.status === 'ready' && tab === 'ask' && <AskTool />}
      {state.status === 'ready' && tab === 'compare' && <CompareTool basics={state.data} />}
      {state.status === 'ready' && tab === 'trend' && <TrendTool basics={state.data} />}
      {state.status === 'ready' && tab === 'feedback' && <ManagerFeedbackSummary />}
      {state.status === 'ready' && tab === 'help' && <FormHelpTool />}
    </section>
  );
}

function Card({ children }: { children: ReactNode }) {
  return <article className="space-y-5 rounded-card border border-line bg-surface p-5 sm:p-6">{children}</article>;
}

function RunButton({ busy, label, onClick, disabled }: { busy: boolean; label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" className="btn-primary" onClick={onClick} disabled={busy || disabled}>
      {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Sparkles className="h-4 w-4" aria-hidden="true" />}
      {busy ? 'Working… (up to a minute)' : label}
    </button>
  );
}

function Bullets({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="space-y-2">
      <h3 className="font-semibold">{title}</h3>
      <ul className="list-disc space-y-1 pl-5 text-sm text-ink-muted">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

// ---- Cycle insights --------------------------------------------------------------------------

function CycleInsightsTool({ basics }: { basics: Basics }) {
  const [cycleId, setCycleId] = useState(basics.cycles[0]?.id ?? '');
  const load = useCallback(async () => {
    if (!cycleId) return null;
    const { data } = await supabase.from('ai_cycle_insights').select('content, generated_at').eq('cycle_id', cycleId).maybeSingle();
    return data as { content: CycleInsights; generated_at: string } | null;
  }, [cycleId]);
  const { state, reload } = useAsyncData(load);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const saved = state.status === 'ready' ? state.data : null;

  async function run() {
    setBusy(true);
    setError(null);
    const result = await generateCycleInsights(cycleId);
    setBusy(false);
    if (!result.ok) return setError(result.message);
    reload();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="block space-y-1.5">
          <span className="text-sm font-semibold">Cycle</span>
          <select className="field-input" value={cycleId} onChange={(e) => setCycleId(e.target.value)}>
            {basics.cycles.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <RunButton busy={busy} label={saved ? 'Regenerate' : 'Generate insights'} onClick={() => void run()} disabled={!cycleId} />
      </div>
      <p className="text-xs text-ink-muted">
        Organisation-wide strengths and needs, plus recurring themes consolidated from everyone’s written behaviour examples.
      </p>
      {error && <Notice>{error}</Notice>}
      {saved && (
        <Card>
          <p className="text-xs font-semibold uppercase tracking-wide text-primary">AI-generated · {formatDate(saved.generated_at)}</p>
          <p className="leading-relaxed">{saved.content.overview}</p>
          <div className="grid gap-6 md:grid-cols-2">
            <EvidenceList title="Organisation strengths" items={saved.content.strengths} />
            <EvidenceList title="Development needs" items={saved.content.needs} />
          </div>
          <div className="space-y-2">
            <h3 className="font-semibold">Themes from written feedback</h3>
            <ul className="space-y-3">
              {saved.content.note_themes.map((theme) => (
                <li key={theme.theme} className="rounded-xl border border-line p-3 text-sm">
                  <p className="font-semibold">
                    {theme.theme}{' '}
                    <span className={`text-xs font-normal ${theme.kind === 'strength' ? 'text-band-strength' : 'text-band-developing'}`}>
                      {theme.kind === 'strength' ? 'Strength' : 'Development'}
                    </span>
                  </p>
                  <p className="text-ink-muted">{theme.description}</p>
                  {theme.competencies.length > 0 && <p className="mt-1 text-xs text-ink-muted">{theme.competencies.join(' · ')}</p>}
                </li>
              ))}
            </ul>
          </div>
          <Bullets title="Training suggestions" items={saved.content.training_suggestions} />
          <p className="text-xs text-ink-muted">
            {saved.content.caveats}
            {saved.content.notes_used !== undefined && ` Based on ${saved.content.notes_used} of ${saved.content.answers_total} written answers.`}
          </p>
        </Card>
      )}
    </div>
  );
}

// ---- Ask a question ----------------------------------------------------------------------------

const EXAMPLES = [
  'Which competencies are lowest across the organisation?',
  'Who has the biggest gap between self-rating and others’ rating?',
  'How does the Sales Team compare with the rest on Coaching?',
];

function AskTool() {
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [answer, setAnswer] = useState<AskResult | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    setAnswer(null);
    const result = await askInsights(question.trim());
    setBusy(false);
    if (!result.ok) return setError(result.message);
    setAnswer(result.data);
  }

  return (
    <div className="space-y-4">
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          void run();
        }}
      >
        <textarea
          className="field-input min-h-[5rem]"
          placeholder="Ask about the scores, e.g. 'Which department improved most on Communication?'"
          value={question}
          maxLength={500}
          onChange={(e) => setQuestion(e.target.value)}
        />
        <div className="flex flex-wrap items-center gap-2">
          <RunButton busy={busy} label="Ask" onClick={() => void run()} disabled={question.trim().length < 5} />
          {EXAMPLES.map((example) => (
            <button key={example} type="button" className="rounded-full border border-line px-3 py-1 text-xs text-ink-muted hover:text-ink" onClick={() => setQuestion(example)}>
              {example}
            </button>
          ))}
        </div>
        <p className="text-xs text-ink-muted">Answers use scores only, not individual written comments.</p>
      </form>
      {error && <Notice>{error}</Notice>}
      {answer && (
        <Card>
          <p className="text-xs font-semibold uppercase tracking-wide text-primary">AI-generated answer</p>
          <p className="whitespace-pre-wrap leading-relaxed">{answer.answer}</p>
          {answer.key_figures.length > 0 && (
            <dl className="grid gap-2 sm:grid-cols-2">
              {answer.key_figures.map((f) => (
                <div key={f.label} className="rounded-xl border border-line p-3 text-sm">
                  <dt className="text-ink-muted">{f.label}</dt>
                  <dd className="font-semibold">{f.value}</dd>
                </div>
              ))}
            </dl>
          )}
          {answer.caveats && <p className="text-xs text-ink-muted">{answer.caveats}</p>}
        </Card>
      )}
    </div>
  );
}

// ---- Compare cycles ----------------------------------------------------------------------------

function CompareTool({ basics }: { basics: Basics }) {
  const [a, setA] = useState(basics.cycles[1]?.id ?? '');
  const [b, setB] = useState(basics.cycles[0]?.id ?? '');
  const [scope, setScope] = useState('organisation');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CompareResult | null>(null);
  const options = scope === 'group' ? basics.groups : scope === 'department' ? basics.departments : [];

  async function run() {
    setBusy(true);
    setError(null);
    setResult(null);
    const response = await compareCycles(a, b, scope, value);
    setBusy(false);
    if (!response.ok) return setError(response.message);
    setResult(response.data);
  }

  if (basics.cycles.length < 2) return <Notice tone="info">You need at least two cycles to compare.</Notice>;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <CycleSelect label="Before" cycles={basics.cycles} value={a} onChange={setA} />
        <CycleSelect label="After" cycles={basics.cycles} value={b} onChange={setB} />
        <label className="block space-y-1.5">
          <span className="text-sm font-semibold">For</span>
          <select
            className="field-input"
            value={scope}
            onChange={(e) => {
              setScope(e.target.value);
              setValue('');
            }}
          >
            <option value="organisation">Whole organisation</option>
            <option value="group">A group</option>
            <option value="department">A department</option>
            <option value="person">A person</option>
          </select>
        </label>
        {scope !== 'organisation' && (
          <label className="block space-y-1.5">
            <span className="text-sm font-semibold">Which</span>
            <select className="field-input" value={value} onChange={(e) => setValue(e.target.value)}>
              <option value="">Choose…</option>
              {scope === 'person'
                ? basics.people.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))
                : options.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
            </select>
          </label>
        )}
      </div>
      <RunButton busy={busy} label="Compare" onClick={() => void run()} disabled={!a || !b || (scope !== 'organisation' && !value)} />
      {error && <Notice>{error}</Notice>}
      {result && (
        <Card>
          <p className="text-xs font-semibold uppercase tracking-wide text-primary">AI-generated comparison</p>
          <p className="leading-relaxed">{result.overview}</p>
          <div className="grid gap-6 md:grid-cols-2">
            <ChangeList title="Improved" icon="up" items={result.improved} />
            <ChangeList title="Declined" icon="down" items={result.declined} />
          </div>
          <p className="text-sm text-ink-muted">{result.unchanged}</p>
          <Bullets title="Recommendations" items={result.recommendations} />
        </Card>
      )}
    </div>
  );
}

function CycleSelect({ label, cycles, value, onChange }: { label: string; cycles: Basics['cycles']; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-semibold">{label}</span>
      <select className="field-input" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Choose…</option>
        {cycles.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function ChangeList({ title, icon, items }: { title: string; icon: 'up' | 'down'; items: { competency: string; change: string; note: string }[] }) {
  const Icon = icon === 'up' ? ArrowUp : ArrowDown;
  return (
    <div className="space-y-2">
      <h3 className="font-semibold">{title}</h3>
      {items.length === 0 ? (
        <p className="text-sm text-ink-muted">None worth noting.</p>
      ) : (
        <ul className="space-y-2 text-sm">
          {items.map((item) => (
            <li key={item.competency} className="flex gap-2">
              <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${icon === 'up' ? 'text-band-strength' : 'text-danger'}`} aria-hidden="true" />
              <span>
                <span className="font-semibold">
                  {item.competency} ({item.change})
                </span>{' '}
                <span className="text-ink-muted">{item.note}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---- Person trend --------------------------------------------------------------------------------

function TrendTool({ basics }: { basics: Basics }) {
  const [talentId, setTalentId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TrendResult | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    setResult(null);
    const response = await personTrend(talentId);
    setBusy(false);
    if (!response.ok) return setError(response.message);
    setResult(response.data);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="block min-w-[16rem] space-y-1.5">
          <span className="text-sm font-semibold">Person</span>
          <select className="field-input" value={talentId} onChange={(e) => setTalentId(e.target.value)}>
            <option value="">Choose…</option>
            {basics.people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <RunButton busy={busy} label="Show trend" onClick={() => void run()} disabled={!talentId} />
      </div>
      <p className="text-xs text-ink-muted">Needs feedback in at least two cycles.</p>
      {error && <Notice>{error}</Notice>}
      {result && (
        <Card>
          <p className="text-xs font-semibold uppercase tracking-wide text-primary">AI-generated trend</p>
          <p className="leading-relaxed">{result.overview}</p>
          <ul className="space-y-2 text-sm">
            {result.trends.map((t) => {
              const Icon = t.direction === 'up' ? ArrowUp : t.direction === 'down' ? ArrowDown : ArrowRight;
              return (
                <li key={t.competency} className="flex gap-2">
                  <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                  <span>
                    <span className="font-semibold">{t.competency}:</span> <span className="text-ink-muted">{t.detail}</span>
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="text-sm">
            <span className="font-semibold">Self-view vs others: </span>
            <span className="text-ink-muted">{result.self_vs_others}</span>
          </p>
          <Bullets title="Focus for next cycle" items={result.focus_next} />
        </Card>
      )}
    </div>
  );
}

// ---- Form help (plain-English explanations) ----------------------------------------------------

async function loadCompetencies(): Promise<CompetencyRecord[]> {
  const { data, error } = await supabase.from('competencies').select('id, category, name, definition, sort_order, help').order('sort_order');
  if (error) throw error;
  return (data ?? []) as CompetencyRecord[];
}

const DRAFT_BATCH = 3;

function FormHelpTool() {
  const { state, reload } = useAsyncData(loadCompetencies);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'error' | 'info'; text: string } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);

  // One request per item, a few at a time: a single request for all 19 runs past the server's time limit.
  async function draftAll() {
    const ids = items.map((c) => c.id);
    if (ids.length === 0) return;
    setBusy(true);
    setMessage(null);
    let done = 0;
    let lastError = '';
    const failed: string[] = [];
    const draftOne = async (id: string) => {
      let result = await draftExplanations(id);
      if (!result.ok) result = await draftExplanations(id);
      if (result.ok) done += 1;
      else {
        failed.push(id);
        lastError = result.message;
      }
      setProgress(`Drafting… ${done} of ${ids.length} done`);
    };
    setProgress(`Drafting… 0 of ${ids.length} done`);
    for (let i = 0; i < ids.length; i += DRAFT_BATCH) {
      await Promise.all(ids.slice(i, i + DRAFT_BATCH).map(draftOne));
      reload();
    }
    setBusy(false);
    setProgress(null);
    if (failed.length === 0) {
      setMessage({ tone: 'info', text: `Drafted help for ${done} competencies. Review and edit them below.` });
    } else {
      setMessage({
        tone: 'error',
        text: `Drafted ${done} of ${ids.length}. ${failed.length} could not be drafted (${lastError}) — press the button again or use Edit on those items.`,
      });
    }
  }

  const items = state.status === 'ready' ? state.data : [];
  const withHelp = items.filter((c) => c.help).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-ink-muted">
          The “What does this mean?” panel under each item in the feedback form. The AI drafts it in plain English; you review
          and edit. {state.status === 'ready' && `${withHelp} of ${items.length} items have help.`}
        </p>
        <RunButton busy={busy} label={withHelp > 0 ? 'Redraft all with AI' : 'Draft all with AI'} onClick={() => void draftAll()} />
      </div>
      {withHelp > 0 && !busy && (
        <p className="text-xs text-ink-muted">Redrafting replaces your edits for every item. To redo one item, edit it instead.</p>
      )}
      {progress && <p className="text-sm font-semibold text-ink-muted">{progress}</p>}
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      <ul className="space-y-3">
        {items.map((c) => (
          <li key={c.id} className="rounded-card border border-line bg-surface p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="font-semibold">
                  {c.sort_order}. {c.name}
                </p>
                <p className="text-xs text-ink-muted">{c.help ? c.help.plain : 'No help yet.'}</p>
              </div>
              <button type="button" className="btn-secondary px-3 py-1.5 text-xs" onClick={() => setEditing(editing === c.id ? null : c.id)}>
                {editing === c.id ? 'Close' : 'Edit'}
              </button>
            </div>
            {editing === c.id && (
              <HelpEditor
                competency={c}
                onSaved={() => {
                  setEditing(null);
                  reload();
                }}
              />
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function HelpEditor({ competency, onSaved }: { competency: CompetencyRecord; onSaved: () => void }) {
  const help = competency.help;
  const [plain, setPlain] = useState(help?.plain ?? '');
  const [looks, setLooks] = useState((help?.looks_like ?? []).join('\n'));
  const [not, setNot] = useState((help?.not_like ?? []).join('\n'));
  const [think, setThink] = useState(help?.think_about ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lines = (text: string) => text.split('\n').map((l) => l.trim()).filter(Boolean);

  async function save() {
    setBusy(true);
    setError(null);
    const value: CompetencyHelp = { plain: plain.trim(), looks_like: lines(looks), not_like: lines(not), think_about: think.trim() };
    const result = await saveExplanation(competency.id, value);
    setBusy(false);
    if (!result.ok) return setError(result.message);
    onSaved();
  }

  return (
    <div className="mt-3 space-y-3 border-t border-line pt-3">
      <label className="block space-y-1">
        <span className="text-sm font-semibold">In plain words</span>
        <textarea className="field-input min-h-[4rem]" value={plain} maxLength={600} onChange={(e) => setPlain(e.target.value)} />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block space-y-1">
          <span className="text-sm font-semibold">Looks like (one per line)</span>
          <textarea className="field-input min-h-[6rem]" value={looks} onChange={(e) => setLooks(e.target.value)} />
        </label>
        <label className="block space-y-1">
          <span className="text-sm font-semibold">Doesn’t look like (one per line)</span>
          <textarea className="field-input min-h-[6rem]" value={not} onChange={(e) => setNot(e.target.value)} />
        </label>
      </div>
      <label className="block space-y-1">
        <span className="text-sm font-semibold">Think about</span>
        <input className="field-input" value={think} maxLength={300} onChange={(e) => setThink(e.target.value)} />
      </label>
      <p className="text-xs text-ink-muted">Leave everything empty to remove the help for this item.</p>
      {error && <Notice>{error}</Notice>}
      <div className="flex justify-end">
        <button type="button" className="btn-primary" onClick={() => void save()} disabled={busy}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
          Save
        </button>
      </div>
    </div>
  );
}

// ---- Manager feedback on improvement plans -------------------------------------------------------

function ManagerFeedbackSummary() {
  const { state } = useAsyncData(loadNoteSummary);
  if (state.status === 'loading') return <p className="text-sm text-ink-muted">Loading...</p>;
  if (state.status === 'error') return <Notice>We could not load manager feedback.</Notice>;
  const rows = state.data;
  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-muted">
        How managers rated the AI improvement suggestions (How to improve tab on reports), per focus area. Many “Adjust” or
        “Disagree” verdicts show where the suggestions need human judgement.
      </p>
      {rows.length === 0 ? (
        <p className="rounded-card border border-dashed border-line p-6 text-center text-sm text-ink-muted">No manager feedback yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-card border border-line bg-surface">
          <table className="w-full min-w-[520px] text-left text-sm">
            <thead className="bg-muted text-xs uppercase tracking-wide text-ink-muted">
              <tr>
                <th className="px-4 py-3 font-semibold">Focus area</th>
                <th className="px-3 py-3 text-right font-semibold">Agree</th>
                <th className="px-3 py-3 text-right font-semibold">Adjust</th>
                <th className="px-3 py-3 text-right font-semibold">Disagree</th>
                <th className="px-3 py-3 text-right font-semibold">Written notes</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.scope} className="border-t border-line">
                  <td className="px-4 py-3 font-semibold">{r.scope === 'overall' ? 'Whole plan (overall notes)' : r.scope}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{r.agree}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{r.adjust}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{r.disagree}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{r.notes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
