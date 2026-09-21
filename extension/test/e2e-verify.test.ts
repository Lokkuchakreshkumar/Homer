/**
 * End-to-end verification for ticket 08, fully offline.
 *
 * Each test drives the real pipeline over the real fixture pages with the
 * deterministic stub judge standing in for Jev: extractBlocks/scanForAds over
 * linkedom-parsed HTML (injected measurer seam), JevService for ranking and
 * judgment, AdLedger for restore. No API key, no network, no spend.
 *
 * `data-j-function="true"` fixture nodes are excluded from the verdict
 * comparison: the stub gets exactly those wrong by design (the fixture says so),
 * and a real Jev closes the gap in-browser.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";

import { extractBlocks, scanForAds } from "../src/dom.ts";
import { toCandidate } from "../src/heuristics.ts";
import { AdLedger } from "../src/content/ledger.ts";
import { JevService } from "../../server/src/service.ts";
import { StubJudge } from "../../server/src/stub-judge.ts";
import { DEFAULT_SETTINGS, enabledCategories } from "../../shared/settings.ts";
import { ADS_LAYOUT, fixtureExpectations, measurerFor, parseFixture } from "./harness.ts";

const service = new JevService({ judge: new StubJudge(), judgeReason: "e2e-verify" });
const findMeasurer = measurerFor({ body: { width: 1280, height: 800 } });

// ---------------------------------------------------------------------------
// Semantic find over fixtures/qa.html
// ---------------------------------------------------------------------------

const qaDocument = parseFixture("qa.html");
const qaBlocks = extractBlocks(qaDocument, findMeasurer);
const qaTexts = qaBlocks.map((entry) => entry.block);

function qaIdContaining(snippet: string): string {
  const found = qaBlocks.find((entry) => entry.block.text.includes(snippet));
  assert.ok(found, `qa.html should contain a span with ${JSON.stringify(snippet)}`);
  return found.block.id;
}

test("Elon-style query focuses the exact birth sentence first", async () => {
  const birthId = qaIdContaining("Pretoria");
  const response = await service.semanticFind({
    pageUrl: "http://127.0.0.1:8787/fixtures/qa.html",
    query: "where was Elon Musk born",
    blocks: qaTexts,
  });

  assert.equal(response.verdict, "answered");
  assert.ok(response.hits.length >= 1, "the answer must paint");
  assert.ok(response.hits.length <= 6, "paint stays within the 1 answer + 5 context budget");
  assert.equal(response.hits[0]?.id, birthId, "the first focus lands on the birth sentence");
  assert.equal(response.hits[0]?.tier, "strong", "the answer span paints as the answer");
  assert.deepEqual(response.meta.warnings, [], "a small fixture stays inside every budget");
});

test("a query only partly addressed paints context but never an answer", async () => {
  const response = await service.semanticFind({
    pageUrl: "http://127.0.0.1:8787/fixtures/qa.html",
    query: "where is the restaurateur",
    blocks: qaTexts,
  });

  assert.equal(response.verdict, "partial");
  assert.ok(response.hits.length > 0, "partial still paints its context");
  assert.ok(response.hits.length <= 5, "partial paints at most the context budget");
  for (const hit of response.hits) {
    assert.equal(hit.tier, "loose", "partial has no answer span");
  }
  const cook = qaIdContaining("restaurateur");
  assert.equal(response.hits[0]?.id, cook, "the top context names the trade");
});

test("an answer-less query stays clean: absent with zero hits", async () => {
  const response = await service.semanticFind({
    pageUrl: "http://127.0.0.1:8787/fixtures/qa.html",
    query: "how do I renew a passport",
    blocks: qaTexts,
  });

  assert.equal(response.verdict, "absent");
  assert.deepEqual(response.hits, [], "absent paints nothing");
});

test("a 400-span page still focuses the answer within the paint budget", async () => {
  // Ticket 08: the paint-budget proof driven through the real pipeline at scale —
  // extraction, multi-window ranking, floor, and cap — not just the policy seam.
  const filler =
    "<p>The Washington Metro opened in 1976 with vaulted concrete stations. " +
    "Fares are distance-based and paid with a SmarTrip card. " +
    "The library opens at nine in the morning every weekday. " +
    "Rain is likely after midnight across the district. " +
    "Traffic in the district is heavy on weekday mornings.</p>";
  const long = parseHTML(
    `<html><body><main><article><p>Elon Musk was born in Pretoria, South Africa, on June 28, 1971.</p>${filler.repeat(80)}</article></main></body></html>`,
  ).document as unknown as Document;
  const entries = extractBlocks(long, findMeasurer);
  assert.ok(entries.length > 400, `expected a 400-span page, got ${entries.length}`);

  const response = await service.semanticFind({
    pageUrl: "http://127.0.0.1:8787/fixtures/qa.html",
    query: "where was Elon Musk born",
    blocks: entries.map((entry) => entry.block),
  });

  assert.equal(response.verdict, "answered");
  assert.ok(response.hits.length >= 1, "the answer must paint at any scale");
  assert.ok(response.hits.length <= 6, "paint never exceeds 1 answer + 5 context");
  assert.equal(response.hits[0]?.tier, "strong", "the first focus stays the answer");
  assert.match(
    entries.find((entry) => entry.block.id === response.hits[0]?.id)?.block.text ?? "",
    /Pretoria/,
    "the focused span is the birth sentence",
  );
});

// ---------------------------------------------------------------------------
// Ad shield over fixtures/ads.html
// ---------------------------------------------------------------------------

const ADS_PAGE = "http://127.0.0.1:8787/fixtures/ads.html";

async function judgeFixture(): Promise<{
  readonly verdicts: Awaited<ReturnType<JevService["judgeAds"]>>["verdicts"];
  readonly scanned: ReturnType<typeof scanForAds>;
  /** Verdict scan-key (cN) to fixture element id. */
  readonly elementIdByKey: ReadonlyMap<string, string>;
}> {
  const document = parseFixture("ads.html");
  const scanned = scanForAds(document, measurerFor(ADS_LAYOUT));
  const candidates = scanned.map((result) =>
    toCandidate(result.key, result.descriptor, result.reasons),
  );
  const categories = enabledCategories(DEFAULT_SETTINGS);
  const response = await service.judgeAds({ pageUrl: ADS_PAGE, enabled: categories, candidates });
  const elementIdByKey = new Map(
    scanned.map((result) => [result.key, result.element.getAttribute("id") ?? result.key] as const),
  );
  return { verdicts: response.verdicts, scanned, elementIdByKey };
}

