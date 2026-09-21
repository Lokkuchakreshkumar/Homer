/**
 * The semantic search controller.
 *
 * It borrows the debounce idea from autocomplete: typing fires a timer, and only the
 * timer's expiry (or an explicit Enter) spends a model call. Overlapping responses are the
 * hazard, because a slow answer to an old query paints over a fast answer to a new one,
 * so each search carries a generation and only the newest one is allowed to paint.
 */

import type { SearchHit, SearchVerdict, UsageTotals } from "../../shared/wire.ts";
import { emptyUsage } from "../../shared/wire.ts";
import { browserMeasurer, extractBlocks } from "../dom.ts";
import type { ExtractedBlock } from "../dom.ts";
import { Highlighter } from "./highlight.ts";
import { describeVerdict, mountFindBar } from "./findbar.ts";
import type { FindBarIntent } from "./findbar.ts";
import { searchViaWorker } from "../worker-client.ts";

/** Eligible blocks are gathered at most this often while the user types. */
const MIN_REEXTRACTION_GAP_MS = 800;

export interface ActiveMatch {
  readonly range: Range;
  readonly tier: "strong" | "loose";
  readonly element: Element;
  /** Ordinal of the match's span in answer-then-context order (0-based). */
  readonly span: number;
}

/**
 * Split hits into the answer and its context.
 *
 * The server answers with at most one strong hit (the answer span) followed by loose
 * context hits in relevance order. The first strong hit anywhere in the list wins;
 * everything else is context in its original relative order.
 */
export function partitionAnswer(hits: readonly SearchHit[]): {
  readonly answer: SearchHit | null;
  readonly context: readonly SearchHit[];
} {
  const answerIndex = hits.findIndex((hit) => hit.tier === "strong");
  const answer = answerIndex === -1 ? undefined : hits[answerIndex];
  if (answer === undefined) return { answer: null, context: hits };
  return { answer, context: [...hits.slice(0, answerIndex), ...hits.slice(answerIndex + 1)] };
}

export interface ResolvedHits {
  /** Ranges painting the answer span. */
  readonly answer: readonly Range[];
  /** Ranges painting context spans, in relevance order after the answer. */
  readonly context: readonly Range[];
  /** Navigable matches in walk order, each carrying its span ordinal. */
  readonly matches: ActiveMatch[];
  /** Spans with at least one painted range (drives the counts, not the ranges). */
  readonly answerSpans: number;
  readonly contextSpans: number;
}

/** True when the range's nodes are still in the document being painted. */
function isLiveRange(document: Document, range: Range): boolean {
  try {
    const node = range.commonAncestorContainer;
    return node !== null && node !== undefined && document.contains(node);
  } catch {
    return false;
  }
}

/**
 * Turn hits into paintable, navigable matches.
 *
 * Hits for blocks that no longer exist are dropped, as are ranges whose nodes left
 * the document between extraction and paint — a page that re-rendered mid-search
 * yields fewer highlights, never highlights on dead nodes.
 */
export function resolveHitRanges(
  document: Document,
  entries: readonly ExtractedBlock[],
  hits: readonly SearchHit[],
): ResolvedHits {
  const byId = new Map(entries.map((entry) => [entry.block.id, entry]));
  const { answer, context } = partitionAnswer(hits);
  const answerRanges: Range[] = [];
  const contextRanges: Range[] = [];
  const matches: ActiveMatch[] = [];
  let answerSpans = 0;
  let contextSpans = 0;
  // Dense over painted spans only, so the walk position can never exceed the totals
  // even when a middle hit drops out (vanished block, detached ranges).
  let nextSpan = 0;

  // `tier` is the paint role, deliberately not `hit.tier`: a demoted extra-strong hit
  // still paints and counts as context.
  const collect = (hit: SearchHit, tier: ActiveMatch["tier"], into: Range[]): void => {
    const entry = byId.get(hit.id);
    if (entry === undefined) return;
    const live = entry.ranges.filter((range) => isLiveRange(document, range));
    if (live.length === 0) return;
    const span = nextSpan++;
    into.push(...live);
    for (const range of live) matches.push({ range, tier, element: entry.element, span });
    if (tier === "strong") answerSpans += 1;
    else contextSpans += 1;
  };

  if (answer !== null) collect(answer, "strong", answerRanges);
  for (const hit of context) collect(hit, "loose", contextRanges);

  return { answer: answerRanges, context: contextRanges, matches, answerSpans, contextSpans };
}

