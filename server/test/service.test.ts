/**
 * The service, end to end with a scripted judge.
 *
 * These tests cover the parts a policy test cannot reach: that the right number of upstream
 * requests is made, that caching actually prevents a second one, that a failure puts the
 * page back rather than leaving holes in it, and that cost is accounted for.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { JevService, UpstreamError, SEARCH_MAX_STATE_CHARS } from "../src/service.ts";
import { AD_THRESHOLDS } from "../src/ads.ts";
import { MAX_CHOICE_OPTIONS } from "../src/search.ts";
import { makeCandidate, makeBlocks } from "./helpers.ts";
import { FailingJudge, ScriptedJudge, choiceAnswer, noulAnswer } from "./scripted-judge.ts";

const ALL = ["overlay", "sponsored", "adslot"] as const;

function serviceWith(judge: ScriptedJudge | FailingJudge) {
  return new JevService({ judge, judgeReason: "test" });
}

// ---------------------------------------------------------------------------
// Ad judgment
// ---------------------------------------------------------------------------

test("verdicts come back mapped to actions, in the caller's order", async () => {
  const judge = new ScriptedJudge(() => noulAnswer(0.95));
  const service = serviceWith(judge);

  const response = await service.judgeAds({
    pageUrl: "https://example.test/",
    enabled: [...ALL],
    candidates: [
      makeCandidate({ id: "a" }),
      makeCandidate({ id: "b" }),
      makeCandidate({ id: "c" }),
    ],
  });

  assert.deepEqual(
    response.verdicts.map((verdict) => [verdict.id, verdict.action]),
    [
      ["a", "remove"],
      ["b", "remove"],
      ["c", "remove"],
    ],
  );
});

test("one request covers a whole page of candidates, with a question per candidate", async () => {
  const judge = new ScriptedJudge(() => noulAnswer(0.95));
  const service = serviceWith(judge);

  await service.judgeAds({
    pageUrl: "https://example.test/",
    enabled: [...ALL],
    candidates: Array.from({ length: 10 }, (_unused, index) => makeCandidate({ id: `c${index}` })),
  });

  assert.equal(judge.asks.length, 1, "ten candidates should be one batched request");
  const asked = Object.keys(judge.asks[0]?.questions ?? {}).length;
  assert.ok(asked >= 30, `expected at least 30 questions, got ${asked}`);
});

test("a page larger than the batch limit is split into several requests", async () => {
  const judge = new ScriptedJudge(() => noulAnswer(0.95));
  const service = serviceWith(judge);

  const size = AD_THRESHOLDS.maxCandidatesPerRequest;
  await service.judgeAds({
    pageUrl: "https://example.test/",
    enabled: [...ALL],
    candidates: Array.from({ length: size * 2 + 1 }, (_unused, index) =>
      makeCandidate({ id: `c${index}` }),
    ),
  });

  assert.equal(judge.asks.length, 3);
});

test("only the enabled categories are sent as questions", async () => {
  const judge = new ScriptedJudge(() => noulAnswer(0.95));
  await serviceWith(judge).judgeAds({
    pageUrl: "p",
    enabled: ["overlay"],
    candidates: [makeCandidate({ id: "a" })],
  });

  const keys = Object.keys(judge.asks[0]?.questions ?? {});
  assert.ok(keys.some((key) => key.includes("overlay")));
  assert.ok(!keys.some((key) => key.includes("adslot")));
  assert.ok(!keys.some((key) => key.includes("sponsored")));
});

test("the state sent upstream identifies the page and carries the candidates", async () => {
  const judge = new ScriptedJudge(() => noulAnswer(0.95));
  await serviceWith(judge).judgeAds({
    pageUrl: "https://example.test/article",
    enabled: [...ALL],
    candidates: [makeCandidate({ id: "a" })],
  });

  const state = judge.asks[0]?.state as { page_url?: string; candidates?: unknown[] };
  assert.equal(state.page_url, "https://example.test/article");
  assert.equal(state.candidates?.length, 1);
});

// ---------------------------------------------------------------------------
// Caching and failure
// ---------------------------------------------------------------------------

test("a candidate judged before is not paid for again", async () => {
  const judge = new ScriptedJudge(() => noulAnswer(0.95));
  const service = serviceWith(judge);
  const request = {
    pageUrl: "https://example.test/",
    enabled: [...ALL],
    candidates: [makeCandidate({ id: "a" }), makeCandidate({ id: "b" })],
  };

  const first = await service.judgeAds(request);
  const second = await service.judgeAds(request);

  assert.equal(judge.asks.length, 1, "the second call should not reach the judge");
  assert.equal(first.usage.upstreamRequests, 1);
  assert.equal(second.usage.upstreamRequests, 0);
  assert.equal(second.usage.cacheHits, 2);
  assert.equal(second.meta.cached, true);
  assert.equal(second.usage.costUsd, 0, "a cache hit costs nothing");
  assert.deepEqual(
    second.verdicts.map((verdict) => verdict.action),
    first.verdicts.map((verdict) => verdict.action),
  );
});

test("changing the enabled categories invalidates the cached verdicts", async () => {
  const judge = new ScriptedJudge(() => noulAnswer(0.95));
  const service = serviceWith(judge);
  const candidate = makeCandidate({ id: "a" });

  await service.judgeAds({ pageUrl: "p", enabled: ["overlay"], candidates: [candidate] });
  await service.judgeAds({ pageUrl: "p", enabled: ["adslot"], candidates: [candidate] });

  assert.equal(judge.asks.length, 2, "a different question set is a different judgment");
});

test("a model failure leaves the page alone and says so", async () => {
  const service = serviceWith(new FailingJudge());
  const response = await service.judgeAds({
    pageUrl: "https://example.test/",
    enabled: [...ALL],
    candidates: [makeCandidate({ id: "a" }), makeCandidate({ id: "b" })],
  });

  assert.equal(response.verdicts.length, 2);
  for (const verdict of response.verdicts) {
    assert.equal(verdict.action, "keep", "a failure must never hide or delete anything");
    assert.match(verdict.reason, /could not reach/);
  }
  assert.equal(response.meta.warnings.length, 1);
  assert.match(response.meta.warnings[0] ?? "", /judgment failed/);
});

test("one failing batch does not undo the verdicts from a successful one", async () => {
  let call = 0;
  const judge = new ScriptedJudge(() => noulAnswer(0.95));
  const originalAsk = judge.ask.bind(judge);
  judge.ask = async (state, questions) => {
    call += 1;
    if (call === 2) throw new Error("only the second batch fails");
    return originalAsk(state, questions);
  };

  const service = serviceWith(judge);
  const size = AD_THRESHOLDS.maxCandidatesPerRequest;
  const response = await service.judgeAds({
    pageUrl: "p",
    enabled: [...ALL],
    candidates: Array.from({ length: size * 2 }, (_unused, index) =>
      makeCandidate({ id: `c${index}` }),
    ),
  });

  const removed = response.verdicts.filter((verdict) => verdict.action === "remove");
  const kept = response.verdicts.filter((verdict) => verdict.action === "keep");
  assert.equal(removed.length, size, "the first batch still counts");
  assert.equal(kept.length, size, "the failed batch is left on the page");
  assert.equal(response.meta.warnings.length, 1);
});

test("no enabled categories means no request and no verdicts", async () => {
  const judge = new ScriptedJudge(() => noulAnswer(0.95));
  const response = await serviceWith(judge).judgeAds({
    pageUrl: "p",
    enabled: [],
    candidates: [makeCandidate({ id: "a" })],
  });

  assert.equal(judge.asks.length, 0);
  assert.deepEqual(response.verdicts, []);
  assert.match(response.meta.warnings[0] ?? "", /no ad categories/);
});

test("no candidates means no request", async () => {
  const judge = new ScriptedJudge(() => noulAnswer(0.95));
  const response = await serviceWith(judge).judgeAds({
    pageUrl: "p",
    enabled: [...ALL],
    candidates: [],
  });

  assert.equal(judge.asks.length, 0);
  assert.deepEqual(response.verdicts, []);
  assert.deepEqual(response.meta.warnings, []);
});

// ---------------------------------------------------------------------------
// Semantic find
// ---------------------------------------------------------------------------

/** Answer rankings from `probabilities`, and every existence question from `exists`. */
function searchJudge(probabilities: Record<string, number>, exists = 0.9): ScriptedJudge {
  return new ScriptedJudge((key) =>
    key.startsWith("where_") ? choiceAnswer(probabilities) : noulAnswer(exists),
  );
}

