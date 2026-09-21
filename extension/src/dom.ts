/**
 * The DOM adapter.
 *
 * This is the only file that touches live elements, and it is deliberately thin. Every
 * decision it feeds — what to shortlist, what may be deleted, which text is worth
 * searching — lives in `heuristics.ts` as a pure function over descriptors.
 *
 * Measurement is injected rather than called directly. Layout is the one thing a DOM
 * parser cannot supply, so a `Measurer` seam is what lets the real adapter be tested
 * against `fixtures/ads.html` under linkedom with a stubbed geometry table, instead of
 * leaving the extraction code untested.
 */

import type { TextBlock } from "../../shared/wire.ts";
import { AD_IMAGE_ALT_CHARS } from "../../shared/wire.ts";
import type { ElementDescriptor } from "./heuristics.ts";
import type { ImageKind } from "./heuristics.ts";
import {
  BLOCK_RULES,
  LAYOUT_SCAN_DEPTH,
  SHORTLIST_LIMITS,
  candidateSelector,
  cleanBlockText,
  disclosesAdvertising,
  imageHostOf,
  isEligibleBlock,
  shortlistElement,
  splitSentenceSpans,
  toTextBlock,
} from "./heuristics.ts";

export interface StyleLike {
  readonly position: string;
  readonly zIndex: string;
  readonly display: string;
  readonly visibility: string;
  readonly opacity: string;
  /** Computed `background-image` value, or `"none"`. Image creatives live here. */
  readonly backgroundImage: string;
}

export interface RectLike {
  readonly width: number;
  readonly height: number;
}

/** Everything `describeElement` needs that a DOM parser cannot provide. */
export interface Measurer {
  style(element: Element): StyleLike;
  rect(element: Element): RectLike;
  viewport(): RectLike;
}

const DEFAULT_STYLE: StyleLike = {
  position: "static",
  zIndex: "auto",
  display: "block",
  visibility: "visible",
  opacity: "1",
  backgroundImage: "none",
};

export const browserMeasurer: Measurer = {
  style(element) {
    const view = element.ownerDocument?.defaultView;
    const computed = view?.getComputedStyle?.(element);
    if (!computed) return DEFAULT_STYLE;
    let backgroundImage = "none";
    try {
      const raw = computed.getPropertyValue("background-image") ?? "";
      if (raw !== "" && raw !== "none") backgroundImage = raw;
    } catch {
      // A page in a weird state can refuse style reads; background stays unknown.
    }
    return {
      position: computed.position || DEFAULT_STYLE.position,
      zIndex: computed.zIndex || DEFAULT_STYLE.zIndex,
      display: computed.display || DEFAULT_STYLE.display,
      visibility: computed.visibility || DEFAULT_STYLE.visibility,
      opacity: computed.opacity || DEFAULT_STYLE.opacity,
      backgroundImage,
    };
  },
  rect(element) {
    const box = element.getBoundingClientRect();
    return { width: box.width, height: box.height };
  },
  viewport() {
    return {
      width: globalThis.innerWidth ?? 0,
      height: globalThis.innerHeight ?? 0,
    };
  },
};

function toNumber(value: string): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** The selectors that decide what the page considers its main content. */
export const MAIN_CONTENT_SELECTOR = "main, article, [role='main']";

/** Non-content containers that should never be searched as prose blocks (e.g. footnotes, nav, cite lists). */
export const EXCLUDED_BLOCK_CONTAINER_SELECTOR =
  "ol.references, .references, .reflist, .navbox, footer, nav, [role='navigation'], #mw-navigation, noscript";

/** Elements whose text can stand alone as a search result. */
export const BLOCK_SELECTOR =
  "p, li, h1, h2, h3, h4, h5, h6, blockquote, td, th, dd, dt, figcaption, summary, pre";

export function isVisible(element: Element, measurer: Measurer): boolean {
  const style = measurer.style(element);
  if (style.display === "none" || style.visibility === "hidden") return false;
  if (Number.parseFloat(style.opacity) === 0) return false;
  const rect = measurer.rect(element);
  return rect.width > 0 && rect.height > 0;
}

