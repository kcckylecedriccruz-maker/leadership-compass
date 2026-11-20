// Chooses the AI provider for the AI features.
// AI_PROVIDER = "gemini" (default) or "claude". Gemini runs on Google's free tier; Claude is paid per use.
import { AiError, askJson as askClaude, MODEL as CLAUDE_MODEL, S } from "./claude.ts";
import { askGemini, geminiModel } from "./gemini.ts";

export { AiError, S };

type Effort = "low" | "medium" | "high";

function provider(): "gemini" | "claude" {
  return (Deno.env.get("AI_PROVIDER") ?? "gemini").toLowerCase() === "claude" ? "claude" : "gemini";
}

/** The model that will answer a request of this effort (stored next to saved AI results). */
export function modelName(effort: Effort): string {
  return provider() === "claude" ? CLAUDE_MODEL : geminiModel(effort);
}

export function askJson<T>(options: {
  system: string;
  user: string;
  schema: Record<string, unknown>;
  effort?: Effort;
  maxTokens?: number;
}): Promise<T> {
  const effort = options.effort ?? "medium";
  const maxTokens = options.maxTokens ?? 16000;
  return provider() === "claude"
    ? askClaude<T>({ ...options, effort, maxTokens })
    : askGemini<T>({ ...options, effort, maxTokens });
}