test("hits come back answer-first, gated by the absolute floor", async () => {
  // Ticket 02: absolute floor 0.05 replaces factor-of-uniform cuts.
  // b000 (0.4) is the answer, b001 (0.07) clears the floor as context,
  // b002 (0.005) is below the floor and dropped.
  const blocks = makeBlocks(100);
  const judge = searchJudge({ b000: 0.4, b001: 0.07, b002: 0.005 });
  const response = await serviceWith(judge).semanticFind({
    pageUrl: "https://example.test/",
    query: "where is whitehouse",
    blocks,
  });

  assert.equal(response.verdict, "answered");
  assert.equal(response.exists, 0.9);
  assert.deepEqual(
    response.hits.map((hit) => [hit.id, hit.tier]),
    [
      ["b000", "strong"],
      ["b001", "loose"],
    ],
    "a block below the absolute floor is dropped rather than offered",
  );
});

test("the absolute floor is inclusive", async () => {
  const blocks = makeBlocks(10);

  const atFloor = await serviceWith(searchJudge({ b000: 0.05 })).semanticFind({
    pageUrl: "p",
    query: "q",
    blocks,
  });
  assert.equal(atFloor.hits.length, 1, "relevance equal to the floor paints");
  assert.equal(atFloor.hits[0]?.tier, "strong", "single answered hit is the answer");

  const belowFloor = await serviceWith(searchJudge({ b000: 0.049 })).semanticFind({
    pageUrl: "p",
    query: "q",
    blocks,
  });
  assert.equal(belowFloor.hits.length, 0, "relevance below the floor paints nothing");
  assert.equal(belowFloor.verdict, "answered", "verdict stays Noul-gated even with zero hits");
});