/** Index verdicts by fixture element id instead of scan key. */
function verdictsByElementId(
  judged: Awaited<ReturnType<typeof judgeFixture>>,
): ReadonlyMap<string, (typeof judged.verdicts)[number]> {
  const byId = new Map<string, (typeof judged.verdicts)[number]>();
  for (const verdict of judged.verdicts) {
    byId.set(judged.elementIdByKey.get(verdict.id) ?? verdict.id, verdict);
  }
  return byId;
}

test("stub-judged image ads vanish while editorial figures survive", async () => {
  const byId = verdictsByElementId(await judgeFixture());

  // Image shapes: bare img, background-image, captioned native, and picture/srcset.
  const imageCases = [
    ["img-ad-network", "remove"],
    ["img-bg-promo", "remove"],
    ["img-native-caption", "hide"],
    ["img-picture-srcset", "remove"],
  ] as const;
  for (const [key, action] of imageCases) {
    const verdict = byId.get(key);
    assert.ok(verdict, `${key} should have been shortlisted and judged`);
    assert.equal(verdict.action, action, `${key}: ${verdict.reason}`);
  }

  // Negatives stay out of the candidate set by design (shortlist side pinned in
  // dom.test.ts); assert stay-out here so this test fails — rather than passing
  // vacuously — if one ever slips through to judgment.
  for (const key of ["img-editorial", "img-chart-note", "site-brand"]) {
    assert.equal(byId.has(key), false, `${key} stays out of the candidate set`);
  }
});

test("every stub-judgeable expectation in the fixture holds", async () => {
  const judged = await judgeFixture();
  const byId = verdictsByElementId(judged);
  const expectations = fixtureExpectations("ads.html");
  assert.ok(byId.size > 0, "the shield must shortlist fixture candidates to judge");

  // The only allowed misses are the data-j-function nodes the stub misses by design.
  const doc = parseFixture("ads.html");
  const jFunction = new Set<string>();
  for (const element of doc.querySelectorAll("[data-j-function='true']")) {
    const id = (element as Element).getAttribute("id");
    if (id) jFunction.add(id);
  }

  const unexplained: string[] = [];
  for (const [key, expected] of expectations) {
    const verdict = byId.get(key);
    if (verdict === undefined) continue; // not shortlisted: covered by dedicated tests
    if (verdict.action !== expected && !jFunction.has(key)) {
      unexplained.push(`${key}: got ${verdict.action}, want ${expected}`);
    }
  }
  assert.deepEqual(unexplained, [], "every stub-judgeable verdict must match data-expect");
});

test("one restore undoes every shield change, image hides included", async () => {
  const document = parseFixture("ads.html");
  const scanned = scanForAds(document, measurerFor(ADS_LAYOUT));
  const candidates = scanned.map((result) =>
    toCandidate(result.key, result.descriptor, result.reasons),
  );
  const categories = enabledCategories(DEFAULT_SETTINGS);
  const response = await service.judgeAds({ pageUrl: ADS_PAGE, enabled: categories, candidates });

  const ledger = new AdLedger();
  const byKey = new Map(scanned.map((result) => [result.key, result]));
  let hidden = 0;
  let removed = 0;
  for (const verdict of response.verdicts) {
    const result = byKey.get(verdict.id);
    if (result === undefined) continue;
    ledger.claim(verdict.id, result.element);
    if (verdict.action === "hide") {
      ledger.mark(result.element, "hide");
      ledger.record(verdict.id, {
        summary: verdict.id,
        category: verdict.category,
        probability: verdict.probability,
      });
      hidden += 1;
    } else if (verdict.action === "remove") {
      const parent = result.element.parentNode;
      if (parent === null) continue;
      ledger.mark(result.element, "remove");
      ledger.stashRemoval(verdict.id, {
        node: result.element,
        parent,
        nextSibling: result.element.nextSibling,
      });
      result.element.remove();
      ledger.record(verdict.id, {
        summary: verdict.id,
        category: verdict.category,
        probability: verdict.probability,
      });
      removed += 1;
    }
  }
  assert.ok(hidden + removed > 0, "the shield must have acted for restore to undo");

  ledger.restore();
  for (const result of scanned) {
    assert.equal(
      result.element.hasAttribute("data-jev-ad"),
      false,
      `${result.key} is back to normal`,
    );
  }
});