export class SemanticFinder {
  readonly #highlighter = new Highlighter();
  #bar: ReturnType<typeof mountFindBar> | null = null;
  #blocks: ExtractedBlock[] = [];
  #matches: ActiveMatch[] = [];
  #current = 0;
  #answerSpans = 0;
  #contextSpans = 0;
  #activeElement: Element | null = null;
  #generation = 0;
  #debounceTimer: ReturnType<typeof setTimeout> | null = null;
  #lastExtraction = 0;
  /** The query the current highlights answer. Enter with an unchanged query walks instead. */
  #lastSearchedQuery: string | null = null;
  readonly #document: Document;
  readonly #debounceMs: number;
  /** Called with every search's usage so the tab can account for the session. */
  readonly onUsage: (usage: UsageTotals) => void;
  /** Called with the query each search actually answers, for the popup's record. */
  readonly onQuery: (query: string) => void;

  constructor(
    document: Document,
    debounceMs: number,
    callbacks: {
      readonly onUsage?: (usage: UsageTotals) => void;
      readonly onQuery?: (query: string) => void;
    } = {},
  ) {
    this.#document = document;
    this.#debounceMs = Math.max(0, Math.min(2000, debounceMs));
    this.onUsage = callbacks.onUsage ?? (() => undefined);
    this.onQuery = callbacks.onQuery ?? (() => undefined);
  }

  get isOpen(): boolean {
    return this.#bar !== null;
  }

  open(preset = ""): void {
    this.close();
    this.#matches = [];
    this.#current = 0;
    this.#blocks = [];
    this.#lastExtraction = 0;

    this.#bar = mountFindBar(this.#document, { onIntent: (intent) => this.#onIntent(intent) });
    if (preset !== "") this.#bar.preset(preset);
    this.#bar.focus();
    this.#bar.setCounts({ answer: 0, context: 0, current: 0 });

    const initial = preset !== "" ? preset : this.#bar.query();
    if (initial.trim() !== "") void this.#runSearch(initial);
  }

  close(): void {
    if (this.#debounceTimer !== null) {
      clearTimeout(this.#debounceTimer);
      this.#debounceTimer = null;
    }
    // A newer search may still be in flight. Bumping the generation strands it so its
    // late answer cannot paint over a closed page.
    this.#generation += 1;
    if (this.#activeElement !== null) {
      this.#activeElement.classList.remove("jev-target-active");
      this.#activeElement = null;
    }
    this.#highlighter.clear(this.#document);
    this.#bar?.remove();
    this.#bar = null;
    this.#matches = [];
    this.#current = 0;
  }

  /** Step the current match by `direction`, wrapping around. No-op without matches. */
  step(direction: 1 | -1): void {
    this.#step(direction);
  }

  #onIntent(intent: FindBarIntent): void {
    switch (intent.kind) {
      case "dismiss":
        this.close();
        break;
      case "query":
        this.#schedule(intent.text);
        break;
      case "next":
        if (this.#bar !== null) void this.#searchNow(this.#bar.query());
        break;
      case "prev":
        this.#step(-1);
        break;
    }
  }

  #schedule(text: string): void {
    if (this.#debounceTimer !== null) clearTimeout(this.#debounceTimer);
    if (text.trim() === "") {
      this.#clearResults("Semantic find · powered by Jev");
      return;
    }
    // Enter skips the wait entirely; the keydown path calls `#searchNow` directly when the
    // input handler below reports intent "next" with a dirty query. Anything arriving here
    // through typing waits out the debounce.
    this.#debounceTimer = setTimeout(() => {
      this.#debounceTimer = null;
      void this.#runSearch(text);
    }, this.#debounceMs);
  }

  async #searchNow(query: string): Promise<void> {
    if (this.#debounceTimer !== null) {
      clearTimeout(this.#debounceTimer);
      this.#debounceTimer = null;
    }
    const trimmed = query.trim();
    if (trimmed === "") {
      this.#clearResults("Semantic find · powered by Jev");
      return;
    }
    // Enter on an unchanged query walks the existing matches instead of spending a call.
    if (trimmed === this.#lastSearchedQuery && this.#matches.length > 0) {
      this.#step(1);
      return;
    }
    await this.#runSearch(query);
  }

  /** Refresh blocks when they are stale, send the query, paint the answer. */
  async #runSearch(query: string): Promise<void> {
    const bar = this.#bar;
    if (bar === null) return;

    const trimmed = query.trim();
    if (trimmed === "") {
      this.#clearResults("Semantic find · powered by Jev");
      return;
    }

    const now = Date.now();
    if (this.#blocks.length === 0 || now - this.#lastExtraction >= MIN_REEXTRACTION_GAP_MS) {
      this.#blocks = extractBlocks(this.#document, browserMeasurer);
      this.#lastExtraction = now;
    }
    if (this.#blocks.length === 0) {
      this.#clearResults("No readable text on this page");
      return;
    }

