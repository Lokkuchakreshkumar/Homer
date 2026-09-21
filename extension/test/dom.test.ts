/**
 * The DOM adapter, exercised over the real fixture pages.
 *
 * This is the test that makes `fixtures/ads.html` a regression target rather than a demo.
 * It parses the fixture, runs the actual extraction and shortlisting code over it, and
 * checks the result against the `data-expect` annotations a reader can also verify by
 * loading the page in a browser.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { extractBlocks, hasNearbyDisclosure, scanForAds } from "../src/dom.ts";
import { describeElement } from "../src/dom.ts";
import { candidateSelector, mayRemove } from "../src/heuristics.ts";
import { AD_REMOVE_TEXT_CAP } from "../shared/wire.ts";
import { parseHTML } from "linkedom";
import { ADS_LAYOUT, fixtureText, measurerFor, parseFixture } from "./harness.ts";

const adsDocument = parseFixture("ads.html");
const adsMeasurer = measurerFor(ADS_LAYOUT);

type Scan = ReturnType<typeof scanForAds>[number];

/** Identify a scan result the way the fixture labels it: by id, else by tag. */
function label(element: Element): string {
  return element.getAttribute("id") || element.tagName.toLowerCase();
}

function scannedByLabel(): Map<string, Scan> {
  const map = new Map<string, Scan>();
  for (const result of scanForAds(adsDocument, adsMeasurer)) {
    map.set(label(result.element), result);
  }
  return map;
}

const scanned = scannedByLabel();

test("the fixture shortlists every element it annotates as an ad", () => {
  for (const id of [
    "ad-leaderboard",
    "newsletter-modal",
    "sponsored-card-1",
    "ad-iframe-wrap",
    "outbrain-feed",
    "sponsored-in-feed",
    "promo-sticky",
    "story-teaser-2",
  ]) {
    assert.ok(scanned.has(id), `${id} should have been shortlisted`);
  }
});

test("the fixture's non-ads are not shortlisted", () => {
  // The article body is the element this whole feature must never touch.
  assert.equal(scanned.has("main"), false, "main is a protected tag");
  assert.equal(scanned.has("article"), false, "article is a protected tag");
  assert.equal(scanned.has("site-nav"), false, "nav is a protected tag");
  assert.equal(scanned.has("youtube-player"), false, "a YouTube embed is recognised and skipped");
  assert.equal(scanned.has("note"), false, "ordinary page text with nothing ad-shaped about it");
});

test("an ad wrapper and the frame inside it do not both become candidates", () => {
  // Both look like ads. The wrapper wins, because removing it takes the frame with it and
  // asking about both would spend two questions on one thing.
  assert.ok(scanned.has("ad-iframe-wrap"));
  assert.equal(scanned.has("google-ads-frame"), false);
});

test("the consent dialog is shortlisted, which is the judgement the model has to make", () => {
  // Structurally a fixed dialog with "consent" in its class: every local signal says
  // "overlay". It is only saved by the model reading its text and the `no` criteria.
  const dialog = scanned.get("cookie-consent");
  assert.ok(dialog, "the dialog should reach the model rather than being filtered locally");
  assert.equal(
    mayRemove(dialog.descriptor).ok,
    true,
    "nothing structural forbids hiding or removing it, so the model has to say no",
  );
});

test("descriptors carry the geometry and position the policy reads", () => {
  const modal = scanned.get("newsletter-modal");
  assert.ok(modal);
  assert.equal(modal.descriptor.position, "fixed");
  assert.equal(modal.descriptor.zIndex, 9999);
  assert.equal(modal.descriptor.viewportRatio, 1, "a full-viewport interstitial covers 1.0");
  assert.equal(modal.descriptor.inMainContent, false);

  const inFeed = scanned.get("sponsored-in-feed");
  assert.ok(inFeed);
  assert.equal(inFeed.descriptor.inMainContent, true, "it sits inside <main>");

  const frame = scanned.get("ad-iframe-wrap");
  assert.ok(frame);
  assert.equal(frame.descriptor.width, 300);
  assert.equal(frame.descriptor.height, 250);
});

