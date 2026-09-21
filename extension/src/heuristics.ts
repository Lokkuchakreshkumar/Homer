/**
 * DOM-free decisions, in one place.
 *
 * Everything here is a pure function over a small descriptor rather than over a live
 * `Element`. That is deliberate: the interesting judgement calls in this extension —
 * what to shortlist, what may be deleted, which text is worth searching — become testable
 * in Node with no browser and no framework. `dom.ts` is the thin adapter that turns real
 * elements into these descriptors, and it is the only part that cannot be unit tested.
 */

import type { AdCandidate, ImageKind, TextBlock } from "../../shared/wire.ts";
import { AD_IMAGE_ALT_CHARS, AD_REMOVE_TEXT_CAP, AD_TEXT_SNIPPET_CHARS } from "../../shared/wire.ts";

export { AD_IMAGE_ALT_CHARS, AD_REMOVE_TEXT_CAP, AD_TEXT_SNIPPET_CHARS };
export type { ImageKind };

/** The structural summary of one element. No DOM types, so tests can construct it. */
export interface ElementDescriptor {
  readonly tag: string;
  readonly id: string;
  readonly classes: readonly string[];
  readonly role: string;
  readonly ariaLabel: string;
  readonly isIframe: boolean;
  readonly iframeSrc: string;
  readonly width: number;
  readonly height: number;
  /** Fraction of the viewport covered, 0..1. */
  readonly viewportRatio: number;
  readonly position: string;
  readonly zIndex: number;
  readonly textLength: number;
  readonly linkDensity: number;
  readonly inMainContent: boolean;
  readonly text: string;
  /**
   * Compact image evidence. Populated by collection (ticket 04); judged and vetoed
   * here and on the proxy (ticket 05). `imageHost` is host-only by contract — see
   * `imageHostOf`, which is the single place a URL becomes a host.
   */
  readonly imageKind: ImageKind;
  readonly imageHost: string;
  readonly imageAlt: string;
  /** True when inside a `<figure>`, `<picture>`, or captioned-media structure. */
  readonly inFigure: boolean;
  /**
   * True when nearby disclosure names advertising: the unit's own image alts, an
   * adjacent sibling caption, or a containing figure/parent (bounded). Read from the
   * live tree by collection (ticket 04); travels to the judge inside `reasons`,
   * never as its own wire field.
   */
  readonly hasProximityDisclosure: boolean;
}

export const SHORTLIST_LIMITS = {
  /** Past this, text dominates and the element is content until proven otherwise. */
  maxTextLength: 2000,
  /** Cap per scan, so a pathological page cannot produce a runaway request. */
  maxCandidates: 120,
  /** The floor below which a text block is not worth searching. */
  minBlockWords: 4,
} as const;

/** Never ads, whatever else the signals say. */
export const NEVER_AD_TAGS: ReadonlySet<string> = new Set([
  "html",
  "body",
  "head",
  "main",
  "article",
  "nav",
  "header",
  "footer",
  "script",
  "style",
  "link",
  "meta",
  "title",
]);

/**
 * Single words looked for in ids, class names, role, and aria-label.
 *
 * Matched as whole tokens rather than substrings. `includes("ads")` would fire on
 * `download-list`, and a shortlist that cries wolf wastes a model call and risks a wrong
 * removal. Tokens are split on separators and camelCase, so `ad-container` matches `ad`.
 */
const AD_TOKENS: readonly string[] = [
  "ad", "ads", "advert", "advertiser", "advertisement", "adslot", "adunit", "adserver",
  "banner", "leaderboard", "skyscraper", "billboard", "sponsor", "sponsored", "promoted",
  "promo", "prebid", "gpt", "dfp", "doubleclick", "googleads", "adsystem", "taboola",
  "outbrain", "brandvoice", "advertorial", "sponsorship",
];

const OVERLAY_TOKENS: readonly string[] = [
  "modal", "overlay", "popup", "interstitial", "paywall", "newsletter", "subscribe",
  "subscription", "signup", "takeover", "sticky", "lightbox", "consent", "cookie",
];

