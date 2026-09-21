/**
 * Ad policy tests.
 *
 * These are the tests that matter most in the repository, because this is the code that
 * decides whether a node is deleted. Every guard the design promised gets its own case:
 * the removal floor, the content veto, protected tags, and graceful degradation when the
 * model comes back with nothing.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  AD_THRESHOLDS,
  buildAdQuestions,
  chunkCandidates,
  applyAdVerdicts,
  needsContentVeto,
  PROTECTED_TAGS,
} from "../src/ads.ts";
import type { QuestionPlan } from "../src/ads.ts";
import { AD_CATEGORIES, AD_REMOVE_TEXT_CAP } from "../shared/wire.ts";
import type { AdCategory } from "../shared/wire.ts";
import { makeCandidate } from "./helpers.ts";

/** Set one probability for every ad question and optionally one for every veto question. */
function noulsFor(plan: QuestionPlan, ad: number, veto = 0): Record<string, number> {
  const out: Record<string, number> = {};
  for (const slot of plan.slots) {
    out[slot.key] = slot.category === null ? veto : ad;
  }
  return out;
}

function decide(
  candidate: ReturnType<typeof makeCandidate>,
  enabled: readonly AdCategory[],
  ad: number,
  veto = 0,
) {
  const plan = buildAdQuestions([candidate], enabled);
  return applyAdVerdicts([candidate], enabled, plan, noulsFor(plan, ad, veto))[0];
}

/**
 * Per-category probabilities, which matters because `strongest` breaks ties by category
 * order. Tests that need a *specific* category to win — rather than whatever comes first
 * among equal probabilities — have to say so explicitly.
 */
function decideDetailed(
  candidate: ReturnType<typeof makeCandidate>,
  enabled: readonly AdCategory[],
  wanted: Partial<Record<AdCategory, number>>,
  veto = 0,
) {
  const plan = buildAdQuestions([candidate], enabled);
  const nouls: Record<string, number> = {};
  for (const slot of plan.slots) {
    nouls[slot.key] = slot.category === null ? veto : (wanted[slot.category] ?? 0);
  }
  return applyAdVerdicts([candidate], enabled, plan, nouls)[0];
}

const ALL: readonly AdCategory[] = AD_CATEGORIES;

test("an enabled category produces one question per candidate", () => {
  const candidates = [makeCandidate({ id: "c0" }), makeCandidate({ id: "c1" })];
  const plan = buildAdQuestions(candidates, ["overlay"]);

  assert.equal(plan.slots.filter((slot) => slot.category === "overlay").length, 2);
  assert.equal(Object.keys(plan.questions).length, plan.slots.length);
});

test("one question is asked per candidate per enabled category, and disabled categories are skipped", () => {
  const candidates = [makeCandidate({ id: "c0" }), makeCandidate({ id: "c1" })];
  const plan = buildAdQuestions(candidates, ["overlay", "adslot"]);

  const byCategory = (category: AdCategory) =>
    plan.slots.filter((slot) => slot.category === category).length;

  assert.equal(byCategory("overlay"), 2);
  assert.equal(byCategory("adslot"), 2);
  assert.equal(byCategory("sponsored"), 0);
  for (const slot of plan.slots) {
    assert.ok(AD_CATEGORIES.includes(slot.category as AdCategory));
  }
});

test("the content veto is asked only where removal is plausible", () => {
  const short = makeCandidate({ id: "short", textLength: 40, inMainContent: false });
  const long = makeCandidate({ id: "long", textLength: 300, inMainContent: false });
  const inMain = makeCandidate({ id: "main", textLength: 20, inMainContent: true });

  assert.equal(needsContentVeto(short), false);
  assert.equal(needsContentVeto(long), true);
  assert.equal(needsContentVeto(inMain), true);

  const plan = buildAdQuestions([short, long, inMain], ["overlay"]);
  const vetoes = plan.slots.filter((slot) => slot.category === null);
  assert.equal(vetoes.length, 2, "only the long and in-main candidates get a veto question");
});