test("shortlisting records the reason, so a decision can be explained", () => {
  assert.ok((scanned.get("ad-leaderboard")?.reasons.length ?? 0) > 0);
  assert.match((scanned.get("ad-leaderboard")?.reasons ?? []).join(" "), /ad|leaderboard|ad size/i);
  assert.match(
    (scanned.get("story-teaser-2")?.reasons ?? []).join(" "),
    /standard ad size/,
    "the unlabelled native ad is reached by geometry alone",
  );
});

test("the fixture really does push its feed widget past the removal cap", () => {
  // The annotation claims the text cap is what saves this node. Verify the claim rather
  // than trusting it: if the fixture text is shortened later, this fails.
  const feed = scanned.get("outbrain-feed");
  assert.ok(feed, "the paid feed widget should be shortlisted");
  assert.ok(
    feed.descriptor.textLength > AD_REMOVE_TEXT_CAP,
    `the feed widget carries ${feed.descriptor.textLength} characters, which must exceed the ${AD_REMOVE_TEXT_CAP} cap`,
  );
  assert.equal(mayRemove(feed.descriptor).ok, false);
});

test("the fixture's own annotations still say what this test asserts", () => {
  // Tie the annotations to the assertions so the two cannot drift apart silently.
  const html = fixtureText("ads.html");
  for (const id of ["ad-leaderboard", "newsletter-modal", "sponsored-card-1", "promo-sticky"]) {
    assert.match(
      html,
      new RegExp(`id="${id}"[^>]*data-expect="remove"`),
      `${id} should still be annotated data-expect="remove"`,
    );
  }
  for (const id of ["outbrain-feed", "sponsored-in-feed"]) {
    assert.match(html, new RegExp(`id="${id}"[^>]*data-expect="hide"`));
  }
  for (const id of ["cookie-consent", "site-nav"]) {
    assert.match(html, new RegExp(`id="${id}"[^>]*data-expect="keep"`));
  }
});

test("nothing inside main content is ever reported as safe to remove", () => {
  for (const [name, result] of scanned) {
    if (!result.descriptor.inMainContent && result.descriptor.tag !== "main") continue;
    assert.equal(mayRemove(result.descriptor).ok, false, `${name} is inside main`);
  }
});

// ---------------------------------------------------------------------------
// Block extraction, over the semantic find fixture
// ---------------------------------------------------------------------------

const articleDocument = parseFixture("article.html");
const articleMeasurer = measurerFor({ body: { width: 1280, height: 800 } });
const articleBlocks = extractBlocks(articleDocument, articleMeasurer);

test("the article fixture yields sequential blocks", () => {
  assert.ok(articleBlocks.length >= 8, `expected a page of blocks, got ${articleBlocks.length}`);
  assert.deepEqual(
    articleBlocks.map((entry) => entry.block.id),
    articleBlocks.map((_entry, index) => `b${index.toString().padStart(3, "0")}`),
  );
});

test("every block is text a reader could actually be shown", () => {
  for (const entry of articleBlocks) {
    assert.ok(entry.block.words >= 4, `${entry.block.id} is a fragment`);
    assert.ok(entry.block.text.length > 0);
    assert.ok(!entry.block.text.includes("\n"), "a block must stay one line in the passage");
  }
});

test("the paragraphs the search fixture is built around are all blocks", () => {
  const text = articleBlocks.map((entry) => entry.block.text).join("\n");
  // The literal match...
  assert.match(text, /The White House is the official residence/);
  // ...and the two semantic ones, which share no wording with the query at all.
  assert.match(text, /1600 Pennsylvania Avenue NW/);
  assert.match(text, /known as the Executive Mansion/);
});