/** Ad networks, matched against an iframe's host. */
const AD_FRAME_HOSTS: readonly string[] = [
  "doubleclick.net", "googlesyndication.com", "googleadservices.com", "adnxs.com",
  "amazon-adsystem.com", "criteo.com", "criteo.net", "taboola.com", "outbrain.com",
  "pubmatic.com", "rubiconproject.com", "magnite.com", "openx.net", "casalemedia.com",
  "sharethrough.com", "teads.tv", "3lift.com", "media.net", "revcontent.com", "mgid.com",
  "smartadserver.com", "adform.net", "yieldmo.com", "sovrn.com", "gumgum.com",
];

/** Legitimate embeds. An iframe here is never an ad on the strength of being an iframe. */
const EMBED_HOSTS: readonly string[] = [
  "youtube.com", "youtube-nocookie.com", "youtu.be", "vimeo.com", "dailymotion.com",
  "player.twitch.tv", "open.spotify.com", "soundcloud.com", "maps.google.com",
  "google.com/maps", "openstreetmap.org", "codepen.io", "jsfiddle.net", "codesandbox.io",
  "stackblitz.com", "replit.com", "js.stripe.com", "checkout.stripe.com", "recaptcha",
  "hcaptcha.com", "disqus.com", "calendly.com", "docs.google.com", "figma.com",
];

/** Standard IAB-ish ad dimensions. Perfunctory, but they are real evidence. */
const AD_DIMENSIONS: ReadonlySet<string> = new Set([
  "300x250", "336x280", "728x90", "970x90", "970x250", "468x60", "234x60", "120x600",
  "160x600", "300x600", "320x50", "320x100", "250x250", "200x200", "580x400", "300x1050",
]);

/**
 * Fluid ad ratios for image creatives, which rarely match exact IAB sizes.
 *
 * Conservative buckets only: a wide leaderboard band, a box band, a tower band, and
 * a mobile band. Editorial heroes and figures fall outside them, and even a match is
 * never enough on its own — image geometry always needs corroboration (see the gate
 * in `shortlistElement`), because thumbnails can land in the box band.
 */
export function isResponsiveAdSize(width: number, height: number): boolean {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return false;
  }
  const ratio = width / height;
  if (width >= 468 && height >= 60 && height <= 250 && ratio >= 3) return true;
  if (width >= 250 && height >= 200 && ratio >= 0.8 && ratio <= 1.5) return true;
  if (width >= 120 && width <= 400 && height >= 500 && height / width >= 2) return true;
  if (width >= 300 && width <= 500 && height >= 50 && height <= 120) return true;
  return false;
}

export interface ShortlistDecision {
  readonly eligible: boolean;
  readonly score: number;
  readonly reasons: readonly string[];
}

/** Split on separators and camelCase, so identifier soup becomes comparable words. */
export function tokensOf(raw: string): Set<string> {
  const tokens = new Set<string>();
  const split = raw
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/);
  for (const token of split) {
    if (token !== "") tokens.add(token);
  }
  return tokens;
}

function identifierTokens(descriptor: ElementDescriptor): Set<string> {
  return tokensOf(
    [descriptor.id, descriptor.classes.join(" "), descriptor.role, descriptor.ariaLabel].join(" "),
  );
}

/** Text that discloses advertising on its own, which is the strongest single signal. */
const DISCLOSURE_PATTERN = /\b(sponsored|promoted|advertisement|paid partnership|advertorial)\b/i;

/** Whole-word disclosure check, shared by own text, alt text, and proximity. */
export function disclosesAdvertising(text: string): boolean {
  return DISCLOSURE_PATTERN.test(text);
}

function matchesAnyHost(url: string, hosts: readonly string[]): boolean {
  const hay = url.toLowerCase();
  return hosts.some((host) => hay.includes(host));
}

export function isKnownEmbed(url: string): boolean {
  return matchesAnyHost(url, EMBED_HOSTS);
}

export function isAdNetwork(url: string): boolean {
  return matchesAnyHost(url, AD_FRAME_HOSTS);
}

/**
 * Reduce an image URL to the host-only evidence allowed across the wire.
 *
 * Privacy invariant (hard): full URLs and tracking query strings never leave the
 * page. `URL.hostname` drops the path, query, fragment, credentials, and port in
 * one step. Relative URLs, inline `data:` payloads, and unparseable strings have no
 * host to disclose and yield `""`.
 */
export function imageHostOf(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (trimmed === "") return "";
  try {
    const host = new URL(trimmed).hostname.trim().toLowerCase();
    if (host === "") return "";
    return host;
  } catch {
    return "";
  }
}

