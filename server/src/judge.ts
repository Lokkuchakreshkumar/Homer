/**
 * The seam between policy and model.
 *
 * Everything above this file (`ads.ts`, `search.ts`) works on plain probability maps and
 * never sees an SDK type. That is what makes the policy testable with no key and no
 * network, and it keeps a model swap from reaching the code that decides what to delete.
 */

import { TypeSafeClient } from "@typesafe-ai/sdk";
import type { EntryType, Questions } from "@typesafe-ai/sdk";

export interface JudgeResult {
  /** Raw answers keyed by question id. Shape depends on the question type. */
  readonly answers: Readonly<Record<string, unknown>>;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly model: string;
}

export interface Judge {
  readonly mode: "jev" | "stub";
  readonly model: string;
  ask(state: unknown, questions: Questions): Promise<JudgeResult>;
}

/**
 * Convert a value to the JSON shape the API accepts.
 *
 * `EntryType` describes JSON rather than our TypeScript types: interfaces with `readonly`
 * properties and no index signature are not structurally assignable to it even though
 * they serialise to it exactly. Round-tripping through JSON is less a workaround than a
 * statement of what state is, and it guarantees no function or `undefined` rides along.
 */
export function asState(value: unknown): EntryType {
  return JSON.parse(JSON.stringify(value)) as EntryType;
}

/**
 * Pull `noul` probabilities out of an answers map.
 *
 * The SDK types answers precisely from the questions passed in, but this layer has to
 * cross a dynamic boundary, so it validates rather than asserts. A malformed answer
 * becomes 0, which the policy reads as "not an ad" / "not relevant" — the safe direction.
 */
export function readNouls(answers: Readonly<Record<string, unknown>>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(answers)) {
    if (typeof value !== "object" || value === null) continue;
    const typed = value as { type?: unknown; noul?: unknown };
    if (typed.type !== "noul") continue;
    const probability = typed.noul;
    if (typeof probability === "number" && Number.isFinite(probability)) {
      out[key] = Math.min(1, Math.max(0, probability));
    }
  }
  return out;
}

/** Pull `choice` probability maps out of an answers map, keyed by question id. */
export function readChoices(
  answers: Readonly<Record<string, unknown>>,
): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const [key, value] of Object.entries(answers)) {
    if (typeof value !== "object" || value === null) continue;
    const typed = value as { type?: unknown; probabilities?: unknown };
    if (typed.type !== "choice") continue;
    if (typeof typed.probabilities !== "object" || typed.probabilities === null) continue;
    const distribution: Record<string, number> = {};
    for (const [label, probability] of Object.entries(
      typed.probabilities as Record<string, unknown>,
    )) {
      if (typeof probability === "number" && Number.isFinite(probability)) {
        distribution[label] = Math.min(1, Math.max(0, probability));
      }
    }
    out[key] = distribution;
  }
  return out;
}

/**
 * The real judge.
 *
 * The SDK owns retry and backoff, including honouring `Retry-After` on 429/529, so this
 * class deliberately does not reimplement any of it. The timeout is per attempt.
 */
export class TypeSafeJudge implements Judge {
  readonly mode = "jev" as const;
  readonly model: string;
  readonly #client: TypeSafeClient;

  constructor(apiKey: string) {
    // No `dangerouslyAllowBrowser`: this runs in the proxy, which is the whole point.
    this.#client = new TypeSafeClient({ apiKey, timeout: 20_000 });
    this.model = this.#client.defaultModel;
  }

  async ask(state: unknown, questions: Questions): Promise<JudgeResult> {
    const result = await this.#client.systemOne({ state: asState(state), questions });
    return {
      answers: result.answers as unknown as Record<string, unknown>,
      inputTokens: result.usage.input_tokens,
      outputTokens: result.usage.output_tokens,
      model: result.model,
    };
  }
}
