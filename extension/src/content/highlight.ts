/**
 * Painting semantic matches without touching the page's DOM.
 *
 * The Custom Highlight API lets a stylesheet address arbitrary `Range`s, so results are
 * ephemeral paint rather than permanent surgery: no split text nodes, no confused
 * frameworks, and cleanup is a single `.delete()`. That is precisely the opposite of what
 * a `<mark>`-wrapping highlighter does, which is why the custom path is the default and
 * the marks path is an explicit fallback for runtimes that predate it.
 *
 * One scoping rule matters. `::highlight()` rules must live in a document-level style
 * element — a shadow tree cannot style highlights in its host document — so `install`
 * writes to the page's own `<head>` exactly once.
 */

import type { MatchTier } from "../../../shared/wire.ts";

export const HIGHLIGHT_STRONG = "jev-hit-strong";
export const HIGHLIGHT_LOOSE = "jev-hit-loose";
export const HIGHLIGHT_ACTIVE = "jev-hit-active";

export const MARK_ATTRIBUTE = "data-jev-hit";

export function customHighlightsAvailable(): boolean {
  try {
    return (
      typeof CSS !== "undefined" &&
      "highlights" in CSS &&
      typeof (globalThis as { Highlight?: unknown }).Highlight === "function"
    );
  } catch {
    return false;
  }
}

/** Document-level rules for the tiers. */
export function highlightStylesheetText(): string {
  return [
    // Answer tier: amber highlight ("this is the answer span"). Fixed meaning (ticket 07):
    // strong always paints the answer, never a generic "strong match".
    `::highlight(${HIGHLIGHT_STRONG}) { background-color: rgba(245, 158, 11, 0.45); color: inherit; border-radius: 2px; }`,
    // Context tier: slate-blue highlight ("supporting passage"). Fixed meaning (ticket 07):
    // loose always paints context hits, never a generic "loose match".
    `::highlight(${HIGHLIGHT_LOOSE}) { background-color: rgba(99, 132, 172, 0.30); color: inherit; border-radius: 2px; }`,
    // Active tier: vivid electric cyan with bold contrast so the selected hit pops immediately
    `::highlight(${HIGHLIGHT_ACTIVE}) { background-color: #38bdf8; color: #020617; font-weight: 600; border-radius: 2px; }`,
    `mark[${MARK_ATTRIBUTE}] { background-color: rgba(245, 158, 11, 0.45); color: inherit; border-radius: 2px; }`,
    `mark[${MARK_ATTRIBUTE}="loose"] { background-color: rgba(99, 132, 172, 0.30); }`,
    `mark[${MARK_ATTRIBUTE}="active"] { background-color: #38bdf8; color: #020617; font-weight: 600; border-radius: 2px; }`,
    // Visual focus ring for the target element currently navigated to
    `.jev-target-active { outline: 2px solid #38bdf8 !important; outline-offset: 4px !important; border-radius: 4px !important; transition: outline 0.2s ease !important; }`,
  ].join("\n");
}

export function installHighlightStylesheet(document: Document): void {
  if (document.getElementById("jev-highlight-style") !== null) return;
  const holder = document.documentElement ?? document.head ?? document.body;
  if (!holder) return;
  const style = document.createElement("style");
  style.id = "jev-highlight-style";
  style.textContent = highlightStylesheetText();
  holder.appendChild(style);
}

const HighlightConstructor: (new (...ranges: Range[]) => { [key: string]: unknown }) | null =
  customHighlightsAvailable()
    ? ((globalThis as Record<string, unknown>)["Highlight"] as new (...ranges: Range[]) => {
        [key: string]: unknown;
      })
    : null;

function setCustomHighlight(name: string, ranges: readonly Range[]): void {
  if (HighlightConstructor === null) return;
  const highlights = (CSS as unknown as { highlights: Map<string, unknown> }).highlights;
  try {
    highlights.set(name, new HighlightConstructor(...ranges));
  } catch {
    // A range whose nodes left the document rejects the whole Highlight.
  }
}