/**
 * A cheap, attribute-only selector covering anything the token lists could match.
 *
 * Scanning every element on a heavy page and calling `getBoundingClientRect` on each one
 * forces a layout read per node, which is the classic way to make a content script
 * expensive. Narrowing with attribute selectors first keeps the candidate set small
 * without moving the token lists out of this file, where they are the single source of
 * truth.
 */
export function candidateSelector(): string {
  const parts: string[] = [];
  for (const token of [...AD_TOKENS, ...OVERLAY_TOKENS]) {
    parts.push(`[class*="${token}"]`, `[id*="${token}"]`);
  }
  parts.push(
    "iframe",
    "img",
    "picture",
    "[role='dialog']",
    "[aria-modal='true']",
    '[style*="background-image"]',
    '[style*="background:"]',
  );
  return parts.join(",");
}

/**
 * How far below `<body>` the sweep for size- and position-based candidates goes.
 *
 * Token-named ads are found anywhere by the selector above, but an unlabelled native ad
 * gives itself away through geometry alone, and measuring the whole tree to find it is not
 * worth the cost. Reserved slots and overlays sit near the top of the body in practice, so
 * the sweep stays shallow and the limitation is documented rather than hidden.
 */
export const LAYOUT_SCAN_DEPTH = 2;

/**
 * Keep only the outermost candidate in each nested group.
 *
 * An ad wrapper and the ad iframe inside it both look like ads, and acting on both means
 * asking two questions about one thing and removing a node whose parent is already gone.
 * The outermost element is the right one to hold: removing it takes the inner one with it,
 * and it is the one whose size and position the heuristics measured against the viewport.
 *
 * `ancestors` is the key chain from the candidate up to the root, which `dom.ts` can read
 * off the tree and tests can write by hand.
 */
export function pickOutermost<T extends { readonly key: string; readonly ancestors: readonly string[] }>(
  candidates: readonly T[],
): T[] {
  const keys = new Set(candidates.map((candidate) => candidate.key));
  return candidates.filter(
    (candidate) => !candidate.ancestors.some((ancestor) => keys.has(ancestor)),
  );
}

/**
 * Decide whether an element is worth spending a question on.
 *
 * This is the "fast search" half of the rerank pattern: cheap, local, and allowed to be
 * generous, because the expensive judgement comes afterwards. It is also allowed to be
 * blunt — a YouTube player is rejected outright rather than sent to be told it is not an
 * ad, because that call would cost tokens and, worse, would occasionally come back wrong.
 *
 * The cost of a miss is asymmetric. Not shortlisting an unlabelled native ad means it
 * stays on the page, which is the status quo. Shortlisting an article body means a
 * question that could, at the wrong threshold, take the article away.
 */
