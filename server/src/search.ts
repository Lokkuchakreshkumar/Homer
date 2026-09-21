/**
 * Feature 2 policy: windowing, question construction, and rank merging.
 *
 * This follows the "line-by-line search" cookbook. Each block gets a short id, the ids
 * become the `Choice` criteria, and callers read the answer's `probabilities` map as a
 * relevance score per block. A second `Noul` question checks whether the document
 * addresses the query at all, because a `Choice` distribution always sums to 1 and
 * therefore always has a winner — even when nothing relevant is present.
 *
 * The cookbook notes a `Choice` accepts at most 255 options. A real page carries far more
 * blocks than that, so this module splits the page into contiguous windows, asks a
 * `Choice` per window plus a per-window `Noul`, and merges the distributions in code.
 * All of those questions go in one request and Jev evaluates them in parallel, so the
 * extra windows cost tokens rather than round trips.
 */

import { choice, noul } from "@typesafe-ai/sdk";
import type { Questions } from "@typesafe-ai/sdk";
import type { SearchHit, SearchVerdict, TextBlock } from "../shared/wire.ts";

/** Documented ceiling on `Choice` options. Windows are sized to match. */
export const MAX_CHOICE_OPTIONS = 255;

export const SEARCH_TUNING = {
  windowSize: MAX_CHOICE_OPTIONS,
  /**
   * Absolute relevance floor on merged scores (0..1, comparable across windows).
   *
   * Replaces the old factor-of-uniform cuts. A page of weak/unrelated spans yields
   * zero hits: nothing paints unless a span clears this bar. Starting value 0.05
   * keeps uniform pages quiet (uniform is 1/N, so pages with >20 spans paint
   * nothing on Choice alone) while letting real answers through — a clear winner
   * in a single window scores 0.3-0.9, and even an 8-window merge keeps 0.9/8≈0.11
   * above the floor. Tuned against fixtures; see ticket 02. Small pages (<20 spans)
   * can still clear the floor on uniform noise, but Noul-gating (absent paints
   * nothing) covers those.
   */
  relevanceFloor: 0.05,
  /**
   * Hard context budget: paint is at most 1 answer + N context (starting N=5).
   * Answered yields 1 strong (answer) + up to N loose (context); partial yields
   * up to N loose and no answer; absent paints nothing.
   */
  maxContext: 5,
  /**
   * `exists` thresholds, mirroring the cookbook's three-way verdict.
   * Kept at current values pending fixture tuning (ticket 08).
   */
  answeredAt: 0.5,
  partialAt: 0.2,
} as const;

export interface SearchWindow {
  /** `w0`, `w1`, ... Used as the key into the state's `passages` map. */
  readonly key: string;
  readonly blocks: readonly TextBlock[];
}

export interface SearchPlan {
  readonly windows: readonly SearchWindow[];
  readonly questions: Questions;
}

/** Split into contiguous windows so a `Choice` never exceeds its option ceiling. */
export function windowBlocks(
  blocks: readonly TextBlock[],
  size: number = SEARCH_TUNING.windowSize,
): SearchWindow[] {
  const windows: SearchWindow[] = [];
  const step = Math.max(1, Math.floor(size));
  for (let i = 0, n = 0; i < blocks.length; i += step, n += 1) {
    windows.push({ key: `w${n}`, blocks: blocks.slice(i, i + step) });
  }
  return windows;
}

/**
 * Prefix each block with its id, the way the cookbook tags lines.
 *
 * The ids are how the model points at a block, so they have to travel inside the text.
 */
export function renderWindow(window: SearchWindow): string {
  return window.blocks.map((block) => `${block.id}| ${block.text}`).join("\n");
}

export interface SearchState {
  readonly page_url: string;
  readonly query: string;
  /** Window key to visibly-id-tagged passage text. */
  readonly passages: Record<string, string>;
}

export function buildSearchState(
  pageUrl: string,
  query: string,
  windows: readonly SearchWindow[],
): SearchState {
  const passages: Record<string, string> = {};
  for (const window of windows) passages[window.key] = renderWindow(window);
  return { page_url: pageUrl, query, passages };
}

/** Keep the query from breaking out of the quoted slot in the instruction. */
function quoteQuery(query: string): string {
  return `"${query.replace(/["\\]/g, " ").trim()}"`;
}

/**
 * One `Choice` per window, plus one `Noul` per window.
 *
 * Criteria descriptions are left null, as the cookbook does, because the block's own text
 * is already in the state under its id. The wording covers both readings of a query —
 * a topic to find ("whitehouse") and a question to answer ("where is whitehouse") — so the
 * caller does not have to classify what the user typed before searching.
 */