function clearCustomHighlight(name: string): void {
  if (!customHighlightsAvailable()) return;
  try {
    (CSS as unknown as { highlights: Map<string, unknown> }).highlights.delete(name);
  } catch {
    // Already gone.
  }
}

/**
 * Wrap ranges in `<mark>` elements so a runtime without the Custom Highlight API still
 * shows something. Used only as a fallback: this does mutate the page, and a framework
 * mid-render can lose the marks, which is why the primary path never touches the DOM.
 */
function wrapRangesInMarks(ranges: readonly Range[], tier: MatchTier): Element[] {
  const marks: Element[] = [];
  for (const range of ranges) {
    const document = range.startContainer.ownerDocument;
    if (!document) continue;
    try {
      const mark = document.createElement("mark");
      mark.setAttribute(MARK_ATTRIBUTE, tier === "strong" ? "strong" : "loose");
      range.surroundContents(mark);
      marks.push(mark);
    } catch {
      // `surroundContents` rejects ranges that split a node boundary. Unwrap by hand
      // rather than dropping the hit: extract the contents into the mark and re-insert it.
      try {
        const mark = document.createElement("mark");
        mark.setAttribute(MARK_ATTRIBUTE, tier === "strong" ? "strong" : "loose");
        mark.appendChild(range.extractContents());
        range.insertNode(mark);
        marks.push(mark);
      } catch {
        // The range's nodes left the document between the search and the paint.
      }
    }
  }
  return marks;
}

/**
 * One object per find-bar session. It remembers what it painted so closing the bar or
 * running a new query always starts from a clean page, whichever technique is in use.
 */
export class Highlighter {
  readonly #custom: boolean;
  readonly #marks: Element[] = [];
  #activeMark: Element | null = null;
  #activeOriginalTier: string | null = null;

  constructor() {
    this.#custom = customHighlightsAvailable();
  }

  get technique(): "custom" | "marks" {
    return this.#custom ? "custom" : "marks";
  }

  paint(document: Document, strong: readonly Range[], loose: readonly Range[]): void {
    installHighlightStylesheet(document);
    this.clear(document);

    if (this.#custom) {
      setCustomHighlight(HIGHLIGHT_STRONG, strong);
      setCustomHighlight(HIGHLIGHT_LOOSE, loose);
      clearCustomHighlight(HIGHLIGHT_ACTIVE);
      return;
    }

    this.#marks.push(...wrapRangesInMarks(strong, "strong"));
    this.#marks.push(...wrapRangesInMarks(loose, "loose"));
  }

  setActive(range: Range | null): void {
    if (this.#custom) {
      if (range === null) {
        clearCustomHighlight(HIGHLIGHT_ACTIVE);
      } else {
        setCustomHighlight(HIGHLIGHT_ACTIVE, [range]);
      }
      return;
    }

    if (this.#activeMark !== null && this.#activeOriginalTier !== null) {
      this.#activeMark.setAttribute(MARK_ATTRIBUTE, this.#activeOriginalTier);
      this.#activeMark = null;
      this.#activeOriginalTier = null;
    }
    if (range === null) return;

    const node = range.commonAncestorContainer;
    for (const mark of this.#marks) {
      if (mark === node || mark.contains(node) || node.contains(mark)) {
        this.#activeOriginalTier = mark.getAttribute(MARK_ATTRIBUTE) ?? "strong";
        mark.setAttribute(MARK_ATTRIBUTE, "active");
        this.#activeMark = mark;
        break;
      }
    }
  }

  clear(document: Document): void {
    if (this.#custom) {
      clearCustomHighlight(HIGHLIGHT_STRONG);
      clearCustomHighlight(HIGHLIGHT_LOOSE);
      clearCustomHighlight(HIGHLIGHT_ACTIVE);
      return;
    }
    this.#activeMark = null;
    this.#activeOriginalTier = null;
    for (const mark of this.#marks.splice(0)) {
      try {
        const parent = mark.parentNode;
        if (parent === null) continue;
        while (mark.firstChild !== null) parent.insertBefore(mark.firstChild, mark);
        parent.removeChild(mark);
      } catch {
        // The page re-rendered around the marks.
      }
    }
    void document;
  }
}
