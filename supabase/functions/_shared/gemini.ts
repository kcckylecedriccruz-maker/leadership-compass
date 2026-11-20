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

  let response: Response;
  try {
    response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key, "Api-Revision": API_REVISION },
      body: JSON.stringify({
        model: geminiModel(options.effort),
        input: options.user,
        system_instruction: options.system,
        stream: false,
        response_format: { type: "text", mime_type: "application/json", schema: options.schema },
        generation_config: { max_output_tokens: options.maxTokens, thinking_level: options.effort },
      }),
    });
  } catch {
    throw new AiError(502, "Could not reach the AI service. Try again shortly.");
  }

  if (response.status === 429) {
    throw new AiError(429, "The AI is busy or today's free limit was reached. Please try again later.");
  }
  if (response.status === 401 || response.status === 403) throw new AiError(503, "The Gemini API key is not valid.");
  if (!response.ok) {
    console.error(`Gemini error ${response.status}:`, (await response.text()).slice(0, 300));
    throw new AiError(502, "The AI service could not answer right now. Try again shortly.");
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
