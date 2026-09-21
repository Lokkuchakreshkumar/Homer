/**
 * Semantic find tests.
 *
 * The two things worth proving here are the ones that are easy to get silently wrong: that
 * no `Choice` question ever exceeds the documented 255-option ceiling, and that a block in
 * one window is scored on the same footing as a block in another. A merge that forgot to
 * normalise would still look plausible on a single-window page.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  MAX_CHOICE_OPTIONS,
  SEARCH_TUNING,
  buildSearchQuestions,
  buildSearchState,
  mergeSearchResults,
  mergeWindowProbabilities,
  renderWindow,
  verdictFromExists,
  windowBlocks,
} from "../src/search.ts";
import type { SearchWindow } from "../src/search.ts";
import { makeBlocks } from "./helpers.ts";

test("windowing splits only past the option ceiling", () => {
  assert.deepEqual(windowBlocks([]), []);

  const exact = windowBlocks(makeBlocks(MAX_CHOICE_OPTIONS));
  assert.equal(exact.length, 1, "a full page at the ceiling is still one window");

  const over = windowBlocks(makeBlocks(MAX_CHOICE_OPTIONS + 1));
  assert.equal(over.length, 2);
  assert.equal(over[0]?.blocks.length, MAX_CHOICE_OPTIONS);
  assert.equal(over[1]?.blocks.length, 1);
});

test("no Choice question ever exceeds the option ceiling", () => {
  // This is the single most load-bearing invariant in feature 2. The cookbook documents
  // 255 options; a 256th silently truncates or errors, and a truncated option list means
  // the model cannot point at the block it wanted to choose.
  const blocks = makeBlocks(MAX_CHOICE_OPTIONS * 3 + 7);
  const windows = windowBlocks(blocks);
  const plan = buildSearchQuestions("where is whitehouse", windows);

  for (const window of windows) {
    const question = plan.questions[`where_${window.key}`];
    assert.ok(question, `no ranking question for ${window.key}`);
    assert.equal(question.type, "choice");
    if (question.type !== "choice") continue;
    const options = Object.keys(question.criteria);
    assert.ok(
      options.length <= MAX_CHOICE_OPTIONS,
      `window ${window.key} has ${options.length} options`,
    );
    assert.equal(options.length, window.blocks.length);
  }
});

test("windowing preserves every block in order", () => {
  const blocks = makeBlocks(MAX_CHOICE_OPTIONS * 2 + 13);
  const flattened = windowBlocks(blocks).flatMap((window) => window.blocks);
  assert.deepEqual(
    flattened.map((block) => block.id),
    blocks.map((block) => block.id),
  );
});

test("a passage prefixes every block with its id", () => {
  const window = windowBlocks(makeBlocks(2))[0] as SearchWindow;
  const lines = renderWindow(window).split("\n");
  assert.equal(lines.length, 2);
  assert.match(lines[0] ?? "", /^b000\| /);
  assert.match(lines[1] ?? "", /^b001\| /);
});

test("state carries one passage per window, keyed to match the questions", () => {
  const windows = windowBlocks(makeBlocks(MAX_CHOICE_OPTIONS + 2));
  const state = buildSearchState("https://example.test/a", "whitehouse", windows);
  assert.deepEqual(Object.keys(state.passages), windows.map((window) => window.key));
  assert.equal(state.query, "whitehouse");
});

test("every window gets both a ranking and an existence question", () => {
  const windows = windowBlocks(makeBlocks(MAX_CHOICE_OPTIONS + 1));
  const plan = buildSearchQuestions("a query", windows);
  for (const window of windows) {
    assert.equal(plan.questions[`where_${window.key}`]?.type, "choice");
    assert.equal(plan.questions[`exists_${window.key}`]?.type, "noul");
  }
});

test("a query containing quotes or backslashes cannot break out of the instruction", () => {
  const windows = windowBlocks(makeBlocks(3));
  const nasty = `he said "hello" and \\ then stopped`;
  const plan = buildSearchQuestions(nasty, windows);
  const question = plan.questions[`where_${windows[0]?.key ?? ""}`];
  assert.ok(question);
  const instruction = String(question.instructions);
  // Exactly one pair of quotes, wrapping the sanitised query.
  assert.equal((instruction.match(/"/g) ?? []).length, 2);
  assert.ok(!instruction.includes("\\"));
});

test("the existence verdict mirrors the documented three-way split", () => {
  assert.equal(verdictFromExists(0.9), "answered");
  assert.equal(verdictFromExists(SEARCH_TUNING.answeredAt), "answered");
  assert.equal(verdictFromExists(0.35), "partial");
  assert.equal(verdictFromExists(SEARCH_TUNING.partialAt), "partial");
  assert.equal(verdictFromExists(0.05), "absent");
});

// ---------------------------------------------------------------------------
// Merging
// ---------------------------------------------------------------------------

/** Spread `total` evenly over the given ids. */
function even(ids: readonly string[], total = 1): Record<string, number> {
  const out: Record<string, number> = {};
  const share = ids.length === 0 ? 0 : total / ids.length;
  for (const id of ids) out[id] = share;
  return out;
}