export function isInMainContent(element: Element): boolean {
  try {
    return element.closest(MAIN_CONTENT_SELECTOR) !== null;
  } catch {
    return false;
  }
}

export function isInExcludedBlockContainer(element: Element): boolean {
  try {
    return element.closest(EXCLUDED_BLOCK_CONTAINER_SELECTOR) !== null;
  } catch {
    return false;
  }
}

/**
 * True when inside a figure/picture-with-caption structure.
 *
 * Structural image veto (ticket 05): such units hide at most, never removed. A bare
 * `picture` element is NOT itself such a structure — it is the creative container,
 * judged on its own signals — but content nested inside one is responsive art and
 * stays protected. (Ticket 08 caught the self-match: `closest` includes the element
 * itself, which capped every picture creative at hide.)
 */
export function isInFigure(element: Element): boolean {
  try {
    if (element.closest("figure") !== null) return true;
    const picture = element.closest("picture");
    return picture !== null && picture !== element;
  } catch {
    return false;
  }
}

/** Inline `style` carrying a background image, for trees without computed style. */
const INLINE_BACKGROUND_PATTERN = /background(-image)?\s*:[^;]*url\(/i;

/**
 * Bounded sponsored-proximity check (ticket 04): does nearby disclosure name
 * advertising for this element?
 *
 * Reads the unit's own image alts, adjacent sibling captions, ancestor aria-labels
 * (two levels up), and figcaption children that do not contain the element itself.
 * Ancestor *text* is deliberately never read: a parent's textContent echoes the
 * element's own disclosure, which would let one mention corroborate itself.
 */
export function hasNearbyDisclosure(element: Element): boolean {
  try {
    const alts = element.querySelectorAll("img[alt]");
    for (const img of alts) {
      if (disclosesAdvertising(img.getAttribute("alt") ?? "")) return true;
    }
    // The unit's own caption disclosing itself counts: a figure labelled "Sponsored"
    // is the unit naming its own nature, distinct from a nearby mention.
    const ownCaption = element.querySelector("figcaption");
    if (
      ownCaption !== null &&
      !ownCaption.contains(element) &&
      disclosesAdvertising(ownCaption.textContent ?? "")
    ) {
      return true;
    }
    for (const sibling of [element.previousElementSibling, element.nextElementSibling]) {
      if (sibling !== null && disclosesAdvertising((sibling.textContent ?? "").slice(0, 300))) {
        return true;
      }
    }
    let parent = element.parentElement;
    let depth = 0;
    while (parent !== null && depth < 2) {
      if (disclosesAdvertising(parent.getAttribute("aria-label") ?? "")) return true;
      for (const child of parent.children) {
        if (
          child.tagName.toLowerCase() === "figcaption" &&
          !child.contains(element) &&
          disclosesAdvertising(child.textContent ?? "")
        ) {
          return true;
        }
      }
      parent = parent.parentElement;
      depth += 1;
    }
  } catch {
    // A page in a weird state can make any of these traversals throw.
  }
  return false;
}

/** First image source under the element (or the element itself when it is one). */
function imageSource(element: Element, tag: string): { node: Element | null; src: string } {
  try {
    if (tag === "img") return { node: element, src: element.getAttribute("src") ?? "" };
    const nested = element.querySelector("img[src]");
    if (nested !== null) return { node: nested, src: nested.getAttribute("src") ?? "" };
    if (tag === "picture") {
      // Art-directed responsive image with no `<img>` fallback in the tree: the first
      // `srcset` candidate names the source. Host-only evidence keeps it private.
      const source = element.querySelector("source[srcset]");
      const first = (source?.getAttribute("srcset") ?? "").split(",")[0]?.trim().split(/\s+/)[0];
      if (first !== undefined && first !== "") return { node: source, src: first };
      return { node: element, src: "" };
    }
    return { node: null, src: "" };
  } catch {
    return { node: null, src: "" };
  }
}

/** First `url(...)` in a background-image value, if any. */
function backgroundUrl(value: string): string {
  const match = /url\(["']?([^"')]+)["']?\)/i.exec(value);
  return match?.[1] ?? "";
}

function imageKindOf(tag: string, hasSource: boolean, background: boolean): ImageKind {
  if (tag === "img") return "img";
  if (tag === "picture") return "picture";
  if (background) return "background";
  return hasSource ? "img" : "none";
}

export function describeElement(element: Element, measurer: Measurer): ElementDescriptor {
  const style = measurer.style(element);
  const rect = measurer.rect(element);
  const viewport = measurer.viewport();
  const text = cleanBlockText(element.textContent ?? "");
  const tag = element.tagName.toLowerCase();
  const isIframe = tag === "iframe";
  const anchors = element.querySelectorAll("a").length;

  const viewportArea = viewport.width * viewport.height;
  const area = rect.width * rect.height;

  // Image evidence (ticket 04): shape, host-only source, truncated alt. Full URLs and
  // tracking strings never leave this adapter — `imageHostOf` is the single place a
  // URL becomes a host. Source preference is img, then picture srcset, then the
  // background-image URL; alt falls back to the aria-label per the decided model.
  const inlineStyle = element.getAttribute("style") ?? "";
  const computedBg = style.backgroundImage !== "" && style.backgroundImage !== "none";
  const background =
    computedBg || INLINE_BACKGROUND_PATTERN.test(inlineStyle);
  const { node: source, src: imgSrc } = imageSource(element, tag);
  const bgSrc = background
    ? backgroundUrl(computedBg ? style.backgroundImage : inlineStyle)
    : "";
  const imageKind = imageKindOf(tag, source !== null, background);
  // Evidence only travels with an actual image; a bare aria-label on a text element
  // is not image evidence.
  const rawSrc = imageKind === "none" ? "" : imgSrc !== "" ? imgSrc : bgSrc;
  const rawAlt =
    imageKind === "none"
      ? ""
      : (source?.getAttribute("alt") ?? element.getAttribute("aria-label") ?? "");

  return {
    tag,
    id: element.getAttribute("id") ?? "",
    classes: [...element.classList],
    role: element.getAttribute("role") ?? "",
    ariaLabel: element.getAttribute("aria-label") ?? "",
    isIframe,
    iframeSrc: isIframe ? (element.getAttribute("src") ?? "") : "",
    width: rect.width,
    height: rect.height,
    viewportRatio: viewportArea <= 0 ? 0 : Math.min(1, area / viewportArea),
    position: style.position,
    zIndex: toNumber(style.zIndex),
    textLength: text.length,
    // Links per hundred characters. Ad and navigation chrome is link-dense; prose is not.
    linkDensity: text.length === 0 ? 0 : (anchors / text.length) * 100,
    inMainContent: isInMainContent(element),
    text,
    imageKind,
    imageHost: imageHostOf(rawSrc),
    imageAlt: rawAlt.slice(0, AD_IMAGE_ALT_CHARS),
    inFigure: isInFigure(element),
    hasProximityDisclosure: hasNearbyDisclosure(element),
  };
}

/** Elements worth measuring: token matches, frames, dialogs, plus a shallow sweep. */
export function collectCandidateElements(root: ParentNode, depth = LAYOUT_SCAN_DEPTH): Element[] {
  const found = new Set<Element>();

  try {
    for (const element of root.querySelectorAll(candidateSelector())) found.add(element);
  } catch {
    // A page in a weird state can make the selector throw. Token matching still ran.
  }
  for (const element of root.querySelectorAll("iframe, [role='dialog'], [aria-modal='true']")) {
    found.add(element);
  }

  const body =
    (root as Document).body ??
    (root as Element).querySelector?.("body") ??
    null;

  if (body !== null) {
    const sweep = (element: Element, remaining: number): void => {
      found.add(element);
      if (remaining <= 0) return;
      for (const child of element.children) sweep(child, remaining - 1);
    };
    sweep(body, depth);
  }

  return [...found];
}

export interface ScanResult {
  readonly key: string;
  readonly element: Element;
  readonly descriptor: ElementDescriptor;
  readonly reasons: readonly string[];
}

/**
 * Shortlist the page's ad-shaped elements.
 *
 * Returns the outermost element of each nested group, because removing a wrapper takes
 * its contents with it and asking about both would spend two questions on one thing.
 * Nesting resolves against the live tree after collection, so the answer never
 * depends on which collection phase (selector or sweep) saw an element first.
 */
export function scanForAds(
  root: ParentNode,
  measurer: Measurer,
  limit: number = SHORTLIST_LIMITS.maxCandidates,
): ScanResult[] {
  const elements = collectCandidateElements(root);
  const collected: ScanResult[] = [];
  const keyByElement = new Map<Element, string>();

  for (const element of elements) {
    if (collected.length >= limit) break;

    const descriptor = describeElement(element, measurer);
    const decision = shortlistElement(descriptor);
    if (!decision.eligible) continue;

    const key = `c${collected.length}`;
    keyByElement.set(element, key);
    collected.push({ key, element, descriptor, reasons: decision.reasons });
  }

  return collected
    .filter((candidate) => {
      let parent = candidate.element.parentElement;
      while (parent !== null) {
        if (keyByElement.has(parent)) return false;
        parent = parent.parentElement;
      }
      return true;
    })
    .map(({ key, element, descriptor, reasons }) => ({ key, element, descriptor, reasons }));
}

// ---------------------------------------------------------------------------
// Feature 2: extracting searchable blocks
// ---------------------------------------------------------------------------

export interface ExtractedBlock {
  readonly block: TextBlock;
  /** The element the block came from, used to scroll a hit into view. */
  readonly element: Element;
  /** Highlightable ranges covering the block's text. */
  readonly ranges: readonly Range[];
}

interface TextPiece {
  readonly node: Text;
  readonly start: number;
  readonly end: number;
}

function textPieces(element: Element): TextPiece[] {
  const pieces: TextPiece[] = [];
  let offset = 0;
  const walker = element.ownerDocument.createTreeWalker(element, 4 /* SHOW_TEXT */);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const text = node as Text;
    const length = text.data.length;
    if (length === 0) continue;
    pieces.push({ node: text, start: offset, end: offset + length });
    offset += length;
  }
  return pieces;
}

