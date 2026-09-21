/**
 * Answer-first hit handling for the find client.
 *
 * The server answers with at most one strong hit (the answer) followed by loose
 * context hits in relevance order. These tests pin the client's reading of that
 * contract: partition, ordering, and stale-range filtering, all without a worker.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";

import type { SearchHit } from "../../shared/wire.ts";
import { toTextBlock } from "../src/heuristics.ts";
import type { ExtractedBlock } from "../src/dom.ts";
import { partitionAnswer, resolveHitRanges } from "../src/content/search.ts";

function hit(id: string, tier: SearchHit["tier"]): SearchHit {
  return { id, relevance: 0.5, tier };
}

test("the strong hit partitions out as the answer, the rest as context", () => {
  const { answer, context } = partitionAnswer([hit("b001", "strong"), hit("b002", "loose")]);
  assert.equal(answer?.id, "b001");
  assert.deepEqual(context.map((entry) => entry.id), ["b002"]);
});

test("context-only hits partition to no answer", () => {
  const { answer, context } = partitionAnswer([hit("b002", "loose"), hit("b003", "loose")]);
  assert.equal(answer, null);
  assert.deepEqual(context.map((entry) => entry.id), ["b002", "b003"]);
});

test("a strong hit anywhere wins as the answer, keeping relative order", () => {
  const { answer, context } = partitionAnswer([hit("b002", "loose"), hit("b001", "strong")]);
  assert.equal(answer?.id, "b001");
  assert.deepEqual(context.map((entry) => entry.id), ["b002"]);
});

test("no hits partition to nothing", () => {
  const { answer, context } = partitionAnswer([]);
  assert.equal(answer, null);
  assert.deepEqual(context, []);
});

function blockIn(document: Document, id: string, text: string): ExtractedBlock {
  const element = document.createElement("p");
  element.textContent = text;
  document.body.appendChild(element);
  const range = document.createRange();
  range.selectNodeContents(element);
  return { block: { ...toTextBlock(0, text), id }, element, ranges: [range] };
}

test("resolved ranges follow the answer-then-context order", () => {
  const { document } = parseHTML("<html><body></body></html>");
  const doc = document as unknown as Document;
  const first = blockIn(doc, "b000", "First block holds enough words here.");
  const second = blockIn(doc, "b001", "Second block holds enough words here.");
  const byId = new Map([
    ["b000", first],
    ["b001", second],
  ]);
  const resolved = resolveHitRanges(doc, [...byId.values()], [
    hit("b001", "strong"),
    hit("b000", "loose"),
  ]);
  assert.equal(resolved.answer.length, 1);
  assert.equal(resolved.context.length, 1);
  assert.deepEqual(
    resolved.matches.map((match) => match.tier),
    ["strong", "loose"],
  );
});

test("span ordinals stay dense when a middle hit drops out", () => {
  const { document } = parseHTML("<html><body></body></html>");
  const doc = document as unknown as Document;
  const answer = blockIn(doc, "b000", "Answer block holds enough words here.");
  const dropped = blockIn(doc, "b001", "Dropped block holds enough words here.");
  const survivor = blockIn(doc, "b002", "Survivor block holds enough words here.");
  dropped.element.remove();
  const resolved = resolveHitRanges(doc, [answer, dropped, survivor], [
    hit("b000", "strong"),
    hit("b001", "loose"),
    hit("b002", "loose"),
  ]);
  assert.equal(resolved.answerSpans, 1);
  assert.equal(resolved.contextSpans, 1);
  assert.deepEqual(resolved.matches.map((match) => match.span), [0, 1]);
});

test("hits for vanished blocks and detached ranges are skipped", () => {
  const { document } = parseHTML("<html><body></body></html>");
  const doc = document as unknown as Document;
  const kept = blockIn(doc, "b000", "Kept block holds enough words here.");
  const gone = blockIn(doc, "b001", "Gone block holds enough words here.");
  gone.element.remove();
  const resolved = resolveHitRanges(doc, [kept, gone], [hit("b000", "loose"), hit("b001", "loose"), hit("b009", "loose")]);
  assert.equal(resolved.matches.length, 1);
  assert.equal(resolved.matches[0]?.tier, "loose");
});