test("neither the state nor the questions leak more than a snippet of element text", () => {
  const candidate = makeCandidate({ text: "x".repeat(5000), textLength: 5000 });
  const plan = buildAdQuestions([candidate], ["overlay"]);
  const serialised = JSON.stringify(plan.questions);
  assert.ok(!serialised.includes("x".repeat(300)), "questions must not embed element text");
});

test("a confident ad outside main content with short text is removed", () => {
  const verdict = decide(makeCandidate(), ALL, 0.96);
  assert.equal(verdict?.action, "remove");
  assert.equal(verdict?.category, "overlay");
  assert.match(verdict?.reason ?? "", /0\.96/);
});

test("the remove threshold is inclusive", () => {
  assert.equal(decide(makeCandidate(), ALL, AD_THRESHOLDS.remove)?.action, "remove");
  assert.equal(decide(makeCandidate(), ALL, AD_THRESHOLDS.remove - 0.01)?.action, "hide");
});

test("a mid-confidence ad is hidden rather than removed", () => {
  const verdict = decide(makeCandidate(), ALL, 0.72);
  assert.equal(verdict?.action, "hide");
  assert.match(verdict?.reason ?? "", /below remove threshold/);
});

test("the hide threshold is inclusive and below it nothing happens", () => {
  assert.equal(decide(makeCandidate(), ALL, AD_THRESHOLDS.hide)?.action, "hide");
  assert.equal(decide(makeCandidate(), ALL, AD_THRESHOLDS.hide - 0.01)?.action, "keep");
});

test("a confident ad inside main content is hidden, never removed", () => {
  const verdict = decide(makeCandidate({ inMainContent: true }), ALL, 0.99);
  assert.equal(verdict?.action, "hide");
  assert.match(verdict?.reason ?? "", /inside main content/);
});

test("a confident ad carrying a lot of text is hidden, never removed", () => {
  const verdict = decide(makeCandidate({ textLength: AD_REMOVE_TEXT_CAP + 1 }), ALL, 0.99);
  assert.equal(verdict?.action, "hide");
  assert.match(verdict?.reason ?? "", /characters of text/);
});

test("the text cap is inclusive", () => {
  assert.equal(
    decide(makeCandidate({ textLength: AD_REMOVE_TEXT_CAP }), ALL, 0.99)?.action,
    "remove",
  );
  assert.equal(
    decide(makeCandidate({ textLength: AD_REMOVE_TEXT_CAP + 1 }), ALL, 0.99)?.action,
    "hide",
  );
});

test("the content veto beats a confident ad verdict", () => {
  // Jev says both "this is a sponsored block" and "this is the reader's article". The
  // second answer has to win, because it is the one that protects the content. Sponsored
  // rather than overlay, so the overlay exception below does not apply.
  const verdict = decideDetailed(makeCandidate({ textLength: 300 }), ALL, { sponsored: 0.99 }, 0.87);
  assert.equal(verdict?.action, "keep");
  assert.match(verdict?.reason ?? "", /primary content/);
  assert.equal(verdict?.contentVeto, 0.87);
});

test("the veto threshold is inclusive", () => {
  const candidate = makeCandidate({ textLength: 300 });
  assert.equal(decideDetailed(candidate, ALL, { sponsored: 0.99 }, 0.5)?.action, "keep");
  assert.equal(decideDetailed(candidate, ALL, { sponsored: 0.99 }, 0.49)?.action, "remove");
});

test("a very confident overlay over the content is hidden, not kept", () => {
  // The one exception to the veto. A modal covering the article is still a modal: hiding it
  // returns the page to the reader, and `visibility` is reversible.
  const verdict = decideDetailed(makeCandidate({ textLength: 300 }), ALL, { overlay: 0.99 }, 0.9);
  assert.equal(verdict?.action, "hide");
  assert.match(verdict?.reason ?? "", /hidden but not removed/);
});

