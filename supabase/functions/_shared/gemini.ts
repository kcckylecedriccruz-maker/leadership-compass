// Google Gemini (Interactions API, REST) for the AI features. The key lives only in the GEMINI_API_KEY secret.
// Free tier: no cost, rate-limited per project; Google may use free-tier content to improve its products.
import { AiError } from "./claude.ts";

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/interactions";
const API_REVISION = "2026-05-20";

/** Heavier work (summaries, insights) on Flash; quick checks (note coach, form help) on Flash-Lite. Both are free-tier. */
export function geminiModel(effort: "low" | "medium" | "high"): string {
  return effort === "low" ? "gemini-3.5-flash-lite" : "gemini-3.8-flash";
}

type Step = { type?: string; content?: { type?: string; text?: string }[] };
type Interaction = { status?: string; steps?: Step[]; output_text?: string; errors?: { message?: string }[] };

export async function askGemini<T>(options: {
  system: string;
  user: string;
  schema: Record<string, unknown>;
  effort: "low" | "medium" | "high";
  maxTokens: number;
}): Promise<T> {
  const key = Deno.env.get("GEMINI_API_KEY");
  if (!key) throw new AiError(503, "AI is not set up yet. An administrator needs to add the Gemini API key.");

  // Google's free tier is sometimes overloaded (503) or rate-limited (429). Try the chosen model twice, then the
  // other free model, with short waits, before giving up.
  const primary = geminiModel(options.effort);
  const secondary = primary === "gemini-3.8-flash" ? "gemini-3.5-flash-lite" : "gemini-3.8-flash";
  const attempts: { model: string; waitMs: number }[] = [
    { model: primary, waitMs: 0 },
    { model: primary, waitMs: 1500 },
    { model: secondary, waitMs: 2500 },
  ];

  let response: Response | null = null;
  let lastStatus = 0;
  for (const attempt of attempts) {
    if (attempt.waitMs) await new Promise((resolve) => setTimeout(resolve, attempt.waitMs));
    try {
      response = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key, "Api-Revision": API_REVISION },
        body: JSON.stringify({
          model: attempt.model,
          input: options.user,
          system_instruction: options.system,
          stream: false,
          response_format: { type: "text", mime_type: "application/json", schema: options.schema },
          generation_config: { max_output_tokens: options.maxTokens, thinking_level: options.effort },
        }),
      });
    } catch {
      response = null;
      lastStatus = 0;
      continue;
    }
    if (response.ok) break;
    lastStatus = response.status;
    if (response.status === 401 || response.status === 403) throw new AiError(503, "The Gemini API key is not valid.");
    const retryable = response.status === 429 || response.status >= 500;
    console.error(`Gemini error ${response.status} (${attempt.model}):`, (await response.text()).slice(0, 300));
    if (!retryable) throw new AiError(502, "The AI service could not answer this request. Try again shortly.");
  }

  if (!response || !response.ok) {
    if (lastStatus === 429) throw new AiError(429, "The AI is busy or today's free limit was reached. Please try again later.");
    throw new AiError(503, "Google's AI service is very busy right now. Please try again in a few minutes.");
  }

  const body = (await response.json()) as Interaction;
  if (body.status && body.status !== "completed") {
    console.error("Gemini interaction status:", body.status, body.errors?.[0]?.message ?? "");
    throw new AiError(502, body.status === "incomplete" ? "The AI answer was cut short. Try a narrower request." : "The AI could not finish this request.");
  }
  const text =
    body.output_text ??
    (body.steps ?? [])
      .filter((step) => step.type === "model_output")
      .flatMap((step) => step.content ?? [])
      .filter((part) => part.type === "text")
      .map((part) => part.text ?? "")
      .join("");
  if (!text.trim()) throw new AiError(502, "The AI returned an empty answer. Try again.");
  try {
    return JSON.parse(text) as T;
  } catch {
    console.error("Gemini returned text that is not JSON:", text.slice(0, 200));
    throw new AiError(502, "The AI answer could not be read. Try again.");
  }
}