test("merging divides by the window count, so the combined scores still sum to one", () => {
  const windows = windowBlocks(makeBlocks(MAX_CHOICE_OPTIONS * 3));
  assert.equal(windows.length, 3);

  // Each window's own distribution sums to 1. After merging, the union must too, or the
  // cutoffs below would be computed against a scale that means nothing.
  const perWindow = windows.map((window) => even(window.blocks.map((block) => block.id)));
  const merged = mergeWindowProbabilities(windows, perWindow);

  const total = [...merged.values()].reduce((sum, value) => sum + value, 0);
  assert.ok(Math.abs(total - 1) < 1e-9, `merged scores summed to ${total}, expected 1`);
  assert.equal(merged.size, MAX_CHOICE_OPTIONS * 3);
});

test("a block in a small window is scored on the same footing as one in a huge window", () => {
  // Without the per-window division, a winner among three blocks and a winner among two
  // hundred would both come back as their own window's maximum, and the ranking across
  // windows would be arbitrary.
  const small = windowBlocks(makeBlocks(4, "s"))[0] as SearchWindow;
  const large = windowBlocks(makeBlocks(200, "l"))[0] as SearchWindow;

  const merged = mergeWindowProbabilities(
    [small, large],
    [
      { s000: 0.7, s001: 0.1, s002: 0.1, s003: 0.1 },
      { l000: 0.7, ...even(["l001", "l002", "l003"], 0.3) },
    ],
  );

  assert.equal(merged.get("s000"), merged.get("l000"));
  assert.ok(Math.abs((merged.get("s000") ?? 0) - 0.35) < 1e-9);
});

test("confidence comes from the score, not from being first", () => {
  const windows = windowBlocks(makeBlocks(100));

  // Absolute floor (ticket 02): 0.4 is the answer, 0.07 clears the 0.05 floor as
  // context, 0.01 is below the floor and dropped — no factor-of-uniform math.
  const perWindow = [{ b000: 0.4, b001: 0.07, b002: 0.01 }];
  const merged = mergeSearchResults(windows, perWindow, [0.9]);

  const byId = new Map(merged.hits.map((hit) => [hit.id, hit]));
  assert.equal(byId.get("b000")?.tier, "strong", "answer span clears the floor");
  assert.equal(byId.get("b001")?.tier, "loose", "context clears the floor but is not the answer");
  assert.equal(byId.get("b002"), undefined, "below the absolute floor, so dropped");
  assert.equal(merged.verdict, "answered");
});

test("a below-floor winner paints nothing (absolute floor, no promotion)", () => {
  const windows = windowBlocks(makeBlocks(100));
  // 0.03 is below the 0.05 absolute floor: worth nothing, not even a loose match.
  // This replaces the old "3x uniform stays loose" relative-cut behavior.
  const merged = mergeSearchResults(windows, [{ b000: 0.03 }], [0.9]);
  assert.equal(merged.hits.length, 0);
  assert.equal(merged.verdict, "answered", "verdict stays Noul-gated even with zero hits");
});

test("when the page holds no answer, the closest wording is not offered as a match", () => {
  const windows = windowBlocks(makeBlocks(100));
  const uniformDistribution = even(windows[0]?.blocks.map((block) => block.id) ?? []);

  const merged = mergeSearchResults(windows, [uniformDistribution], [0.04]);
  assert.equal(merged.verdict, "absent");
  assert.equal(merged.hits.length, 0);
});

test("no uniform-winner fallback: a uniform page paints nothing even when Noul says answered", () => {
  const windows = windowBlocks(makeBlocks(100));
  // Uniform 0.01 is below the absolute floor. The old fallback kept the winner;
  // ticket 02 removes it — honest paint is zero hits, verdict stays Noul-gated.
  const uniformDistribution = even(windows[0]?.blocks.map((block) => block.id) ?? []);

  const merged = mergeSearchResults(windows, [uniformDistribution], [0.8]);
  assert.equal(merged.verdict, "answered");
  assert.equal(merged.hits.length, 0);
});

test("one window finding an answer is enough for the page to have one", () => {
  const windows = windowBlocks(makeBlocks(MAX_CHOICE_OPTIONS + 5));
  const merged = mergeSearchResults(windows, [{}, {}], [0.01, 0.95]);
  assert.equal(merged.exists, 0.95);
  assert.equal(merged.verdict, "answered");
});

test("highlights are capped so a page cannot turn into confetti", () => {
  const windows = windowBlocks(makeBlocks(400));
  // 100 spans well above the absolute floor: without a hard budget this would be confetti.
  const perWindow: Record<string, number> = {};
  for (let i = 0; i < 100; i++) {
    perWindow[`b${i.toString().padStart(3, "0")}`] = 0.2 - i * 0.001;
  }

  const merged = mergeSearchResults(windows, [perWindow], [0.9]);
  assert.equal(merged.hits.length, 1 + SEARCH_TUNING.maxContext);
  assert.ok(
    (merged.hits[0]?.relevance ?? 0) >= (merged.hits.at(-1)?.relevance ?? 0),
    "hits must be ordered best first",
  );
});

