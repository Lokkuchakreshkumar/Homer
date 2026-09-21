/**
 * Shortlist and guard rules.
 *
 * These are pure functions, so they are tested directly. The version of these rules that
 * runs against real HTML from the fixtures lives in `dom.test.ts`.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  AD_IMAGE_ALT_CHARS,
  BLOCK_RULES,
  NEVER_AD_TAGS,
  SHORTLIST_LIMITS,
  blockId,
  candidateSelector,
  cleanBlockText,
  countWords,
  disclosesAdvertising,
  imageHostOf,
  isAdNetwork,
  isEligibleBlock,
  isKnownEmbed,
  isResponsiveAdSize,
  mayRemove,
  pickOutermost,
  shortlistElement,
  splitSentenceSpans,
  toCandidate,
  toTextBlock,
  tokensOf,
} from "../src/heuristics.ts";
import type { ElementDescriptor } from "../src/heuristics.ts";

export const base: ElementDescriptor = {
  tag: "div",
  id: "",
  classes: [],
  role: "",
  ariaLabel: "",
  isIframe: false,
  iframeSrc: "",
  width: 600,
  height: 60,
  viewportRatio: 0.03,
  position: "static",
  zIndex: 0,
  textLength: 40,
  linkDensity: 0,
  inMainContent: false,
  text: "ordinary page text",
  imageKind: "none",
  imageHost: "",
  imageAlt: "",
  inFigure: false,
  hasProximityDisclosure: false,
};

export function d(overrides: Partial<ElementDescriptor> = {}): ElementDescriptor {
  return { ...base, ...overrides };
}

test("identifiers are split on separators and camelCase", () => {
  assert.deepEqual([...tokensOf("ad-container")].sort(), ["ad", "container"]);
  assert.deepEqual([...tokensOf("adContainer")].sort(), ["ad", "container"]);
  assert.deepEqual([...tokensOf("ad_container")].sort(), ["ad", "container"]);
});

test("token matching does not fire on substrings", () => {
  // The reason this is tokenised rather than substring-matched: "downloads" contains "ads".
  const downloads = shortlistElement(d({ id: "downloads-panel", classes: ["download-list"] }));
  assert.equal(downloads.eligible, false);
  assert.ok(tokensOf("download-list").has("download"));
  assert.ok(!tokensOf("download-list").has("ads"));
});

test("plain page furniture is not shortlisted", () => {
  for (const descriptor of [
    d({ id: "hero", classes: ["hero-section"], text: "Welcome to the site" }),
    d({ tag: "section", classes: ["content"] }),
    d({ id: "search", classes: ["search-box"], role: "search" }),
  ]) {
    assert.equal(shortlistElement(descriptor).eligible, false, JSON.stringify(descriptor.classes));
  }
});

test("never-ad tags are rejected before anything else", () => {
  for (const tag of NEVER_AD_TAGS) {
    const descriptor = d({ tag, id: "ad-slot", classes: ["ad-banner"], viewportRatio: 1 });
    const decision = shortlistElement(descriptor);
    assert.equal(decision.eligible, false, `\`${tag}\` must never be shortlisted`);
    assert.match(decision.reasons[0] ?? "", /never an ad container/);
  }
});

test("a known embed is rejected even when it is a third-party frame", () => {
  const player = d({
    tag: "iframe",
    isIframe: true,
    iframeSrc: "https://www.youtube.com/embed/abc",
    width: 560,
    height: 315,
  });
  assert.equal(shortlistElement(player).eligible, false);
  assert.equal(isKnownEmbed(player.iframeSrc), true);
});

test("an ad network frame is shortlisted and says why", () => {
  const frame = d({
    tag: "iframe",
    isIframe: true,
    iframeSrc: "https://securepubads.g.doubleclick.net/tag/js/gpt.js",
    width: 300,
    height: 250,
  });
  const decision = shortlistElement(frame);
  assert.equal(decision.eligible, true);
  assert.match(decision.reasons.join(" "), /known ad network/);
  assert.equal(isAdNetwork(frame.iframeSrc), true);
});

test("long link-sparse text is treated as content and never shortlisted", () => {
  const article = d({
    tag: "p",
    textLength: SHORTLIST_LIMITS.maxTextLength + 1,
    linkDensity: 0,
  });
  const decision = shortlistElement(article);
  assert.equal(decision.eligible, false);
  assert.match(decision.reasons[0] ?? "", /reads as content/);
});

test("link density is what rescues long text from the content filter", () => {
  const text = "x".repeat(SHORTLIST_LIMITS.maxTextLength + 1);
  const long = { text, textLength: text.length };

  // Long and link-sparse reads as an article, so it is dropped before any question is asked.
  assert.equal(shortlistElement(d({ classes: [], ...long, linkDensity: 0 })).eligible, false);

  // Long but link-dense does not read as an article. It still needs its own reason to be
  // worth a question, which the token supplies.
  assert.equal(
    shortlistElement(d({ classes: ["sponsor-links"], ...long, linkDensity: 5 })).eligible,
    true,
  );
  assert.equal(
    shortlistElement(d({ classes: ["link-list"], ...long, linkDensity: 5 })).eligible,
    false,
  );
});

test("a standard ad size is enough on its own", () => {
  const decision = shortlistElement(d({ id: "slot", classes: [], width: 300, height: 250 }));
  assert.equal(decision.eligible, true);
  assert.match(decision.reasons.join(" "), /standard ad size/);
});

test("a fixed overlay covering the viewport is shortlisted", () => {
  const decision = shortlistElement(d({ position: "fixed", viewportRatio: 0.9 }));
  assert.equal(decision.eligible, true);
  assert.match(decision.reasons.join(" "), /covering much of the viewport/);
});

test("a small fixed element like a cookie bar is not, on geometry alone", () => {
  const decision = shortlistElement(
    d({ id: "toolbar", classes: [], position: "fixed", viewportRatio: 0.05 }),
  );
  assert.equal(decision.eligible, false);
});

test("text that discloses advertising is shortlisted", () => {
  for (const disclosure of ["Sponsored", "Promoted", "Advertisement", "Paid partnership"]) {
    const decision = shortlistElement(d({ id: "card", classes: [], text: `${disclosure} — buy now` }));
    assert.equal(decision.eligible, true, disclosure);
  }
});

test("disclosure matching is case-insensitive and word-bounded", () => {
  assert.equal(shortlistElement(d({ classes: [], text: "SPONSORED content" })).eligible, true);
  // "sponsorship" is a different word and does not match the disclosure pattern.
  const word = d({ classes: [], text: "Our sponsorship of the local team continues." });
  assert.equal(shortlistElement(word).eligible, false);
});

test("the selector covers the tokens it is built from, plus frames and dialogs", () => {
  const selector = candidateSelector();
  for (const token of ["ad", "sponsor", "newsletter", "consent"]) {
    assert.ok(selector.includes(`[class*="${token}"]`), `selector should cover "${token}" by class`);
    assert.ok(selector.includes(`[id*="${token}"]`), `selector should cover "${token}" by id`);
  }
  // Frames and dialogs are matched by tag and role rather than by name, because the
  // elements people are most likely to want gone often have neither.
  assert.ok(selector.includes("iframe"));
  assert.ok(selector.includes("[role='dialog']"));
  assert.ok(selector.includes("[aria-modal='true']"));
});

// ---------------------------------------------------------------------------
// The client-side removal guard
// ---------------------------------------------------------------------------

test("the guard permits a plain, unattached, short element", () => {
  assert.equal(mayRemove(d()).ok, true);
});

test("the guard refuses anything the server policy also refuses", () => {
  const cases: [string, ElementDescriptor][] = [
    ["a protected tag", d({ tag: "main" })],
    ["content inside main", d({ inMainContent: true })],
    ["a very wordy node", d({ textLength: 401 })],
    ["a known embed", d({ tag: "iframe", isIframe: true, iframeSrc: "https://vimeo.com/1" })],
  ];
  for (const [label, descriptor] of cases) {
    const guard = mayRemove(descriptor);
    assert.equal(guard.ok, false, label);
    assert.ok(guard.reason.length > 0, `${label} needs a reason`);
  }
});

test("the guard allows an ad-network frame, which is not a known embed", () => {
  const frame = d({
    tag: "iframe",
    isIframe: true,
    iframeSrc: "https://ads.example.doubleclick.net/x",
    textLength: 0,
  });
  assert.equal(mayRemove(frame).ok, true);
});

// ---------------------------------------------------------------------------
// Nesting
// ---------------------------------------------------------------------------

test("only the outermost element of a nested group survives", () => {
  const kept = pickOutermost([
    { key: "wrapper", ancestors: [] },
    { key: "frame", ancestors: ["wrapper"] },
    { key: "unrelated", ancestors: ["body", "main"] },
    { key: "deep", ancestors: ["body", "wrapper", "frame"] },
  ]);
  assert.deepEqual(
    kept.map((candidate) => candidate.key),
    ["wrapper", "unrelated"],
  );
});

test("nesting only counts when an ancestor is itself a candidate", () => {
  const kept = pickOutermost([{ key: "lonely", ancestors: ["body", "main", "article"] }]);
  assert.equal(kept.length, 1);
});

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

test("block ids are stable, ordered, and short", () => {
  assert.equal(blockId(0), "b000");
  assert.equal(blockId(42), "b042");
  assert.equal(blockId(999), "b999");
});

test("blocks carry their own word count", () => {
  const block = toTextBlock(3, "one two three four five");
  assert.equal(block.id, "b003");
  assert.equal(block.words, 5);
  assert.equal(block.text, "one two three four five");
});

test("whitespace collapses so a block stays one line in the passage", () => {
  assert.equal(cleanBlockText("  a\n\n  b\t c  "), "a b c");
  const block = toTextBlock(0, "a\n\nb");
  assert.ok(!block.text.includes("\n"));
});

test("fragments are not eligible blocks", () => {
  assert.equal(isEligibleBlock("Read more"), false, "too short to be a result");
  assert.equal(isEligibleBlock("Home"), false);
  assert.equal(isEligibleBlock("one two three"), false, "below the word floor");
  assert.equal(isEligibleBlock("one two three four"), true);
  assert.equal(isEligibleBlock(""), false);
});

test("the word floor and its boundary are honest about the rule", () => {
  const below = Array.from({ length: BLOCK_RULES.minWords - 1 }, () => "word").join(" ");
  const at = Array.from({ length: BLOCK_RULES.minWords }, () => "word").join(" ");
  assert.equal(isEligibleBlock(below), false);
  assert.equal(isEligibleBlock(at), true);
  assert.equal(countWords(at), BLOCK_RULES.minWords);
});

test("a two-sentence paragraph splits into exact offset spans", () => {
  const raw = "First sentence here now. Second sentence follows here.";
  assert.deepEqual(splitSentenceSpans(raw), [
    { start: 0, end: 24 },
    { start: 25, end: 54 },
  ]);
});

test("sentence spans cover the raw text exactly, with nothing dropped or duplicated", () => {
  for (const raw of [
    "First sentence here now. Second sentence follows here.",
    "Really? Yes indeed! Absolutely.",
    'She said "go now." Then she left quietly.',
    "A single sentence with no terminator",
    "",
  ]) {
    const spans = splitSentenceSpans(raw);
    let cursor = 0;
    for (const span of spans) {
      assert.match(
        raw.slice(cursor, span.start),
        /^\s*$/,
        `only whitespace may sit between spans, before ${JSON.stringify(raw.slice(span.start, span.end))}`,
      );
      assert.ok(span.end > span.start, "a span must not be empty");
      cursor = span.end;
    }
    assert.match(raw.slice(cursor), /^\s*$/, "spans must reach the end of the raw text");
  }
});

test("splits happen on questions, exclamations, and quoted closings", () => {
  const raw = 'Really? Yes indeed! She said "go now." Then she left.';
  const sentences = splitSentenceSpans(raw).map((span) => raw.slice(span.start, span.end));
  assert.deepEqual(sentences, ['Really?', 'Yes indeed!', 'She said "go now."', 'Then she left.']);
});

test("initialisms, decimals, and lowercase continuations do not split", () => {
  assert.deepEqual(
    splitSentenceSpans("He came to the U.S.A. yesterday.").map((span) => span.start),
    [0],
    "U.S.A. is one sentence",
  );
  assert.equal(
    splitSentenceSpans("It costs 3.5 million dollars today.").length,
    1,
    "a decimal point is not a boundary",
  );
  assert.equal(
    splitSentenceSpans("it goes on and on, ever onward").length,
    1,
    "no terminator means one span",
  );
});

test("a candidate carries the shortened text and rounded geometry", () => {
  const long = "y".repeat(1000);
  const candidate = toCandidate("c7", d({ text: long, textLength: 1000, width: 300.6, height: 250.4, viewportRatio: 0.123456 }), [
    "reason one",
  ]);
  assert.equal(candidate.id, "c7");
  assert.equal(candidate.text.length, 240, "leaving text is truncated to the snippet length");
  assert.equal(candidate.width, 301);
  assert.equal(candidate.height, 250);
  assert.equal(candidate.viewportRatio, 0.123);
  assert.deepEqual(candidate.reasons, ["reason one"]);
});

// ---------------------------------------------------------------------------
// Ticket 05: compact image evidence (host-only, truncated alt)
// ---------------------------------------------------------------------------

test("only a host leaves the page, never a full image URL", () => {
  assert.equal(
    imageHostOf("https://cdn.ads.example.com/banner/hero.jpg?imp=abc123&user=42"),
    "cdn.ads.example.com",
    "tracking query strings never leave the page",
  );
  assert.equal(imageHostOf("https://EXAMPLE.COM:443/x.png"), "example.com");
  assert.equal(imageHostOf("data:image/png;base64,abcd"), "", "inline payloads have no host");
  assert.equal(imageHostOf("/relative/path.png"), "", "relative URLs have no host to send");
  assert.equal(imageHostOf(""), "");
  assert.equal(imageHostOf("not a url at all"), "");
});

test("a candidate carries compact image evidence under the snippet discipline", () => {
  const candidate = toCandidate(
    "c9",
    d({
      imageKind: "img",
      imageHost: "cdn.ads.example.com",
      imageAlt: "Sponsored running shoes — sale ends soon",
      inFigure: false,
    }),
    ["image served by a known ad network"],
  );
  assert.equal(candidate.imageKind, "img");
  assert.equal(candidate.imageHost, "cdn.ads.example.com");
  assert.equal(candidate.imageAlt, "Sponsored running shoes — sale ends soon");
  assert.equal(candidate.inFigure, false);

  const longAlt = "a".repeat(1000);
  const truncated = toCandidate("c10", d({ imageKind: "img", imageAlt: longAlt }), []);
  assert.equal(truncated.imageAlt.length, AD_IMAGE_ALT_CHARS);
});

test("the guard refuses figure-captioned units, which hide at most", () => {
  const guard = mayRemove(d({ imageKind: "img", inFigure: true }));
  assert.equal(guard.ok, false);
  assert.match(guard.reason, /figure/i);
});

// ---------------------------------------------------------------------------
// Ticket 04: image collection and shortlist (client signals + corroboration)
// ---------------------------------------------------------------------------

test("disclosure reads whole words, not substrings", () => {
  assert.equal(disclosesAdvertising("Sponsored running shoes"), true);
  assert.equal(disclosesAdvertising("A paid partnership with the brand"), true);
  assert.equal(disclosesAdvertising("This article is about sponsorship trends"), false);
  assert.equal(disclosesAdvertising("plain product photo"), false);
});

test("responsive ad ratios cover the common fluid shapes", () => {
  assert.equal(isResponsiveAdSize(728, 90), true, "fluid leaderboard");
  assert.equal(isResponsiveAdSize(300, 250), true, "fluid box");
  assert.equal(isResponsiveAdSize(160, 600), true, "fluid skyscraper");
  assert.equal(isResponsiveAdSize(320, 50), true, "mobile banner");
  assert.equal(isResponsiveAdSize(1280, 400), false, "hero image is not ad-shaped");
  assert.equal(isResponsiveAdSize(800, 500), false, "editorial figure is not ad-shaped");
  assert.equal(isResponsiveAdSize(300, 200), true, "thumbnail range matches: precision costs recall here");
  assert.equal(isResponsiveAdSize(0, 0), false);
});

test("an ad-network image host with ad ratios is shortlisted", () => {
  const decision = shortlistElement(
    d({ imageKind: "img", imageHost: "ads.doubleclick.net", width: 300, height: 250 }),
  );
  assert.equal(decision.eligible, true);
  assert.match(decision.reasons.join(" "), /known ad network/);
});

test("alt disclosure plus proximity disclosure corroborate each other", () => {
  const decision = shortlistElement(
    d({
      imageKind: "img",
      imageHost: "",
      imageAlt: "Sponsored offer",
      hasProximityDisclosure: true,
      width: 800,
      height: 500,
    }),
  );
  assert.equal(decision.eligible, true);
});

test("a lone alt disclosure is held for corroboration", () => {
  const decision = shortlistElement(
    d({ imageKind: "img", imageAlt: "Sponsored offer", width: 800, height: 500 }),
  );
  assert.equal(decision.eligible, false);
  assert.match(decision.reasons.join(" "), /corroboration/);
});

test("an image beside an article about advertising is held, not shortlisted", () => {
  // Proximity fires on the nearby "sponsored" mention, but it stands alone: no host,
  // no alt disclosure, plain dimensions — so the unit waits for a second signal.
  const decision = shortlistElement(
    d({ imageKind: "img", hasProximityDisclosure: true, width: 800, height: 500 }),
  );
  assert.equal(decision.eligible, false);
});

test("an editorial figure carries no image reasons at all", () => {
  const decision = shortlistElement(
    d({ imageKind: "img", imageAlt: "Mountain at dawn", width: 800, height: 500 }),
  );
  assert.equal(decision.eligible, false);
});

test("an exact ad size still shortlists an image on its own", () => {
  const decision = shortlistElement(d({ imageKind: "img", width: 300, height: 250 }));
  assert.equal(decision.eligible, true);
  assert.match(decision.reasons.join(" "), /standard ad size/);
});

test("a sponsor logo without corroboration is held, protecting editorial", () => {
  const decision = shortlistElement(
    d({ imageKind: "img", imageAlt: "Sponsored by Acme", width: 200, height: 120 }),
  );
  assert.equal(decision.eligible, false);
});

test("plain disclosure without image evidence keeps today's behavior", () => {
  const decision = shortlistElement(d({ text: "Sponsored post in the feed" }));
  assert.equal(decision.eligible, true);
});
