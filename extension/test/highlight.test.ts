/**
 * The fallback paint path: `<mark>` wrapping where the Custom Highlight API is absent.
 *
 * Node has no `CSS.highlights`, so constructing a Highlighter here always takes the
 * marks path — which is exactly the contract pinned here. linkedom's `Range` is a
 * partial stub (`startContainer` is undefined, `surroundContents` is a no-op), so DOM
 * wrapping itself is verified in-browser (ticket acceptance); here we pin everything
 * around it: technique selection, stylesheet install, and no-throw safety.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";

import {
  HIGHLIGHT_ACTIVE,
  HIGHLIGHT_LOOSE,
  HIGHLIGHT_STRONG,
  Highlighter,
  customHighlightsAvailable,
  highlightStylesheetText,
  installHighlightStylesheet,
} from "../src/content/highlight.ts";

function doc(): Document {
  const { document } = parseHTML("<html><head></head><body><p>Text</p></body></html>");
  return document as unknown as Document;
}

test("the Custom Highlight API reads as unavailable here, so marks apply", () => {
  assert.equal(customHighlightsAvailable(), false);
  assert.equal(new Highlighter().technique, "marks");
});

test("highlight tier names are stable", () => {
  assert.equal(HIGHLIGHT_STRONG, "jev-hit-strong");
  assert.equal(HIGHLIGHT_LOOSE, "jev-hit-loose");
  assert.equal(HIGHLIGHT_ACTIVE, "jev-hit-active");
});

test("paint installs the document stylesheet exactly once and tolerates empty ranges", () => {
  const document = doc();
  const highlighter = new Highlighter();
  highlighter.paint(document, [], []);
  highlighter.paint(document, [], []);
  assert.equal(document.querySelectorAll("#jev-highlight-style").length, 1);
  highlighter.clear(document);
});

test("clear and deactivation are safe with nothing painted", () => {
  const document = doc();
  const highlighter = new Highlighter();
  highlighter.clear(document);
  highlighter.setActive(null);
});

test("installing the stylesheet directly is idempotent", () => {
  const document = doc();
  installHighlightStylesheet(document);
  installHighlightStylesheet(document);
  assert.equal(document.querySelectorAll("#jev-highlight-style").length, 1);
});

// ---------------------------------------------------------------------------
// Ticket 07: Variant A tier colors carry fixed meanings (prototype values)
// ---------------------------------------------------------------------------

test("tiers paint the prototype's fixed meanings: amber answer, slate context, vivid active", () => {
  const rules = highlightStylesheetText().split("\n");
  const ruleFor = (name: string): string => rules.find((rule) => rule.includes(name)) ?? "";
  // Answer span: amber. Context spans: slate-blue. Active focus: vivid cyan.
  assert.ok(
    ruleFor(HIGHLIGHT_STRONG).includes("rgba(245, 158, 11, 0.45)"),
    "the answer tier must stay amber",
  );
  assert.ok(
    ruleFor(HIGHLIGHT_LOOSE).includes("rgba(99, 132, 172, 0.30)"),
    "the context tier must stay slate-blue",
  );
  assert.ok(ruleFor(HIGHLIGHT_ACTIVE).includes("#38bdf8"), "the active focus must stay vivid cyan");
  assert.ok(
    !ruleFor(HIGHLIGHT_ACTIVE).includes("245, 158, 11") &&
      !ruleFor(HIGHLIGHT_ACTIVE).includes("99, 132, 172"),
    "active must not reuse a tier color",
  );
});

test("the mark fallback mirrors the same three tier colors", () => {
  const rules = highlightStylesheetText().split("\n");
  const markRule = (selector: string): string =>
    rules.find((rule) => rule.includes(selector)) ?? "";
  // The bare mark selector paints the answer; the qualified ones paint context/active.
  const answer = rules.find(
    (rule) =>
      rule.includes("mark[data-jev-hit]") &&
      !rule.includes('="loose"') &&
      !rule.includes('="active"'),
  ) ?? "";
  assert.ok(answer.includes("rgba(245, 158, 11, 0.45)"), "fallback answer stays amber");
  assert.ok(
    markRule('mark[data-jev-hit="loose"]').includes("rgba(99, 132, 172, 0.30)"),
    "fallback context stays slate-blue",
  );
  assert.ok(
    markRule('mark[data-jev-hit="active"]').includes("#38bdf8"),
    "fallback active stays vivid cyan",
  );
});