export function buildSearchQuestions(
  query: string,
  windows: readonly SearchWindow[],
): SearchPlan {
  const questions: Record<string, ReturnType<typeof choice> | ReturnType<typeof noul>> = {};
  const quoted = quoteQuery(query);

  for (const window of windows) {
    const criteria: Record<string, null> = {};
    for (const block of window.blocks) criteria[block.id] = null;

    questions[`where_${window.key}`] = choice(
      `Which block of \`passages.${window.key}\` best matches the meaning of, or contains ` +
        `the answer to, ${quoted}?`,
      criteria,
    );

    questions[`exists_${window.key}`] = noul(
      `Does any block of \`passages.${window.key}\` address, match, or answer ${quoted}?`,
      {
        true: "At least one block states, directly implies, or is clearly about the answer",
        false: "No block addresses this, or the closest block only shares incidental wording",
      },
    );
  }

  return { windows, questions };
}

/** Three-way verdict on `exists`, mirroring the cookbook's `verdict()`. */
export function verdictFromExists(exists: number): SearchVerdict {
  if (exists >= SEARCH_TUNING.answeredAt) return "answered";
  if (exists >= SEARCH_TUNING.partialAt) return "partial";
  return "absent";
}

/**
 * Merge per-window distributions into one page-wide ranking.
 *
 * Each `Choice` distribution sums to 1, so a block in a sparse window would otherwise
 * outrank an equally good block in a dense one. Dividing by the window count puts every
 * window on the same footing and leaves the merged scores summing to about 1.
 */
export function mergeWindowProbabilities(
  windows: readonly SearchWindow[],
  perWindow: readonly Readonly<Record<string, number>>[],
): Map<string, number> {
  const merged = new Map<string, number>();
  const divisor = Math.max(1, windows.length);
  for (const distribution of perWindow) {
    for (const [id, probability] of Object.entries(distribution)) {
      if (typeof probability !== "number" || !Number.isFinite(probability)) continue;
      merged.set(id, (merged.get(id) ?? 0) + probability / divisor);
    }
  }
  return merged;
}

export interface MergedSearch {
  readonly exists: number;
  readonly verdict: SearchVerdict;
  readonly hits: readonly SearchHit[];
}

export function mergeSearchResults(
  windows: readonly SearchWindow[],
  perWindow: readonly Readonly<Record<string, number>>[],
  perWindowExists: readonly number[],
): MergedSearch {
  const merged = mergeWindowProbabilities(windows, perWindow);

  // Verdict honesty is Noul-gated only. A `Choice` distribution always sums to 1 and
  // therefore always has a winner — even when nothing relevant is present — so Choice
  // confidence must never force answered/partial. The old top-probability calibration
  // and the keep-the-uniform-winner fallback are removed (ticket 02).
  const exists = perWindowExists.length === 0 ? 0 : Math.max(...perWindowExists);
  const verdict = verdictFromExists(exists);

  // Absent paints nothing, honestly. This is what kills the old confetti: a weak page
  // with a uniform winner still reports "no answer on this page" with zero hits.
  if (verdict === "absent") return { exists, verdict, hits: [] };

  // Confetti control = absolute floor + hard budget. Weak spans below the floor never
  // paint, even when the page does hold an answer elsewhere.
  const sorted = [...merged.entries()]
    .filter(([, probability]) => probability >= SEARCH_TUNING.relevanceFloor)
    .sort((a, b) => b[1] - a[1]);

  if (sorted.length === 0) return { exists, verdict, hits: [] };

  // Answer-first paint: answered = 1 answer (strong) + up to N context (loose);
  // partial = context only (all loose), capped to N. Counts follow the locked wording
  // "1 answer + N context" (client formats it; see ticket 03).
  if (verdict === "answered") {
    const [answer, ...rest] = sorted;
    if (answer === undefined) return { exists, verdict, hits: [] };
    const hits: SearchHit[] = [
      { id: answer[0], relevance: answer[1], tier: "strong" },
      ...rest.slice(0, SEARCH_TUNING.maxContext).map(([id, relevance]): SearchHit => ({
        id,
        relevance,
        tier: "loose",
      })),
    ];
    return { exists, verdict, hits };
  }

  const hits: SearchHit[] = sorted
    .slice(0, SEARCH_TUNING.maxContext)
    .map(([id, relevance]): SearchHit => ({ id, relevance, tier: "loose" }));
  return { exists, verdict, hits };
}
