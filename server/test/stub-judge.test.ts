/**
 * The offline stub judge.
 *
 * The stub infers what a *Noul* question is asking from its wording, not from its question
 * key. That is deliberate — a wording change that makes a yes/no question ambiguous shows
 * up here as a failure instead of passing silently. `Choice` questions are a different
 * matter: the stub reads those by their type and by the passage key in the instruction, so
 * they are allowed to be "unknown" to the wording classifier, and the test says so.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { AD_CATEGORIES } from "../shared/wire.ts";
import { buildAdQuestions } from "../src/ads.ts";
import { buildSearchQuestions, windowBlocks } from "../src/search.ts";
import { StubJudge, detectQuestionKind, rankPassage, tokenize, windowKeyFrom } from "../src/stub-judge.ts";
import { MAX_CHOICE_OPTIONS } from "../src/search.ts";
import type { AdCandidate } from "../shared/wire.ts";
import { makeBlocks, makeCandidate } from "./helpers.ts";

const ALL = AD_CATEGORIES;

test("every ad question is recognisable from its wording alone", () => {
  const candidates = [
    makeCandidate({ id: "a" }),
    makeCandidate({ id: "b", textLength: 300, inMainContent: true }),
  ];
  const plan = buildAdQuestions(candidates, ALL);

  for (const [key, question] of Object.entries(plan.questions)) {
    assert.equal(question.type, "noul");
    const kind = detectQuestionKind(String(question.instructions));
    assert.notEqual(kind, "unknown", `question "${key}" has wording the stub cannot classify`);
  }
});

test("each ad category's wording maps to that category, and the veto to the veto", () => {
  const plan = buildAdQuestions([makeCandidate({ id: "a", textLength: 300 })], ALL);
  const bySlot = new Map<string, string>();
  for (const slot of plan.slots) {
    const question = plan.questions[slot.key];
    bySlot.set(slot.category ?? "veto", detectQuestionKind(String(question?.instructions)));
  }

  assert.equal(bySlot.get("overlay"), "overlay");
  assert.equal(bySlot.get("sponsored"), "sponsored");
  assert.equal(bySlot.get("adslot"), "adslot");
  assert.equal(bySlot.get("veto"), "veto");
});

test("the ad and veto questions are told apart by wording, not by order", () => {
  const plan = buildAdQuestions(
    [makeCandidate({ id: "a" }), makeCandidate({ id: "b", textLength: 300 })],
    ALL,
  );
  const vetoSlot = plan.slots.find((slot) => slot.category === null);
  assert.ok(vetoSlot, "a long candidate should have earned a veto question");
  assert.equal(detectQuestionKind(String(plan.questions[vetoSlot.key]?.instructions)), "veto");
});

test("a search's existence questions are recognisable, and its ranking questions carry their window", () => {
  const windows = windowBlocks(makeBlocks(MAX_CHOICE_OPTIONS + 1));
  const plan = buildSearchQuestions("where is whitehouse", windows);

  for (const [key, question] of Object.entries(plan.questions)) {
    if (question.type === "noul") {
      assert.equal(
        detectQuestionKind(String(question.instructions)),
        "exists",
        `existence question "${key}" has unrecognisable wording`,
      );
      continue;
    }
    assert.equal(question.type, "choice");
    const windowKeys = windows.map((window) => window.key);
    assert.ok(
      windowKeys.includes(windowKeyFrom(String(question.instructions)) ?? ""),
      `ranking question "${key}" must reference one of the windows`,
    );
  }
});

// ---------------------------------------------------------------------------
// What the stub actually answers
// ---------------------------------------------------------------------------

test("the stub returns a probability in range for every question", async () => {
  const candidates = [makeCandidate({ id: "a" }), makeCandidate({ id: "b" })];
  const plan = buildAdQuestions(candidates, ALL);
  const result = await new StubJudge().ask({ page_url: "p", candidates }, plan.questions);

  for (const [key, answer] of Object.entries(result.answers)) {
    const typed = answer as { type: string; noul?: number };
    assert.equal(typed.type, "noul", key);
    assert.ok(
      typeof typed.noul === "number" && typed.noul >= 0 && typed.noul <= 1,
      `${key} produced ${String(typed.noul)}`,
    );
  }
});

test("the stub recognises a plainly labelled ad", async () => {
  const candidate = makeCandidate({ id: "a", text: "Advertisement", classes: ["ad-container"] });
  const plan = buildAdQuestions([candidate], ["adslot"]);
  const result = await new StubJudge().ask(
    { page_url: "p", candidates: [candidate] },
    plan.questions,
  );

  const slot = plan.slots.find((entry) => entry.category === "adslot");
  const answer = result.answers[slot?.key ?? ""] as { noul: number };
  assert.ok(answer.noul > 0.6, `expected a confident answer, got ${answer.noul}`);
});

test("the stub says nothing ad-like about plain prose", async () => {
  const candidate = makeCandidate({
    id: "a",
    idAttr: "",
    classes: [],
    text: "The committee met on Tuesday to discuss the annual budget.",
    reasons: [],
  });
  const plan = buildAdQuestions([candidate], ["adslot"]);
  const result = await new StubJudge().ask(
    { page_url: "p", candidates: [candidate] },
    plan.questions,
  );

  const slot = plan.slots.find((entry) => entry.category === "adslot");
  const answer = result.answers[slot?.key ?? ""] as { noul: number };
  assert.ok(answer.noul < 0.2, `expected a low answer, got ${answer.noul}`);
});

test("the stub treats a long main-content node as content", async () => {
  const candidate = makeCandidate({
    id: "a",
    inMainContent: true,
    textLength: 900,
    text: "The article body, which the reader came for.",
  });
  const plan = buildAdQuestions([candidate], ["overlay"]);
  const result = await new StubJudge().ask(
    { page_url: "p", candidates: [candidate] },
    plan.questions,
  );

  const veto = plan.slots.find((entry) => entry.category === null);
  assert.ok(veto, "a long in-main candidate earns a veto question");
  const answer = result.answers[veto.key] as { noul: number };
  assert.ok(answer.noul > 0.5, `the article should be flagged as content, got ${answer.noul}`);
});

test("the stub ranks a passage and rates whether it addresses the query", async () => {
  const windows = windowBlocks(makeBlocks(4));
  assert.equal(windows.length, 1);
  const plan = buildSearchQuestions("white house", windows);
  const state = {
    page_url: "p",
    query: "white house",
    passages: {
      w0: [
        "b000| The Metro opened in 1976 with vaulted concrete stations.",
        "b001| The building sits at 1600 Pennsylvania Avenue in the White House grounds.",
      ].join("\n"),
    },
  };

  const result = await new StubJudge().ask(state, plan.questions);
  const ranking = result.answers["where_w0"] as { probabilities: Record<string, number> };
  assert.ok(
    (ranking.probabilities["b001"] ?? 0) > (ranking.probabilities["b000"] ?? 0),
    "the passage that mentions the query should rank first",
  );

  const exists = result.answers["exists_w0"] as { noul: number };
  assert.ok(exists.noul > 0.5);
});

test("the stub prioritizes rare query keywords over ubiquitous context keywords", () => {
  const blocks = [
    "b000| Elon Musk was born in Pretoria, South Africa.",
    "b001| Elon Musk co-founded PayPal and later joined Tesla.",
    "b002| Elon Musk unveiled plans for Mars colonisation with SpaceX.",
    "b003| He has a younger brother, Kimbal, who is an entrepreneur and restaurateur.",
    "b004| In 1995, Elon Musk and his brother Kimbal founded Zip2.",
  ];
  const ranking = rankPassage("elon brother??", blocks.join("\n"));
  assert.ok(
    (ranking["b004"] ?? 0) > (ranking["b000"] ?? 0),
    "block with both terms should easily beat block with only ubiquitous term",
  );
  assert.ok(
    (ranking["b003"] ?? 0) > (ranking["b000"] ?? 0),
    "block with rare term 'brother' should beat block with ubiquitous term 'elon'",
  );
});

test("the stub reports no existence when a passage shares nothing with the query", async () => {
  const plan = buildSearchQuestions("how do I renew a passport", windowBlocks(makeBlocks(2)));
  const state = {
    page_url: "p",
    query: "how do I renew a passport",
    passages: { w0: "b000| The Metro opened in 1976 with vaulted concrete stations." },
  };

  const result = await new StubJudge().ask(state, plan.questions);
  const exists = result.answers["exists_w0"] as { noul: number };
  assert.ok(exists.noul < 0.2, `expected a low existence probability, got ${exists.noul}`);
});

test("the stub calls a single shared term partial, not answered", async () => {
  // Ticket 08: the offline stub must mirror the three-way verdict contract, and a stub
  // that can never emit partial does not. One shared word is weak evidence: it clears
  // the partial bar without reaching the answered one.
  const plan = buildSearchQuestions("where is the restaurateur", windowBlocks(makeBlocks(2)));
  const state = {
    page_url: "p",
    query: "where is the restaurateur",
    passages: {
      w0: [
        "b000| The Metro opened in 1976 with vaulted concrete stations.",
        "b001| He has a younger brother, Kimbal, who is an entrepreneur and restaurateur.",
      ].join("\n"),
    },
  };

  const result = await new StubJudge().ask(state, plan.questions);
  const exists = result.answers["exists_w0"] as { noul: number };
  assert.ok(
    exists.noul >= 0.2 && exists.noul < 0.5,
    `a lone shared term should read as partial under the 0.5/0.2 bars, got ${exists.noul}`,
  );
});

test("the stub bridges a spacing difference, which is the easy half of semantic matching", () => {
  // Compressed comparison: "whitehouse" and "White House" coincide once punctuation and
  // spaces are removed. Jev bridges far wider gaps than this; the stub does not, and the
  // limitation is worth stating rather than papering over.
  assert.deepEqual([...tokenize("White House")], ["white", "house"]);
  assert.deepEqual([...tokenize("whitehouse")], ["whitehouse"]);
});

test("the stub reads image evidence: an ad-network image host counts as advertising", async () => {
  const candidate = makeCandidate({
    id: "a",
    idAttr: "",
    classes: [],
    text: "Shop the new collection",
    reasons: ["image served by a known ad network"],
    imageKind: "img",
    imageHost: "securepubads.g.doubleclick.net",
    imageAlt: "Shop now",
  });
  const plan = buildAdQuestions([candidate], ["adslot"]);
  const result = await new StubJudge().ask(
    { page_url: "p", candidates: [candidate] },
    plan.questions,
  );

  const slot = plan.slots.find((entry) => entry.category === "adslot");
  const answer = result.answers[slot?.key ?? ""] as { noul: number };
  assert.ok(answer.noul > 0.6, `expected host evidence to convince, got ${answer.noul}`);
});

test("the stub reads image evidence: disclosure in alt text counts", async () => {
  const candidate = makeCandidate({
    id: "a",
    idAttr: "",
    classes: [],
    text: "",
    reasons: [],
    imageKind: "img",
    imageHost: "cdn.example.com",
    imageAlt: "Sponsored trail shoes",
  });
  const plan = buildAdQuestions([candidate], ["sponsored"]);
  const result = await new StubJudge().ask(
    { page_url: "p", candidates: [candidate] },
    plan.questions,
  );

  const slot = plan.slots.find((entry) => entry.category === "sponsored");
  const answer = result.answers[slot?.key ?? ""] as { noul: number };
  assert.ok(answer.noul > 0.6, `expected alt disclosure to convince, got ${answer.noul}`);
});

test("the stub treats a figure-captioned photo as content when nothing ad-like is present", async () => {
  const candidate = makeCandidate({
    id: "a",
    idAttr: "",
    classes: [],
    text: "The starting lineup",
    reasons: [],
    imageKind: "img",
    imageHost: "cdn.example.com",
    imageAlt: "The starting lineup",
    textLength: 30,
    inMainContent: true,
    inFigure: true,
  });
  const plan = buildAdQuestions([candidate], ["overlay"]);
  const result = await new StubJudge().ask(
    { page_url: "p", candidates: [candidate] },
    plan.questions,
  );

  const veto = plan.slots.find((entry) => entry.category === null);
  assert.ok(veto, "a figure image earns a veto question");
  const answer = result.answers[veto.key] as { noul: number };
  assert.ok(answer.noul > 0.5, `the figure photo should read as content, got ${answer.noul}`);
});

test("the stub reports usage, so cost accounting has something to work with", async () => {
  const candidates: AdCandidate[] = [makeCandidate({ id: "a" })];
  const plan = buildAdQuestions(candidates, ["overlay"]);
  const result = await new StubJudge().ask({ candidates }, plan.questions);

  assert.ok(result.inputTokens > 0);
  assert.ok(result.outputTokens > 0);
  assert.equal(result.model, "stub-1");
});