test("that overlay exception has a confidence floor and a content guard", () => {
  const candidate = makeCandidate({ textLength: 300 });
  // Below 0.97 the overlay does not get the exception.
  assert.equal(decideDetailed(candidate, ALL, { overlay: 0.96 }, 0.9)?.action, "keep");
  // Inside main content it never does.
  assert.equal(
    decideDetailed(makeCandidate({ textLength: 300, inMainContent: true }), ALL, { overlay: 0.99 }, 0.9)
      ?.action,
    "keep",
  );
  // And a vetoed sponsored block never does, however confident.
  assert.equal(decideDetailed(candidate, ALL, { sponsored: 1 }, 0.9)?.action, "keep");
});

test("protected tags are never acted on", () => {
  for (const tag of PROTECTED_TAGS) {
    const verdict = decide(makeCandidate({ tag }), ALL, 1);
    assert.equal(verdict?.action, "keep", `\`${tag}\` must never be removed`);
    assert.match(verdict?.reason ?? "", /protected structural element/);
  }
});

test("missing answers degrade to keep rather than to delete", () => {
  const candidate = makeCandidate();
  const plan = buildAdQuestions([candidate], ALL);
  // No answer at all: exactly what a truncated response or a model-side omission looks like.
  const verdict = applyAdVerdicts([candidate], ALL, plan, {})[0];
  assert.equal(verdict?.action, "keep");
  assert.equal(verdict?.probability, 0);
});

test("the winning category is the highest-probability enabled one", () => {
  const candidate = makeCandidate({ idAttr: "sponsored-slot" });
  const plan = buildAdQuestions([candidate], ALL);
  const wanted: Record<string, number> = { overlay: 0.2, sponsored: 0.95, adslot: 0.4 };
  const nouls: Record<string, number> = {};
  for (const slot of plan.slots) {
    nouls[slot.key] = slot.category === null ? 0 : (wanted[slot.category] ?? 0);
  }

  const verdict = applyAdVerdicts([candidate], ALL, plan, nouls)[0];
  assert.equal(verdict?.category, "sponsored");
  assert.equal(verdict?.probability, 0.95);
  assert.equal(verdict?.probabilities.overlay, 0.2);
  assert.equal(verdict?.probabilities.adslot, 0.4);
});

test("a disabled category leaves no probability behind", () => {
  const candidate = makeCandidate();
  const plan = buildAdQuestions([candidate], ["overlay"]);
  const verdict = applyAdVerdicts([candidate], ["overlay"], plan, noulsFor(plan, 0.99))[0];
  assert.equal(verdict?.category, "overlay");
  assert.equal(verdict?.probabilities.sponsored, undefined);
  assert.equal(verdict?.probabilities.adslot, undefined);
});

test("verdicts keep the caller's order and cover every candidate once", () => {
  const candidates = [
    makeCandidate({ id: "a" }),
    makeCandidate({ id: "b" }),
    makeCandidate({ id: "c" }),
  ];
  const plan = buildAdQuestions(candidates, ALL);
  const verdicts = applyAdVerdicts(candidates, ALL, plan, noulsFor(plan, 0.95));
  assert.deepEqual(
    verdicts.map((verdict) => verdict.id),
    ["a", "b", "c"],
  );
});

// ---------------------------------------------------------------------------
// Ticket 05: image judgment and structural veto
// ---------------------------------------------------------------------------

test("an image candidate earns a content-veto question even with short text outside main", () => {
  const image = makeCandidate({
    id: "img",
    textLength: 20,
    inMainContent: false,
    imageKind: "img",
    imageHost: "cdn.example.com",
    imageAlt: "A photo",
    inFigure: false,
  });
  assert.equal(needsContentVeto(image), true);

  const plan = buildAdQuestions([image], ["sponsored"]);
  assert.ok(
    plan.slots.some((slot) => slot.category === null),
    "image candidates get a veto question",
  );
});