test("a missing ranking for a window degrades instead of throwing", () => {
  const windows = windowBlocks(makeBlocks(MAX_CHOICE_OPTIONS + 5));
  const merged = mergeSearchResults(windows, [{ b000: 0.9 }], [0.9]);
  assert.equal(merged.hits.length, 1);
  assert.equal(merged.hits[0]?.id, "b000");
});

// ---------------------------------------------------------------------------
// Ticket 02: answer-first ranking and honest verdicts
// ---------------------------------------------------------------------------

test("an absolute floor gates paint: weak spans yield zero hits", () => {
  const windows = windowBlocks(makeBlocks(20));
  // All merged scores below the absolute floor, Noul says absent.
  const weak: Record<string, number> = {};
  for (const block of windows[0]?.blocks ?? []) weak[block.id] = 0.01;
  const merged = mergeSearchResults(windows, [weak], [0.04]);
  assert.equal(merged.verdict, "absent");
  assert.equal(merged.hits.length, 0);
});

test("a weak page paints nothing even when Choice is confident (no calibration)", () => {
  const windows = windowBlocks(makeBlocks(100));
  // Top is 0.9 locally but Noul says absent: honest verdict stays absent, paints nothing
  // once the floor + Noul gate replace the old top-probability forcing.
  // Note: merged top = 0.9 (single window), which clears any reasonable floor,
  // so this specifically proves Noul-gating, not floor-gating.
  const merged = mergeSearchResults(windows, [{ b000: 0.9 }], [0.04]);
  assert.equal(merged.verdict, "absent");
  assert.equal(merged.hits.length, 0);
});

test("paint never exceeds 1 answer + N context", () => {
  const windows = windowBlocks(makeBlocks(400));
  const perWindow: Record<string, number> = {};
  // 100 blocks well above any reasonable floor.
  for (let i = 0; i < 100; i++) {
    const id = `b${i.toString().padStart(3, "0")}`;
    perWindow[id] = 0.1 + (100 - i) * 0.001;
  }
  const merged = mergeSearchResults(windows, [perWindow], [0.9]);
  assert.equal(merged.verdict, "answered");
  assert.ok(
    merged.hits.length <= 1 + SEARCH_TUNING.maxContext,
    `expected at most ${1 + SEARCH_TUNING.maxContext} hits, got ${merged.hits.length}`,
  );
  assert.equal(merged.hits[0]?.tier, "strong", "first hit is the answer");
  for (const hit of merged.hits.slice(1)) {
    assert.equal(hit.tier, "loose", "remaining hits are context");
  }
  assert.ok(
    (merged.hits[0]?.relevance ?? 0) >= (merged.hits.at(-1)?.relevance ?? 0),
    "hits must be ordered best first",
  );
});

test("a single answering sentence is the top-ranked answer with bounded context", () => {
  const windows = windowBlocks(makeBlocks(20));
  const perWindow: Record<string, number> = {
    b007: 0.5,
    b003: 0.07,
    b005: 0.06,
    b001: 0.001,
  };
  const merged = mergeSearchResults(windows, [perWindow], [0.9]);
  assert.equal(merged.verdict, "answered");
  assert.ok(merged.hits.length >= 1, "answer must paint");
  assert.ok(
    merged.hits.length <= 1 + SEARCH_TUNING.maxContext,
    "context must stay bounded",
  );
  assert.equal(merged.hits[0]?.id, "b007", "answering sentence ranks first");
  assert.equal(merged.hits[0]?.tier, "strong");
});

test("an answer-less page yields absent with zero hits", () => {
  const windows = windowBlocks(makeBlocks(20));
  const uniform = even(windows[0]?.blocks.map((block) => block.id) ?? []);
  const merged = mergeSearchResults(windows, [uniform], [0.04]);
  assert.equal(merged.verdict, "absent");
  assert.equal(merged.hits.length, 0);
});

test("partial verdict paints context only, never an answer", () => {
  const windows = windowBlocks(makeBlocks(20));
  const perWindow: Record<string, number> = {
    b002: 0.2,
    b004: 0.15,
    b006: 0.1,
  };
  const merged = mergeSearchResults(windows, [perWindow], [0.2]);
  assert.equal(merged.verdict, "partial");
  assert.ok(merged.hits.length > 0, "partial should still paint context");
  assert.ok(
    merged.hits.length <= SEARCH_TUNING.maxContext,
    `partial paints at most ${SEARCH_TUNING.maxContext} context hits`,
  );
  for (const hit of merged.hits) {
    assert.equal(hit.tier, "loose", "partial has no answer span");
  }
});