test("navigation and headings are not mistaken for prose", () => {
  // The heading is a block, but a one-word heading is not: the word floor keeps the
  // option list to things a model can actually reason about.
  const titles = articleBlocks.map((entry) => entry.block.text);
  assert.ok(!titles.includes("Washington, D.C."), "a bare heading is not worth an option");
  assert.ok(titles.includes("Getting around") || titles.every((title) => title.length > 20));
});

test("each block carries at least one highlightable range", () => {
  for (const entry of articleBlocks) {
    assert.ok(entry.ranges.length >= 1, `${entry.block.id} has no range to highlight`);
  }
});

test("a multi-sentence paragraph yields one block per sentence", () => {
  const { document } = parseHTML(
    "<html><body><p>First sentence stands here now. Second sentence follows along here. Third sentence closes it out.</p></body></html>",
  );
  const blocks = extractBlocks(document as unknown as Document, measurerFor({}));
  assert.deepEqual(
    blocks.map((entry) => entry.block.text),
    [
      "First sentence stands here now.",
      "Second sentence follows along here.",
      "Third sentence closes it out.",
    ],
  );
  assert.deepEqual(
    blocks.map((entry) => entry.block.id),
    ["b000", "b001", "b002"],
  );
  for (const entry of blocks) {
    assert.ok(entry.ranges.length >= 1, `${entry.block.id} has no range to highlight`);
  }
});

test("an element's spans join back to its full text, dropping nothing", () => {
  const literal = articleDocument.querySelector("#para-semantic-mansion");
  assert.ok(literal, "the fixture should keep its annotated paragraph");
  const spans = articleBlocks.filter((entry) => entry.element === literal);
  assert.ok(spans.length > 1, "a three-sentence paragraph should yield several spans");
  assert.equal(
    spans.map((entry) => entry.block.text).join(" "),
    (literal.textContent ?? "").replace(/\s+/g, " ").trim(),
  );
});

test("a heading rides beside its paragraph as separate blocks", () => {
  const { document } = parseHTML(
    "<html><body><h2>Getting around town today</h2><p>First sentence here now. Second sentence follows here.</p></body></html>",
  );
  const blocks = extractBlocks(document as unknown as Document, measurerFor({}));
  assert.deepEqual(
    blocks.map((entry) => entry.block.text),
    [
      "Getting around town today",
      "First sentence here now.",
      "Second sentence follows here.",
    ],
  );
});

test("list items split into sentences without sharing text", () => {
  const { document } = parseHTML(
    "<html><body><ul><li>First list item states its case clearly. It adds a second sentence here.</li><li>Second item keeps to one sentence only.</li></ul></body></html>",
  );
  const blocks = extractBlocks(document as unknown as Document, measurerFor({}));
  assert.deepEqual(
    blocks.map((entry) => entry.block.text),
    [
      "First list item states its case clearly.",
      "It adds a second sentence here.",
      "Second item keeps to one sentence only.",
    ],
  );
});

test("a single-sentence element keeps the whole-element block", () => {  const { document } = parseHTML(
    "<html><body><p>This entire paragraph is one single sentence only.</p></body></html>",
  );
  const blocks = extractBlocks(document as unknown as Document, measurerFor({}));
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0]?.block.text, "This entire paragraph is one single sentence only.");
});

test("a block's text is the element's text with whitespace collapsed", () => {
  const literal = articleBlocks.find(
    (entry) => entry.element.getAttribute("id") === "para-semantic-address",
  );
  assert.ok(literal, "the address paragraph should yield spans");
  assert.equal(
    literal.block.text,
    "The building sits at 1600 Pennsylvania Avenue NW, a short walk from Lafayette Square.",
    "a span holds its own sentence, not the whole paragraph",
  );
});

test("nested blocks collapse to the innermost one, so text is not offered twice", () => {
  const { document } = parseHTML(
    "<html><body><ul><li>Outer list item text that is long enough to qualify.<p>Inner paragraph text that is also long enough.</p></li></ul></body></html>",
  );
  const blocks = extractBlocks(document as unknown as Document, measurerFor({}));
  assert.equal(blocks.length, 1, "one piece of text should yield one option");
  assert.match(blocks[0]?.block.text ?? "", /Inner paragraph/);
});

