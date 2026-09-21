/**
 * Shared test fixtures.
 *
 * `makeCandidate` defaults to a textbook removable ad so each test can override exactly
 * the one field it is about. That keeps a failure readable: if the default changed, every
 * test would move at once and none of them would say why.
 */

import type { AdCandidate, TextBlock } from "../shared/wire.ts";

export function makeCandidate(overrides: Partial<AdCandidate> = {}): AdCandidate {
  return {
    id: "c0",
    tag: "div",
    idAttr: "ad-slot",
    classes: ["ad-container"],
    role: "",
    ariaLabel: "",
    isIframe: false,
    iframeSrc: "",
    width: 300,
    height: 250,
    viewportRatio: 0.1,
    position: "static",
    zIndex: 0,
    textLength: 20,
    linkDensity: 0,
    inMainContent: false,
    text: "Advertisement",
    reasons: ['identifier contains the word "ad"'],
    imageKind: "none",
    imageHost: "",
    imageAlt: "",
    inFigure: false,
    ...overrides,
  };
}

/** A block of `words` words, for search tests. */
export function makeText(word: string, words = 12): string {
  return Array.from({ length: words }, (_, index) => `${word}${index}`).join(" ");
}

export function makeBlocks(count: number, idPrefix = "b"): TextBlock[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `${idPrefix}${index.toString().padStart(3, "0")}`,
    text: `${idPrefix}${index} ${makeText("word", 11)}`,
    words: 12,
  }));
}
