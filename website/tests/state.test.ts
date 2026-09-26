import assert from "node:assert/strict";
import { test } from "node:test";

import { content } from "../data/content.ts";
import {
  canReplay,
  canShowContext,
  inferDemoQuery,
  initialDemoState,
  isAnsweredState,
  showsContext,
  statusForDemoState,
  transitionDemoState,
  visibleFixture,
} from "../lib/demo-state.ts";

test("the local demonstration starts idle", () => {
  const state = initialDemoState();
  assert.equal(state.mode, "idle");
  assert.equal(state.view, "none");
  assert.equal(state.queryKey, null);
  assert.equal(state.queryText, "");
  assert.equal(state.queryError, null);
  assert.equal(statusForDemoState(state), content.demo.status.idle);
});

test("approved sample queries map to their local fixtures", () => {
  assert.equal(inferDemoQuery("How does the rover avoid unsafe terrain?"), "terrain");
  assert.equal(inferDemoQuery("  how   does the rover avoid unsafe terrain?  "), "terrain");
  assert.equal(inferDemoQuery("Where are collected samples stored?"), "samples");
  assert.equal(inferDemoQuery("Who won the design award?"), "absent");
  assert.equal(inferDemoQuery("Tell me about an unrelated topic"), null);
  assert.equal(inferDemoQuery("  \n\t"), null);
});

test("an answer exposes one strongest passage and no context", () => {
  const state = transitionDemoState(initialDemoState(), { type: "ask", key: "terrain" });
  assert.equal(state.mode, "answered");
  assert.equal(state.view, "answer");
  assert.equal(visibleFixture(state), "terrain");
  assert.equal(showsContext(state), false);
  assert.equal(isAnsweredState(state), true);
  assert.equal(canShowContext(state), true);
  assert.equal(canReplay(state), true);
  assert.equal(statusForDemoState(state), `${content.demo.status.answered} 04`);
});

test("context is explicit while the answer remains primary", () => {
  const answered = transitionDemoState(initialDemoState(), { type: "ask", key: "samples" });
  const context = transitionDemoState(answered, { type: "context" });
  assert.equal(context.mode, "context");
  assert.equal(context.view, "context");
  assert.equal(visibleFixture(context), "samples");
  assert.equal(showsContext(context), true);
  assert.equal(canShowContext(context), false);
  assert.equal(statusForDemoState(context), `${content.demo.status.context} 07${content.demo.status.relatedPassage}`);
});

test("editing the input clears a previous result", () => {
  const answered = transitionDemoState(initialDemoState(), { type: "ask", key: "terrain" });
  const edited = transitionDemoState(answered, { type: "edit", text: "Where are samples stored?" });
  assert.equal(edited.mode, "idle");
  assert.equal(edited.view, "none");
  assert.equal(edited.queryKey, null);
  assert.equal(edited.queryText, "Where are samples stored?");
  assert.equal(edited.queryError, null);
  assert.equal(visibleFixture(edited), null);
  assert.equal(showsContext(edited), false);
});

test("whitespace-only input stays in validation and never becomes an absent result", () => {
  const state = transitionDemoState(initialDemoState(), { type: "invalid", text: "   \n\t" });
  assert.equal(state.mode, "idle");
  assert.equal(state.view, "none");
  assert.equal(state.queryKey, null);
  assert.equal(state.queryText, "   \n\t");
  assert.equal(state.queryError, content.demo.validation.emptyQuery);
  assert.equal(visibleFixture(state), null);
  assert.equal(statusForDemoState(state), content.demo.status.validation);
  const directAsk = transitionDemoState(initialDemoState(), { type: "ask", key: "absent", text: "  " });
  assert.equal(directAsk.queryError, content.demo.validation.emptyQuery);
  assert.equal(directAsk.view, "none");
});

test("free text outside the approved samples is rejected without ranking", () => {
  const state = transitionDemoState(initialDemoState(), { type: "unsupported", text: "Find a hidden passage" });
  assert.equal(state.mode, "idle");
  assert.equal(state.view, "none");
  assert.equal(state.queryKey, null);
  assert.equal(state.queryText, "Find a hidden passage");
  assert.equal(state.queryError, content.demo.validation.unsupportedQuery);
  assert.equal(visibleFixture(state), null);
  assert.equal(statusForDemoState(state), content.demo.status.unsupported);
});

test("an unrecognized query has a distinct absent state", () => {
  const state = transitionDemoState(initialDemoState(), { type: "ask", key: "absent" });
  assert.equal(state.mode, "absent");
  assert.equal(state.view, "absent");
  assert.equal(visibleFixture(state), null);
  assert.equal(showsContext(state), false);
  assert.equal(canReplay(state), false);
  assert.equal(statusForDemoState(state), content.demo.status.absent);
});

test("replay preserves the current answer or context view", () => {
  const answered = transitionDemoState(initialDemoState(), { type: "ask", key: "terrain" });
  const answerReplay = transitionDemoState(answered, { type: "replay" });
  assert.equal(answerReplay.mode, "replay");
  assert.equal(answerReplay.view, "answer");
  assert.equal(visibleFixture(answerReplay), "terrain");

  const context = transitionDemoState(answered, { type: "context" });
  const contextReplay = transitionDemoState(context, { type: "replay" });
  assert.equal(contextReplay.mode, "replay");
  assert.equal(contextReplay.view, "context");
  assert.equal(visibleFixture(contextReplay), "terrain");
  assert.equal(showsContext(contextReplay), true);
});

test("replay and context transitions are no-ops without an answer", () => {
  const idle = initialDemoState();
  const absent = transitionDemoState(idle, { type: "ask", key: "absent" });
  assert.deepEqual(transitionDemoState(idle, { type: "replay" }), idle);
  assert.deepEqual(transitionDemoState(idle, { type: "context" }), idle);
  assert.deepEqual(transitionDemoState(absent, { type: "replay" }), absent);
  assert.deepEqual(transitionDemoState(absent, { type: "context" }), absent);
});

test("reset clears the query and returns a resettable state", () => {
  const answered = transitionDemoState(initialDemoState(), { type: "ask", key: "terrain" });
  const reset = transitionDemoState(answered, { type: "reset" });
  assert.equal(reset.mode, "reset");
  assert.equal(reset.view, "none");
  assert.equal(reset.queryKey, null);
  assert.equal(reset.queryText, "");
  assert.equal(statusForDemoState(reset), content.demo.status.reset);
});

test("context cannot be fabricated for an absent result", () => {
  const absent = transitionDemoState(initialDemoState(), { type: "ask", key: "absent" });
  assert.deepEqual(transitionDemoState(absent, { type: "context" }), absent);
});
