/**
 * Scripted judges.
 *
 * The stub judge is deliberately approximate, so tests that need to pin exact pipeline
 * behaviour use these instead: they answer from a function, which lets a test say "every
 * ad question comes back at 0.95" and then assert precisely what the service did with it.
 */

import type { Questions } from "@typesafe-ai/sdk";
import type { Judge, JudgeResult } from "../src/judge.ts";

export interface Ask {
  readonly state: unknown;
  readonly questions: Questions;
}

export function noulAnswer(probability: number): { type: "noul"; noul: number } {
  return { type: "noul", noul: probability };
}

export function choiceAnswer(
  probabilities: Record<string, number>,
): { type: "choice"; choice: string; confidence: number; probabilities: Record<string, number> } {
  let choice = "";
  let top = -1;
  for (const [label, probability] of Object.entries(probabilities)) {
    if (probability > top) {
      top = probability;
      choice = label;
    }
  }
  return { type: "choice", choice, confidence: 0.9, probabilities };
}

/** Answers every question with whatever `respond` returns, and records what it was asked. */
export class ScriptedJudge implements Judge {
  readonly mode = "stub" as const;
  readonly model = "scripted-1";
  readonly asks: Ask[] = [];
  readonly #respond: (key: string, callIndex: number) => unknown;

  constructor(respond: (key: string, callIndex: number) => unknown) {
    this.#respond = respond;
  }

  async ask(state: unknown, questions: Questions): Promise<JudgeResult> {
    const callIndex = this.asks.length;
    this.asks.push({ state, questions });

    const answers: Record<string, unknown> = {};
    for (const key of Object.keys(questions)) {
      answers[key] = this.#respond(key, callIndex);
    }
    return { answers, inputTokens: 100, outputTokens: 10, model: this.model };
  }
}

export class FailingJudge implements Judge {
  readonly mode = "stub" as const;
  readonly model = "failing-1";

  async ask(): Promise<JudgeResult> {
    throw new Error("upstream exploded");
  }
}