test("invisible text is never searched", () => {
  const { document } = parseHTML(
    "<html><body><p id='visible'>This paragraph is visible to the reader.</p><p id='hidden'>This paragraph is hidden from view entirely.</p></body></html>",
  );
  const measurer = measurerFor({ "#hidden": { width: 600, height: 0 } });
  const blocks = extractBlocks(document as unknown as Document, measurer);
  const text = blocks.map((entry) => entry.block.text).join("\n");
  assert.match(text, /visible to the reader/);
  assert.ok(!text.includes("hidden from view"), "zero-height text must be skipped");
});

test("the block cap is respected on a long page", () => {
  const paragraphs = Array.from(
    { length: 30 },
    (_unused, index) => `<p>Paragraph number ${index} with enough words to qualify as a block.</p>`,
  ).join("");
  const { document } = parseHTML(`<html><body>${paragraphs}</body></html>`);
  const blocks = extractBlocks(document as unknown as Document, measurerFor({}), 10);
  assert.equal(blocks.length, 10);
  assert.equal(blocks.at(-1)?.block.id, "b009");
});

// ---------------------------------------------------------------------------
// Ticket 04: image collection — descriptors, proximity, and fixture scans
// ---------------------------------------------------------------------------

test("candidate selection reaches token-less images", () => {
  const selector = candidateSelector();
  assert.ok(selector.includes("img"), "bare images must be collected");
  assert.ok(selector.includes("picture"), "responsive images must be collected");
});

function described(html: string, id: string) {
  const { document } = parseHTML(`<html><body>${html}</body></html>`);
  const doc = document as unknown as Document;
  const element = doc.querySelector(`#${id}`);
  assert.ok(element, `expected #${id} in the test document`);
  return describeElement(element, measurerFor({}));
}

test("an ad-network image populates kind, host, and alt", () => {
  const descriptor = described(
    `<img id="shot" src="https://ads.doubleclick.net/cre/300x250.jpg?imp=1" alt="Advertisement">`,
    "shot",
  );
  assert.equal(descriptor.imageKind, "img");
  assert.equal(descriptor.imageHost, "ads.doubleclick.net");
  assert.equal(descriptor.imageAlt, "Advertisement");
});

test("a wrapper reads its nested image's host and alt", () => {
  const descriptor = described(
    `<div id="wrap"><img src="https://cdn.ads.example.com/b.jpg" alt="Sale"></div>`,
    "wrap",
  );
  assert.equal(descriptor.imageKind, "img");
  assert.equal(descriptor.imageHost, "cdn.ads.example.com");
  assert.equal(descriptor.imageAlt, "Sale");
});

test("a relative image source yields no host to send", () => {
  const descriptor = described(`<img id="shot" src="/photos/mountain.jpg" alt="Dawn">`, "shot");
  assert.equal(descriptor.imageKind, "img");
  assert.equal(descriptor.imageHost, "");
  assert.equal(descriptor.imageAlt, "Dawn");
});

test("a source-only picture names its first srcset host", () => {
  const descriptor = described(
    `<picture id="shot"><source srcset="https://cdn.ads.example.com/a-2x.jpg 2x, https://cdn.ads.example.com/a-1x.jpg 1x"></picture>`,
    "shot",
  );
  assert.equal(descriptor.imageKind, "picture");
  assert.equal(descriptor.imageHost, "cdn.ads.example.com");
});

test("alt falls back to the aria-label per the decided model", () => {
  const descriptor = described(
    `<div id="shot" role="img" aria-label="Sponsored product shot"><img src="/i.jpg"></div>`,
    "shot",
  );
  assert.equal(descriptor.imageAlt, "Sponsored product shot");
});

