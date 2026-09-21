/**
 * The find bar's outward language: counts and verdict strings.
 *
 * These are pure view functions, so they are pinned here. The wording is a locked
 * decision (answer-first, honest verdicts): change it only by changing the spec.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { describeCounts, describeVerdict } from "../src/content/findbar.ts";

test("empty counts read as no matches", () => {
  assert.equal(describeCounts({ answer: 0, context: 0, current: 0 }), "0 matches");
});

test("counts read answer-first with a walk position", () => {
  assert.equal(describeCounts({ answer: 1, context: 0, current: 0 }), "1 answer · 1/1");
  assert.equal(describeCounts({ answer: 1, context: 3, current: 0 }), "1 answer + 3 context · 1/4");
  assert.equal(describeCounts({ answer: 1, context: 3, current: 2 }), "1 answer + 3 context · 3/4");
});

test("context-only counts name no answer", () => {
  assert.equal(describeCounts({ answer: 0, context: 2, current: 1 }), "2 context · 2/2");
});

test("verdict strings are the locked wording", () => {
  assert.equal(describeVerdict("answered", { answer: 1, context: 3 }), "answer found");
  assert.equal(describeVerdict("partial", { answer: 0, context: 2 }), "partially addressed");
  assert.equal(describeVerdict("absent", { answer: 0, context: 0 }), "no answer on this page");
});

test("answered without a paintable answer stays honest instead of claiming a find", () => {
  // Edge the prototype's happy path never shows: the Noul cleared the bar but no span
  // survived the floor and live-range checks. Claiming "answer found" with "0 matches"
  // would be a lie; the hedge names exactly what happened.
  assert.equal(
    describeVerdict("answered", { answer: 0, context: 0 }),
    "closest wording, not a confident match",
  );
  assert.equal(
    describeVerdict("answered", { answer: 0, context: 2 }),
    "closest wording, not a confident match",
  );
});