export function shortlistElement(descriptor: ElementDescriptor): ShortlistDecision {
  const tag = descriptor.tag.toLowerCase();
  const reasons: string[] = [];

  if (NEVER_AD_TAGS.has(tag)) {
    return { eligible: false, score: 0, reasons: [`\`${tag}\` is never an ad container`] };
  }

  if (descriptor.isIframe && isKnownEmbed(descriptor.iframeSrc)) {
    return { eligible: false, score: 0, reasons: ["known embed host, not advertising"] };
  }

  // Long, link-sparse text is content. Sending it would spend tokens to be told no, and
  // puts the article in the same request as the things we might delete.
  if (descriptor.textLength > SHORTLIST_LIMITS.maxTextLength && descriptor.linkDensity < 2) {
    return {
      eligible: false,
      score: 0,
      reasons: ["long text with low link density reads as content"],
    };
  }

  const identifiers = identifierTokens(descriptor);

  if (descriptor.isIframe && isAdNetwork(descriptor.iframeSrc)) {
    reasons.push("frame served by a known ad network");
  }
  for (const token of AD_TOKENS) {
    if (identifiers.has(token)) {
      reasons.push(`identifier contains the word "${token}"`);
      break;
    }
  }
  for (const token of OVERLAY_TOKENS) {
    if (identifiers.has(token)) {
      reasons.push(`identifier suggests an overlay: "${token}"`);
      break;
    }
  }
  if (
    (descriptor.position === "fixed" || descriptor.position === "sticky") &&
    descriptor.viewportRatio >= 0.35
  ) {
    reasons.push("fixed and covering much of the viewport");
  }
  if (descriptor.zIndex >= 1000 && descriptor.viewportRatio >= 0.15) {
    reasons.push("stacked above the page");
  }
  if (AD_DIMENSIONS.has(`${Math.round(descriptor.width)}x${Math.round(descriptor.height)}`)) {
    reasons.push("matches a standard ad size");
  }
  const ownDisclosure = disclosesAdvertising(descriptor.text);
  if (ownDisclosure) {
    reasons.push("its own text discloses advertising");
  }
  if (descriptor.isIframe && descriptor.iframeSrc !== "" && !isKnownEmbed(descriptor.iframeSrc)) {
    reasons.push("unrecognised third-party frame");
  }

  // Image evidence (ticket 04): each reason is weak alone, corroborating together.
  const imageReasons: string[] = [];
  if (descriptor.imageKind !== "none") {
    if (descriptor.imageHost !== "" && isAdNetwork(descriptor.imageHost)) {
      imageReasons.push("its image comes from a known ad network");
    }
    if (disclosesAdvertising(descriptor.imageAlt)) {
      imageReasons.push("its image alt text discloses advertising");
    }
    if (isResponsiveAdSize(descriptor.width, descriptor.height)) {
      imageReasons.push("its image dimensions match common ad ratios");
    }
    if (descriptor.hasProximityDisclosure) {
      imageReasons.push("nearby text discloses advertising");
    }
  }
  reasons.push(...imageReasons);

  if (descriptor.imageKind !== "none") {
    // Corroboration gate: a single weak image signal never shortlists on its own.
    // This is what keeps an image beside an article *about* advertising — one nearby
    // "sponsored" mention and nothing else — out of the candidate set, while units
    // with two corroborating signals (host plus ratios, alt plus proximity, …) pass.
    // Classic strong reasons (tokens, exact sizes, overlay geometry, frames) still
    // shortlist an image unit outright.
    const hasStrongReason = reasons.length - imageReasons.length - (ownDisclosure ? 1 : 0) > 0;
    const weakSignals = imageReasons.length + (ownDisclosure ? 1 : 0);
    if (!hasStrongReason && weakSignals < 2) {
      return {
        eligible: false,
        score: 0,
        reasons: ["an image unit with a single weak signal, held for corroboration"],
      };
    }
  }

  return { eligible: reasons.length > 0, score: reasons.length, reasons };
}

export interface RemovalGuard {
  readonly ok: boolean;
  readonly reason: string;
}

/**
 * The last line of defence, on the client.
 *
 * The server already refuses to `remove` under these conditions, so this is a second
 * check rather than the only one. It exists because the content script is the code that
 * actually destroys a node, and a client that trusts a response to be well-behaved is one
 * server-side config change away from deleting an article.
 */
export function mayRemove(descriptor: ElementDescriptor): RemovalGuard {
  const tag = descriptor.tag.toLowerCase();
  if (NEVER_AD_TAGS.has(tag)) return { ok: false, reason: `\`${tag}\` is protected` };
  if (descriptor.inMainContent) return { ok: false, reason: "it is inside main content" };
  // Structural image veto (ticket 05): figure/picture-with-caption structures are
  // hide-at-most, never removed — the server enforces the same cap, and this is the
  // client's second check against the live node.
  if (descriptor.inFigure) {
    return { ok: false, reason: "it is inside a figure/caption structure" };
  }
  if (descriptor.textLength > AD_REMOVE_TEXT_CAP) {
    return { ok: false, reason: `it carries ${descriptor.textLength} characters of text` };
  }
  if (descriptor.isIframe && isKnownEmbed(descriptor.iframeSrc)) {
    return { ok: false, reason: "it is a known embed host" };
  }
  return { ok: true, reason: "" };
}