test("the query reaches the questions that were actually asked", async () => {
  const judge = searchJudge({ b000: 0.5 });
  await serviceWith(judge).semanticFind({
    pageUrl: "p",
    query: "where is whitehouse",
    blocks: makeBlocks(3),
  });

  const instructions = Object.values(judge.asks[0]?.questions ?? {})
    .map((question) => String(question.instructions))
    .join(" ");
  assert.match(instructions, /where is whitehouse/);
});

test("a page past the option ceiling is searched in windows, in one request", async () => {
  const judge = searchJudge({ b000: 0.5 }, 0.9);
  const response = await serviceWith(judge).semanticFind({
    pageUrl: "p",
    query: "a query",
    blocks: makeBlocks(MAX_CHOICE_OPTIONS + 45),
  });

  assert.equal(judge.asks.length, 1, "all windows go in a single request");
  assert.equal(response.meta.passes, 2);
  assert.deepEqual(Object.keys(judge.asks[0]?.questions ?? {}).sort(), [
    "exists_w0",
    "exists_w1",
    "where_w0",
    "where_w1",
  ]);
});

test("an identical search is free the second time", async () => {
  const judge = searchJudge({ b000: 0.5 });
  const service = serviceWith(judge);
  const request = { pageUrl: "p", query: "a query", blocks: makeBlocks(10) };

  const first = await service.semanticFind(request);
  const second = await service.semanticFind(request);

  assert.equal(judge.asks.length, 1);
  assert.equal(first.meta.cached, false);
  assert.equal(second.meta.cached, true);
  assert.equal(second.usage.cacheHits, 1);
  assert.deepEqual(second.hits, first.hits);
});

test("a different query or different text is a different search", async () => {
  const judge = searchJudge({ b000: 0.5 });
  const service = serviceWith(judge);

  await service.semanticFind({ pageUrl: "p", query: "first", blocks: makeBlocks(10) });
  await service.semanticFind({ pageUrl: "p", query: "second", blocks: makeBlocks(10) });
  await service.semanticFind({ pageUrl: "p", query: "second", blocks: makeBlocks(11) });

  assert.equal(judge.asks.length, 3);
});

