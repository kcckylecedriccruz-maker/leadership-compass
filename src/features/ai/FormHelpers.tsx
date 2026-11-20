import { useState } from 'react';
import { Check, Copy, Lightbulb, Loader2, MessageCircleQuestion, Send, X } from 'lucide-react';
import type { FormAi, BehaviourResult, HelpLanguage, HelpMessage } from '@/features/ai/aiApi';
import { RATING_OPTIONS } from '@/features/assessments/assessmentModel';

const LANGUAGE_KEY = 'lc.helpLanguage';

function storedLanguage(): HelpLanguage {
  try {
    return localStorage.getItem(LANGUAGE_KEY) === 'fil' ? 'fil' : 'en';
  } catch {
    return 'en';
  }
}

function useLanguage(): [HelpLanguage, (value: HelpLanguage) => void] {
  const [language, setLanguage] = useState<HelpLanguage>(storedLanguage);
  return [
    language,
    (value) => {
      setLanguage(value);
      try {
        localStorage.setItem(LANGUAGE_KEY, value);
      } catch {
        // Remembering the choice is only a convenience.
      }
    },
  ];
}

function LanguageSwitch({ value, onChange }: { value: HelpLanguage; onChange: (v: HelpLanguage) => void }) {
  return (
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
          aria-pressed={value === id}
          onClick={() => onChange(id)}
          className={`rounded-md px-2 py-1 font-semibold ${value === id ? 'bg-surface shadow-sm' : 'text-ink-muted'}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

const QUICK_EN = ['Explain this simply', 'Give me an example', 'What do the ratings mean for this item?'];
const QUICK_FIL = ['Ipaliwanag nang simple', 'Magbigay ng halimbawa', 'Ano ang ibig sabihin ng bawat rating dito?'];
const MAX_QUESTIONS = 5;

/** "Help me understand": a short conversation about one item, plus a rating suggestion from the assessor's note. */
export function QuestionHelp({
  ai,
  competencyId,
  note,
  onUseRating,
}: {
  ai: FormAi;
  competencyId: string;
  note: string;
  onUseRating: (rating: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [language, setLanguage] = useLanguage();
  const [messages, setMessages] = useState<HelpMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState<'ask' | 'rating' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<{ rating: number | null; reason: string; answer: string } | null>(null);
  const asked = messages.filter((m) => m.role === 'assessor').length;

  async function ask(text: string) {
    const question = text.trim();
    if (!question || asked >= MAX_QUESTIONS) return;
    const next: HelpMessage[] = [...messages, { role: 'assessor', text: question }];
    setMessages(next);
    setDraft('');
    setBusy('ask');
    setError(null);
    const result = await ai.ask(competencyId, next, language);
    setBusy(null);
    if (!result.ok) {
      setError(result.message);
      setMessages(messages);
      return;
    }
    setMessages([...next, { role: 'assistant', text: result.data.answer }]);
  }

  async function suggestRating() {
    setBusy('rating');
    setError(null);
    setSuggestion(null);
    const result = await ai.suggestRating(competencyId, note, language);
    setBusy(null);
    if (!result.ok) return setError(result.message);
    setSuggestion({ rating: result.data.suggested_rating, reason: result.data.rating_reason, answer: result.data.answer });
  }

  if (!open) {
    return (
      <button type="button" className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary" onClick={() => setOpen(true)}>
        <MessageCircleQuestion className="h-4 w-4" aria-hidden="true" />
        Help me understand
      </button>
    );
  }

  const label = (value: number) => RATING_OPTIONS.find((o) => o.value === value)?.label ?? String(value);

  return (
    <div className="space-y-3 rounded-xl border border-primary/30 bg-primary/5 p-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 font-semibold text-primary">
          <MessageCircleQuestion className="h-4 w-4" aria-hidden="true" />
          Help me understand
        </p>
        <div className="flex items-center gap-2">
          <LanguageSwitch value={language} onChange={setLanguage} />
          <button type="button" className="rounded-lg p-1 text-ink-muted hover:bg-surface" onClick={() => setOpen(false)} aria-label="Close help">
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      {messages.length > 0 && (
        <ul className="space-y-2">
          {messages.map((m, i) => (
            <li
              key={i}
              className={`whitespace-pre-wrap rounded-lg p-2 leading-relaxed ${m.role === 'assessor' ? 'ml-8 bg-surface font-semibold' : 'mr-8 bg-surface/70'}`}
            >
              {m.text}
            </li>
          ))}
        </ul>
      )}

      {asked < MAX_QUESTIONS ? (
        <>
          <div className="flex flex-wrap gap-1.5">
            {(language === 'fil' ? QUICK_FIL : QUICK_EN).map((q) => (
              <button
                key={q}
                type="button"
                className="rounded-full border border-line bg-surface px-2.5 py-1 text-xs hover:border-primary"
                onClick={() => void ask(q)}
                disabled={busy !== null}
              >
                {q}
              </button>
            ))}
          </div>
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void ask(draft);
            }}
          >
            <input
              className="field-input min-w-0 flex-1"
              placeholder={language === 'fil' ? 'Ano ang hindi malinaw?' : 'What is unclear about this question?'}
              value={draft}
              maxLength={500}
              onChange={(e) => setDraft(e.target.value)}
            />
            <button type="submit" className="btn-secondary px-3" disabled={busy !== null || !draft.trim()} aria-label="Ask">
              {busy === 'ask' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
            </button>
          </form>
        </>
      ) : (
        <p className="text-xs text-ink-muted">That’s the limit of questions for this item.</p>
      )}

      <div className="space-y-2 border-t border-primary/20 pt-2">
        <button
          type="button"
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary disabled:opacity-50"
          onClick={() => void suggestRating()}
          disabled={busy !== null || note.trim().length < 10}
          title={note.trim().length < 10 ? 'Write your behaviour example first' : undefined}
        >
          {busy === 'rating' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Lightbulb className="h-4 w-4" aria-hidden="true" />}
          Suggest a rating from my note
        </button>
        {note.trim().length < 10 && <p className="text-xs text-ink-muted">Write your behaviour example first; the suggestion is based on it.</p>}
        {suggestion && (
          <div className="space-y-2 rounded-lg bg-surface p-2">
            {suggestion.rating ? (
              <>
                <p>
                  <span className="font-semibold">Suggested: {label(suggestion.rating)}</span>
                  {suggestion.reason && <span className="text-ink-muted"> · {suggestion.reason}</span>}
                </p>
                <button
                  type="button"
                  className="btn-secondary px-3 py-1.5 text-xs"
                  onClick={() => {
                    onUseRating(suggestion.rating!);
                    setSuggestion(null);
                  }}
                >
                  Use this rating
                </button>
              </>
            ) : (
              <p className="text-ink-muted">{suggestion.answer}</p>
            )}
            <p className="text-xs text-ink-muted">AI suggestion. The rating is your own judgement.</p>
          </div>
        )}
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  );
}

/** "Suggest behaviours": scenarios with observable behaviours and fill-in starters to copy. Never writes into the note. */
export function BehaviourSuggestions({ ai, competencyId, rating }: { ai: FormAi; competencyId: string; rating: number | null }) {
  const [open, setOpen] = useState(false);
  const [language, setLanguage] = useLanguage();
  const [keywords, setKeywords] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BehaviourResult | null>(null);
  const [scenario, setScenario] = useState(0);
  const [copied, setCopied] = useState<string | null>(null);

  async function load() {
    setBusy(true);
    setError(null);
    const response = await ai.behaviours(competencyId, rating, keywords.trim(), language);
    setBusy(false);
    if (!response.ok) return setError(response.message);
    setResult(response.data);
    setScenario(0);
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(text);
      window.setTimeout(() => setCopied(null), 1500);
    } catch {
      setCopied(null);
    }
  }

  if (!open) {
    return (
      <button type="button" className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary" onClick={() => setOpen(true)}>
        <Lightbulb className="h-4 w-4" aria-hidden="true" />
        Suggest behaviours
      </button>
    );
  }

  const current = result?.scenarios[scenario];

  return (
    <div className="space-y-3 rounded-xl border border-primary/30 bg-primary/5 p-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 font-semibold text-primary">
          <Lightbulb className="h-4 w-4" aria-hidden="true" />
          Observable behaviours
        </p>
        <div className="flex items-center gap-2">
          <LanguageSwitch value={language} onChange={setLanguage} />
          <button type="button" className="rounded-lg p-1 text-ink-muted hover:bg-surface" onClick={() => setOpen(false)} aria-label="Close suggestions">
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void load();
        }}
      >
        <input
          className="field-input min-w-0 flex-1"
          placeholder="Optional: situations you remember (e.g. client meeting, deadline)"
          value={keywords}
          maxLength={200}
          onChange={(e) => setKeywords(e.target.value)}
        />
        <button type="submit" className="btn-secondary px-3" disabled={busy}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
          {result ? 'Refresh' : 'Suggest'}
        </button>
      </form>
      {rating && <p className="text-xs text-ink-muted">Suggestions fit the rating you chose ({RATING_OPTIONS.find((o) => o.value === rating)?.label}).</p>}

      {result && result.scenarios.length > 0 && current && (
        <div className="space-y-3">
          <label className="block space-y-1">
            <span className="text-xs font-semibold">Scenario</span>
            <select className="field-input" value={scenario} onChange={(e) => setScenario(Number(e.target.value))}>
              {result.scenarios.map((s, i) => (
                <option key={s.scenario} value={i}>
                  {s.scenario}
                </option>
              ))}
            </select>
          </label>
          <div>
            <p className="text-xs font-semibold">What it can look like</p>
            <ul className="list-disc pl-5 text-ink-muted">
              {current.examples.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </div>
          <div className="space-y-1.5">
            <p className="text-xs font-semibold">Starters to complete with what you saw</p>
            {current.starters.map((starter) => (
              <div key={starter} className="flex items-start gap-2 rounded-lg bg-surface p-2">
                <p className="min-w-0 flex-1">{starter}</p>
                <button type="button" className="btn-secondary shrink-0 px-2 py-1 text-xs" onClick={() => void copy(starter)}>
                  {copied === starter ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
                  {copied === starter ? 'Copied' : 'Copy'}
                </button>
              </div>
            ))}
          </div>
          <p className="text-xs text-ink-muted">AI examples to jog your memory. Describe only what you actually saw.</p>
        </div>
      )}
      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  );
}