test("a background-image URL yields a host, never the URL", () => {
  const descriptor = described(
    `<div id="bg" style="background-image: url('https://cdn.ads.example.com/b.jpg?imp=9')">Sale</div>`,
    "bg",
  );
  assert.equal(descriptor.imageKind, "background");
  assert.equal(descriptor.imageHost, "cdn.ads.example.com");
  assert.ok(!descriptor.imageHost.includes("?"), "tracking strings stay on the page");
});

test("an inline background image marks the element", () => {
  const descriptor = described(
    `<div id="bg" style="background-image: url('https://cdn.ads.example.com/b.jpg')">Sale</div>`,
    "bg",
  );
  assert.equal(descriptor.imageKind, "background");
});

test("plain elements carry empty image evidence", () => {
  const descriptor = described(`<div id="plain">Just some ordinary text here.</div>`, "plain");
  assert.equal(descriptor.imageKind, "none");
  assert.equal(descriptor.imageHost, "");
  assert.equal(descriptor.imageAlt, "");
  assert.equal(descriptor.hasProximityDisclosure, false);
});

test("a bare picture is not itself a captioned structure, but its contents are", () => {
  // Ticket 08 caught the self-match: closest() includes the element itself, which capped
  // every picture creative at hide. The creative container is judged on its own signals;
  // protection covers content nested inside figure/picture structures.
  const bare = described(
    `<picture id="shot"><source srcset="https://cdn.ads.example.com/a.jpg 1x"></picture>`,
    "shot",
  );
  assert.equal(bare.inFigure, false);

  const nested = described(
    `<picture><img id="shot" src="https://cdn.ads.example.com/a.jpg" alt="Dawn"></picture>`,
    "shot",
  );
  assert.equal(nested.inFigure, true);

  const figure = described(`<figure id="shot"><img src="/p.jpg" alt="Dawn"></figure>`, "shot");
  assert.equal(figure.inFigure, true);
});

function proximityDoc(html: string): Document {
  const { document } = parseHTML(`<html><body>${html}</body></html>`);
  return document as unknown as Document;
}

function disclosesNear(html: string): boolean {
  const unit = proximityDoc(html).querySelector("#unit");
  assert.ok(unit, "the test document should carry #unit");
  return hasNearbyDisclosure(unit);
}

test("a sponsored figcaption discloses for its figure", () => {
  assert.equal(
    disclosesNear(
      `<figure id="unit"><img src="/i.jpg" alt="Shoes"><figcaption>Sponsored</figcaption></figure>`,
    ),
    true,
  );
});

test("an adjacent disclosure badge discloses for its neighbour", () => {
  assert.equal(
    disclosesNear(
      `<div><span>Promoted</span><div id="unit"><img src="/i.jpg" alt="Shoes"></div></div>`,
    ),
    true,
  );
});

test("unrelated page text does not disclose for a distant image", () => {
  assert.equal(
    disclosesNear(
      `<div><p>An article about sponsorship trends in local news.</p><section><div id="unit"><img src="/i.jpg" alt="Chart"></div></section></div>`,
    ),
    false,
  );
});

test("the fixture shortlists image ads with their reasons", () => {
  const network = scanned.get("img-ad-network");
  assert.ok(network, "the ad-network image should be shortlisted");
  assert.match(network.reasons.join(" "), /known ad network/);
  const captioned = scanned.get("img-native-caption");
  assert.ok(captioned, "the captioned native unit should be shortlisted");
  assert.match(captioned.reasons.join(" "), /nearby text discloses/);
  const background = scanned.get("img-bg-promo");
  assert.ok(background, "the background-image creative should be shortlisted");
  assert.equal(scanned.has("img"), false, "a nested img must not double its figure");
});

test("editorial and held images are not shortlisted", () => {
  assert.equal(scanned.has("img-editorial"), false, "an editorial figure is not an ad");
  assert.equal(
    scanned.has("img-chart-note"),
    false,
    "a lone nearby mention waits for corroboration",
  );
  assert.equal(scanned.has("site-brand"), false, "a brand logo carries no ad signal at all");
});