test("a search failure is loud, because no answer is a meaningful result", async () => {
  await assert.rejects(
    () =>
      serviceWith(new FailingJudge()).semanticFind({
        pageUrl: "p",
        query: "a query",
        blocks: makeBlocks(5),
      }),
    (error: unknown) => {
      assert.ok(error instanceof UpstreamError, "a transport failure must not look like no match");
      assert.equal(error.status, 502);
      assert.match(error.message, /could not be reached/);
      return true;
    },
  );
});

test("no match found is reported as such, not as an error", async () => {
  const judge = searchJudge({}, 0.04);
  const response = await serviceWith(judge).semanticFind({
    pageUrl: "p",
    query: "how do I renew a passport",
    blocks: makeBlocks(20),
  });

  assert.equal(response.verdict, "absent");
  assert.deepEqual(response.hits, []);
  assert.deepEqual(response.meta.warnings, []);
});

test("an empty query and an empty page are answered without a request", async () => {
  const judge = searchJudge({ b000: 0.5 });
  const service = serviceWith(judge);

  const noQuery = await service.semanticFind({ pageUrl: "p", query: "   ", blocks: makeBlocks(5) });
  assert.equal(noQuery.verdict, "absent");
  assert.match(noQuery.meta.warnings[0] ?? "", /query was empty/);

  const noBlocks = await service.semanticFind({ pageUrl: "p", query: "a query", blocks: [] });
  assert.equal(noBlocks.verdict, "absent");
  assert.match(noBlocks.meta.warnings[0] ?? "", /no readable text/);

  assert.equal(judge.asks.length, 0);
});

test("a page too large for the state budget is trimmed and says so", async () => {
  const blocks = Array.from({ length: 20 }, (_unused, index) => ({
    id: `b${index}`,
    text: "z".repeat(10_000),
    words: 1,
  }));
  const judge = searchJudge({ b000: 0.9 });
  const response = await serviceWith(judge).semanticFind({
    pageUrl: "p",
    query: "a query",
    blocks,
  });

  assert.match(response.meta.warnings.join(" "), /state budget/);
  const state = judge.asks[0]?.state as { passages?: Record<string, string> };
  const lines = (state.passages?.["w0"] ?? "").split("\n").length;
  assert.ok(lines < blocks.length, `searched ${lines} of ${blocks.length} blocks`);
  assert.ok(SEARCH_MAX_STATE_CHARS > 0, "the budget is a real, positive limit");
});

test("a window with no ranking is reported rather than silently ignored", async () => {
  const judge = new ScriptedJudge((key) => {
    if (key === "where_w1") return undefined;
    return key.startsWith("where_") ? choiceAnswer({ b000: 0.9 }) : noulAnswer(0.9);
  });

  const response = await serviceWith(judge).semanticFind({
    pageUrl: "p",
    query: "a query",
    blocks: makeBlocks(MAX_CHOICE_OPTIONS + 5),
  });

  assert.match(response.meta.warnings.join(" "), /no ranking came back for passage w1/);
  assert.equal(response.hits.length, 1);
});

test("cost is accounted for from the tokens actually used", async () => {
  const judge = new ScriptedJudge(() => noulAnswer(0.95));
  const response = await serviceWith(judge).judgeAds({
    pageUrl: "p",
    enabled: [...ALL],
    candidates: [makeCandidate({ id: "a" })],
  });

  // The scripted judge reports a flat 100 input tokens at $0.042 per million.
  assert.equal(response.usage.inputTokens, 100);
  assert.ok(Math.abs(response.usage.costUsd - (100 * 0.042) / 1_000_000) < 1e-12);
  assert.equal(response.usage.model, "scripted-1");
});

test("stats accumulate across both features", async () => {
  const judge = searchJudge({ b000: 0.5 });
  const service = serviceWith(judge);

  const before = service.stats();
  assert.equal(before.adsJudged, 0);
  assert.equal(before.searches, 0);

  await service.judgeAds({
    pageUrl: "p",
    enabled: [...ALL],
    candidates: [makeCandidate({ id: "a" }), makeCandidate({ id: "b" })],
  });
  await service.semanticFind({ pageUrl: "p", query: "a query", blocks: makeBlocks(5) });

  const after = service.stats();
  assert.equal(after.adsJudged, 2);
  assert.equal(after.searches, 1);
  assert.ok(after.cacheEntries >= 3, "one entry per candidate plus one per search");
  assert.ok(after.totals.upstreamRequests >= 2);
});