test("a figure-captioned unit earns a veto question", () => {
  const figure = makeCandidate({ id: "fig", textLength: 20, inMainContent: false, inFigure: true });
  assert.equal(needsContentVeto(figure), true);
});

test("a vetoed image with strong ad signal hides instead of keeping or removing", () => {
  const image = makeCandidate({
    textLength: 300,
    imageKind: "img",
    imageHost: "ads.example-cdn.com",
    imageAlt: "Sponsored running shoes",
    inFigure: true,
  });
  const verdict = decideDetailed(image, ALL, { sponsored: 0.99 }, 0.87);
  assert.equal(verdict?.action, "hide");
  assert.match(verdict?.reason ?? "", /image/i);
});

test("a vetoed image with weak ad signal is kept", () => {
  const image = makeCandidate({
    textLength: 300,
    imageKind: "img",
    imageHost: "cdn.example.com",
    imageAlt: "A team photo",
    inFigure: true,
  });
  const verdict = decideDetailed(image, ALL, { sponsored: 0.07 }, 0.9);
  assert.equal(verdict?.action, "keep");
});

test("a high-confidence image outside content and outside figures is removed", () => {
  const image = makeCandidate({
    imageKind: "img",
    imageHost: "ads.example-cdn.com",
    imageAlt: "Limited offer",
    inFigure: false,
    inMainContent: false,
    textLength: 20,
  });
  const verdict = decideDetailed(image, ALL, { adslot: 0.96 }, 0);
  assert.equal(verdict?.action, "remove");
  assert.match(verdict?.reason ?? "", /ads\.example-cdn\.com/);
});

test("a high-confidence image inside a figure hides but is never removed", () => {
  const image = makeCandidate({
    imageKind: "picture",
    imageHost: "ads.example-cdn.com",
    imageAlt: "Sponsored watch",
    inFigure: true,
    inMainContent: false,
    textLength: 20,
  });
  const verdict = decideDetailed(image, ALL, { sponsored: 0.99 }, 0);
  assert.equal(verdict?.action, "hide");
  assert.match(verdict?.reason ?? "", /figure/i);
});

test("a covering image overlay outside content hides like its iframe cousins", () => {
  const overlay = makeCandidate({
    imageKind: "img",
    imageHost: "promo.example.com",
    imageAlt: "Get the app",
    textLength: 300,
    inMainContent: false,
    inFigure: false,
    position: "fixed",
    viewportRatio: 0.9,
    zIndex: 9999,
  });
  const verdict = decideDetailed(overlay, ALL, { overlay: 0.99 }, 0.9);
  assert.equal(verdict?.action, "hide");
});

test("an editorial figure with no ad signal survives untouched", () => {
  const editorial = makeCandidate({
    tag: "figure",
    imageKind: "img",
    imageHost: "cdn.example.com",
    imageAlt: "The starting lineup",
    textLength: 30,
    inMainContent: true,
    inFigure: true,
  });
  const verdict = decideDetailed(
    editorial,
    ALL,
    { overlay: 0.05, sponsored: 0.07, adslot: 0.06 },
    0.9,
  );
  assert.equal(verdict?.action, "keep");
});

test("candidates are chunked so no request carries too many questions", () => {
  const size = AD_THRESHOLDS.maxCandidatesPerRequest;
  const candidates = Array.from({ length: size * 2 + 5 }, (_, index) =>
    makeCandidate({ id: `c${index}` }),
  );
  const chunks = chunkCandidates(candidates);

  assert.equal(chunks.length, 3);
  assert.equal(chunks[0]?.length, size);
  assert.equal(chunks[2]?.length, 5);
  assert.equal(
    chunks.reduce((sum, chunk) => sum + chunk.length, 0),
    candidates.length,
    "chunking must not drop candidates",
  );
});