export function toCandidate(
  id: string,
  descriptor: ElementDescriptor,
  reasons: readonly string[],
): AdCandidate {
  return {
    id,
    tag: descriptor.tag.toLowerCase(),
    idAttr: descriptor.id,
    classes: descriptor.classes,
    role: descriptor.role,
    ariaLabel: descriptor.ariaLabel,
    isIframe: descriptor.isIframe,
    iframeSrc: descriptor.iframeSrc,
    width: Math.round(descriptor.width),
    height: Math.round(descriptor.height),
    viewportRatio: Number(descriptor.viewportRatio.toFixed(3)),
    position: descriptor.position,
    zIndex: Math.round(descriptor.zIndex),
    textLength: descriptor.textLength,
    linkDensity: Number(descriptor.linkDensity.toFixed(2)),
    inMainContent: descriptor.inMainContent,
    text: descriptor.text.slice(0, AD_TEXT_SNIPPET_CHARS),
    imageKind: descriptor.imageKind,
    // Host-only by contract; `imageHostOf` is the single place a URL becomes a host.
    imageHost: descriptor.imageHost.trim().toLowerCase(),
    imageAlt: descriptor.imageAlt.slice(0, AD_IMAGE_ALT_CHARS),
    inFigure: descriptor.inFigure,
    reasons,
  };
}

// ---------------------------------------------------------------------------
// Feature 2: turning a page into searchable text
// ---------------------------------------------------------------------------

export const BLOCK_RULES = {
  /** Below this, a block is a label or a fragment and not worth a question option. */
  minWords: 4,
  /** Adjacent siblings this short get merged, so a heading rides with its paragraph. */
  mergeBelowWords: 15,
  /** Above this, a block is split on sentence boundaries. */
  splitAboveWords: 200,
  /** Cap per search. Two thousand blocks covers full long-form encyclopedic articles. */
  maxBlocks: 2000,
} as const;

/** Blocks are sent as single lines, so internal whitespace has to collapse. */
export function cleanBlockText(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

export function countWords(text: string): number {
  const cleaned = text.trim();
  return cleaned === "" ? 0 : cleaned.split(/\s+/).length;
}

export function isEligibleBlock(text: string): boolean {
  const cleaned = cleanBlockText(text);
  if (cleaned.length < 12) return false;
  return countWords(cleaned) >= BLOCK_RULES.minWords;
}

/**
 * Block ids travel inside the passage text as `b000| ...`, which is how the model points
 * at a block, so they stay as short as the number of blocks allows.
 */
export function blockId(index: number): string {
  return `b${index.toString().padStart(3, "0")}`;
}

export function toTextBlock(index: number, text: string): TextBlock {
  const cleaned = cleanBlockText(text);
  return { id: blockId(index), text: cleaned, words: countWords(cleaned) };
}

/** Offsets of one sentence inside its raw source text. Whitespace between sentences belongs to neither span. */
export interface SentenceSpan {
  readonly start: number;
  readonly end: number;
}

/** True when the text after a terminator starts a new sentence rather than continuing one. */
function isSentenceBoundary(raw: string, termEnd: number): boolean {
  let index = termEnd;
  while (index < raw.length && /\s/.test(raw[index] ?? "")) index += 1;
  if (index >= raw.length) return true;
  // An uppercase letter or opening mark starts a sentence. A digit deliberately does not,
  // so "3.5 million" never splits; a sentence that genuinely starts with a digit is the
  // accepted miss. Lowercase continuations ("...and on") stay joined.
  return /[\p{Lu}"“'(\[]/u.test(raw[index] ?? "");
}

/**
 * Split raw element text into sentence spans.
 *
 * A boundary is a run of `.`/`!`/`?`/`…` (plus closing quotes or brackets) followed by a
 * sentence start. A single uppercase letter before the dot (`U.S.A.`, `J. Smith`) is read
 * as an initialism, not a boundary. Abbreviations like `Mr.` or `etc.` still split; that
 * is the documented cost of a local heuristic, and the word floor filters the fragments.
 */
export function splitSentenceSpans(raw: string): SentenceSpan[] {
  if (raw === "") return [];
  const spans: SentenceSpan[] = [];
  const terminator = /[.!?…]+["')\]]*/gu;
  let from = 0;
  let match: RegExpExecArray | null;
  while ((match = terminator.exec(raw)) !== null) {
    const termStart = match.index;
    const termEnd = termStart + match[0].length;
    if (/([.\s]|^)[A-Z]$/.test(raw.slice(0, termStart))) continue;
    if (!isSentenceBoundary(raw, termEnd)) continue;
    spans.push({ start: from, end: termEnd });
    from = termEnd;
    while (from < raw.length && /\s/.test(raw[from] ?? "")) from += 1;
  }
  if (from < raw.length) spans.push({ start: from, end: raw.length });
  return spans;
}