    this.#lastSearchedQuery = trimmed;
    // A new search starts from a clean page: previous paint cannot masquerade as the
    // new answer while the judge is still thinking.
    this.#clearPaint();
    const generation = (this.#generation += 1);
    bar.setSearching(true);
    bar.setStatus({ text: "Asking Jev…", tone: "info" });

    let response;
    try {
      response = await searchViaWorker({
        type: "jev:search",
        request: {
          pageUrl: this.#document.location?.href ?? "",
          query: trimmed,
          blocks: this.#blocks.map((entry) => entry.block),
        },
      });
    } catch (cause) {
      if (generation !== this.#generation || this.#bar === null) return;
      bar.setSearching(false);
      const message = cause instanceof Error ? cause.message : String(cause);
      if (
        message.includes("Extension context invalidated") ||
        message.includes("Extension reloaded") ||
        (typeof chrome !== "undefined" && !chrome.runtime?.id)
      ) {
        bar.setStatus({
          text: "Extension reloaded — click to refresh page",
          tone: "warn",
        });
      } else {
        bar.setStatus({ text: `Could not search: ${message}`, tone: "warn" });
      }
      return;
    }

    if (generation !== this.#generation || this.#bar === null) return;
    this.onUsage(response.usage);
    this.onQuery(trimmed);
    this.#paint(response.hits, response.verdict, response.meta.warnings);
  }

  #paint(
    hits: readonly SearchHit[],
    verdict: SearchVerdict,
    warnings: readonly string[],
  ): void {
    const bar = this.#bar;
    if (bar === null) return;
    bar.setSearching(false);

    const resolved = resolveHitRanges(this.#document, this.#blocks, hits);
    this.#matches = resolved.matches;
    this.#current = 0;
    this.#answerSpans = resolved.answerSpans;
    this.#contextSpans = resolved.contextSpans;
    this.#highlighter.paint(this.#document, resolved.answer, resolved.context);

    bar.setCounts({ answer: this.#answerSpans, context: this.#contextSpans, current: 0 });

    const verdictText = describeVerdict(verdict, {
      answer: this.#answerSpans,
      context: this.#contextSpans,
    });
    if (warnings.length > 0) {
      const isBudgetNotice = warnings.some(
        (w) => w.includes("state budget") || w.includes("text blocks were searched"),
      );
      if (isBudgetNotice) {
        const match = /first\s+(\d+)\s+text\s+blocks/i.exec(warnings.join(" "));
        const note = match?.[1] ? `(first ${match[1]} blocks)` : `(budget limit)`;
        bar.setStatus({ text: `${verdictText} ${note}`, tone: "info" });
      } else {
        bar.setStatus({ text: warnings.join(" · "), tone: "warn" });
      }
    } else {
      bar.setStatus({ text: verdictText, tone: "info" });
    }

    if (this.#matches.length > 0) {
      this.#updateActive(this.#current, false);
    } else {
      this.#updateActive(0, false);
    }
  }

  /** Drop paint, matches, and span totals without touching the query or status. */
  #clearPaint(): void {
    this.#matches = [];
    this.#current = 0;
    this.#answerSpans = 0;
    this.#contextSpans = 0;
    if (this.#activeElement !== null) {
      this.#activeElement.classList.remove("jev-target-active");
      this.#activeElement = null;
    }
    this.#highlighter.clear(this.#document);
    this.#bar?.setCounts({ answer: 0, context: 0, current: 0 });
  }

  #clearResults(status: string): void {
    this.#clearPaint();
    this.#lastSearchedQuery = null;
    this.#bar?.setStatus({ text: status, tone: "info" });
  }

  #step(direction: 1 | -1): void {
    if (this.#matches.length === 0) return;
    this.#current = (this.#current + direction + this.#matches.length) % this.#matches.length;
    // The walk position is the span ordinal, so multi-range spans read as one stop.
    const position = this.#matches[this.#current]?.span ?? 0;
    this.#bar?.setCounts({
      answer: this.#answerSpans,
      context: this.#contextSpans,
      current: position,
    });
    this.#updateActive(this.#current, true);
  }

  #updateActive(index: number, smooth: boolean): void {
    const match = this.#matches[index];
    if (match === undefined) {
      this.#highlighter.setActive(null);
      if (this.#activeElement !== null) {
        this.#activeElement.classList.remove("jev-target-active");
        this.#activeElement = null;
      }
      return;
    }

    // Paint active cyan highlight for the currently navigated match range
    this.#highlighter.setActive(match.range);

    // Apply active target focus outline to the matched container element
    if (this.#activeElement !== match.element) {
      this.#activeElement?.classList.remove("jev-target-active");
      this.#activeElement = match.element;
      match.element.classList.add("jev-target-active");
    }

    try {
      match.element.scrollIntoView({ block: "center", behavior: smooth ? "smooth" : "auto" });
    } catch {
      // A page that refuses programmatic scrolling is still searchable; it just stays put.
    }
  }
}