function rangeFromOffsets(
  document: Document,
  pieces: readonly TextPiece[],
  from: number,
  to: number,
): Range | null {
  let start: TextPiece | null = null;
  let end: TextPiece | null = null;
  for (const piece of pieces) {
    if (start === null && from >= piece.start && from <= piece.end) start = piece;
    if (to >= piece.start && to <= piece.end) {
      end = piece;
      break;
    }
  }
  if (start === null || end === null) return null;
  try {
    const range = document.createRange();
    range.setStart(start.node, from - start.start);
    range.setEnd(end.node, to - end.start);
    return range;
  } catch {
    return null;
  }
}

/**
 * Ranges covering an element's text, split on sentence boundaries when it is long.
 *
 * A single paragraph can run to thousands of words, and one `Choice` option pointing at
 * all of it is a poor option. Offsets walk the raw text nodes rather than the cleaned
 * text so the resulting ranges line up with the live document and can be highlighted.
 */
export function rangesForElement(element: Element, maxWords = BLOCK_RULES.splitAboveWords): Range[] {
  const document = element.ownerDocument;
  const whole = document.createRange();
  whole.selectNodeContents(element);

  const pieces = textPieces(element);
  const raw = pieces.map((piece) => piece.node.data).join("");
  if (raw.split(/\s+/).filter((word) => word !== "").length <= maxWords) return [whole];

  const boundaries: number[] = [];
  const sentenceEnd = /[.!?]["')\]]?\s/g;
  for (let match = sentenceEnd.exec(raw); match !== null; match = sentenceEnd.exec(raw)) {
    boundaries.push(match.index + match[0].length);
  }
  if (boundaries.length === 0) return [whole];

  const ranges: Range[] = [];
  let from = 0;
  let words = 0;
  let cursor = 0;
  for (let index = 0; index < raw.length; index += 1) {
    if (index === 0 || /\s/.test(raw[index - 1] ?? " ")) {
      const next = raw.slice(index).split(/\s+/)[0] ?? "";
      if (next !== "") words += 1;
    }
    if (words >= maxWords && boundaries[cursor] !== undefined && index >= (boundaries[cursor] ?? 0)) {
      const to = boundaries[cursor] ?? index;
      const range = rangeFromOffsets(document, pieces, from, to);
      if (range !== null) ranges.push(range);
      from = to;
      cursor += 1;
      words = 0;
    }
  }

  const tail = rangeFromOffsets(document, pieces, from, raw.length);
  if (tail !== null) ranges.push(tail);
  return ranges.length > 0 ? ranges : [whole];
}

/**
 * Collect the page's searchable text blocks in document order.
 *
 * Two filters do the real work. Elements with an eligible block descendant are dropped so
 * a `<li>` and the `<p>` inside it do not both become options carrying the same words, and
 * invisible elements are skipped entirely — searching text the reader cannot see is how a
 * find bar ends up highlighting nothing.
 */
export function extractBlocks(
  root: ParentNode,
  measurer: Measurer,
  limit: number = BLOCK_RULES.maxBlocks,
): ExtractedBlock[] {
  const candidates: Element[] = [];
  try {
    for (const element of root.querySelectorAll(BLOCK_SELECTOR)) {
      const element_ = element;
      if (isInExcludedBlockContainer(element_)) continue;
      if (!isVisible(element_, measurer)) continue;
      const text = cleanBlockText(element_.textContent ?? "");
      if (!isEligibleBlock(text)) continue;
      candidates.push(element_);
    }
  } catch {
    return [];
  }

  // Prefer the innermost block, so one piece of text yields one option.
  const chosen = candidates.filter((element) => {
    const inner = candidates.some(
      (other) => other !== element && element.contains(other),
    );
    return !inner;
  });

  const blocks: ExtractedBlock[] = [];
  for (const element of chosen) {
    if (blocks.length >= limit) break;
    pushElementBlocks(element, blocks, limit);
  }
  return blocks;
}

/**
 * One element's contribution to the searchable page: one block per sentence.
 *
 * A single-sentence element keeps today's whole-element block (including the long-text
 * sentence splitting in `rangesForElement`). A multi-sentence element becomes one block
 * per eligible sentence, each with the range covering exactly that sentence, so the
 * ranker can point at an answer instead of a paragraph. Sentences below the word floor
 * are dropped unless they are all the element has, in which case the whole element is
 * kept — an element never loses its only voice.
 */
function pushElementBlocks(element: Element, blocks: ExtractedBlock[], limit: number): void {
  const document = element.ownerDocument;
  const pieces = textPieces(element);
  const raw = pieces.map((piece) => piece.node.data).join("");

  const sentences = splitSentenceSpans(raw);
  if (sentences.length <= 1) {
    pushWholeElementBlock(element, blocks);
    return;
  }

  const eligible = sentences
    .map((span) => ({ ...span, text: cleanBlockText(raw.slice(span.start, span.end)) }))
    .filter((span) => isEligibleBlock(span.text));

  if (eligible.length === 0) {
    pushWholeElementBlock(element, blocks);
    return;
  }

  for (const span of eligible) {
    if (blocks.length >= limit) break;
    // Offsets derive from these same text nodes, so the mapping is not expected to fail.
    // The fallback keeps the invariant every block carries a range, with a fresh Range per
    // span rather than one shared object across blocks.
    const range = rangeFromOffsets(document, pieces, span.start, span.end) ?? wholeElementRange(document, element);
    blocks.push({ block: toTextBlock(blocks.length, span.text), element, ranges: [range] });
  }
}

/** Today's whole-element block: the element's collapsed text with its ranges. */
function pushWholeElementBlock(element: Element, blocks: ExtractedBlock[]): void {
  const ranges = rangesForElement(element);
  const text = cleanBlockText(element.textContent ?? "");
  blocks.push({ block: toTextBlock(blocks.length, text), element, ranges });
}

/** A fresh Range covering the element's contents. */
function wholeElementRange(document: Document, element: Element): Range {
  const range = document.createRange();
  range.selectNodeContents(element);
  return range;
}
