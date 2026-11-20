// Claude for the AI features. The API key lives only in the ANTHROPIC_API_KEY function secret.
import Anthropic from "npm:@anthropic-ai/sdk@1.6.0";

export const MODEL = "claude-opus-5-5";

export class AiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!Deno.env.get("ANTHROPIC_API_KEY")) {
    throw new AiError(503, "AI is not set up yet. An administrator needs to add the Anthropic API key.");
  }
  client ??= new Anthropic();
  return client;
}

type JsonSchema = Record<string, unknown>;

/**
 * One Claude request that must answer with JSON matching `schema` (structured outputs). Refusals and cut-off answers
 * become friendly errors. Server-side fallback is on, so a policy decline is retried on another model in the same call.
 */
export async function askJson<T>(options: {
  system: string;
  user: string;
  schema: JsonSchema;
  effort?: "low" | "medium" | "high";
  maxTokens?: number;
}): Promise<T> {
  const anthropic = getClient();
  let response;
  try {
    // The fallbacks parameter is newer than the SDK typings, so the request is built as a plain object.
    const params: Record<string, unknown> = {
      model: MODEL,
      max_tokens: options.maxTokens ?? 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: options.system,
      messages: [{ role: "user", content: options.user }],
      output_config: {
        effort: options.effort ?? "medium",
        format: { type: "json_schema", schema: options.schema },
      },
    };
    response = await anthropic.beta.messages.create(params as unknown as Anthropic.Beta.Messages.MessageCreateParamsNonStreaming);
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) throw new AiError(503, "The Anthropic API key is not valid.");
    if (error instanceof Anthropic.RateLimitError) throw new AiError(429, "The AI service is busy. Try again in a minute.");
    if (error instanceof Anthropic.APIError) {
      console.error(`Claude API error ${error.status}:`, error.message);
      throw new AiError(502, "The AI service could not answer right now. Try again shortly.");
    }
    throw error;
  }

  if (response.stop_reason === "refusal") throw new AiError(422, "The AI declined this request.");
  if (response.stop_reason === "max_tokens") throw new AiError(502, "The AI answer was too long. Try a narrower request.");
  const text = response.content
    .filter((block: { type: string }) => block.type === "text")
    .map((block: { type: string; text?: string }) => block.text ?? "")
    .join("");
  try {
    return JSON.parse(text) as T;
  } catch {
    console.error("Claude returned text that is not JSON:", text.slice(0, 200));
    throw new AiError(502, "The AI answer could not be read. Try again.");
  }
}

/** JSON-schema helpers for structured outputs (every object closed, every field required). */
export const S = {
  str: { type: "string" } as JsonSchema,
  strs: { type: "array", items: { type: "string" } } as JsonSchema,
  obj(properties: Record<string, JsonSchema>): JsonSchema {
    return { type: "object", properties, required: Object.keys(properties), additionalProperties: false };
  },
  arr(items: JsonSchema): JsonSchema {
    return { type: "array", items };
  },
  oneOf(values: string[]): JsonSchema {
    return { type: "string", enum: values };
  },
};
