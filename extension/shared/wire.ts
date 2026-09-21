/**
 * Wire contract between the browser extension and the local Jev proxy.
 *
 * The extension never talks to api.typesafe.ai directly. A live preflight against the
 * API returns `400 Disallowed CORS origin` for an extension origin, and the SDK's own
 * `dangerouslyAllowBrowser` flag documents the exposure risk. So the proxy holds the key
 * and the extension speaks this contract over localhost.
 *
 * Everything crossing this boundary is structured data, never raw DOM. The content
 * script reduces a page to the fields below before anything leaves the browser.
 */

/** One entry per request/response cycle, for the popup's cost and privacy panel. */
export interface UsageTotals {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costUsd: number;
  /** Number of upstream HTTP requests actually billed (cache misses). */
  readonly upstreamRequests: number;
  /** Number of logical calls served from cache. */
  readonly cacheHits: number;
  readonly model: string | null;
}

export function emptyUsage(): UsageTotals {
  return {
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    upstreamRequests: 0,
    cacheHits: 0,
    model: null,
  };
}

export function addUsage(a: UsageTotals, b: UsageTotals): UsageTotals {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    costUsd: a.costUsd + b.costUsd,
    upstreamRequests: a.upstreamRequests + b.upstreamRequests,
    cacheHits: a.cacheHits + b.cacheHits,
    model: b.model ?? a.model,
  };
}

/** Bookkeeping the extension shows in the popup. */
export interface ResponseMeta {
  /** Wall-clock milliseconds spent inside the proxy. */
  readonly elapsedMs: number;
  /** True when the whole answer came from the proxy's cache. */
  readonly cached: boolean;
  /** Choice questions needed beyond the 255-option ceiling, if any. */
  readonly passes?: number;
  /** Non-fatal problems worth surfacing rather than hiding. */
  readonly warnings: readonly string[];
}

// ---------------------------------------------------------------------------
// Feature 1: ad judgment
// ---------------------------------------------------------------------------

/** The three independently toggleable ad categories. */
export type AdCategory = "overlay" | "sponsored" | "adslot";

export const AD_CATEGORIES: readonly AdCategory[] = ["overlay", "sponsored", "adslot"];

export const AD_CATEGORY_LABELS: Record<AdCategory, string> = {
  overlay: "Blocking overlays & popups",
  sponsored: "Sponsored / promoted content",
  adslot: "Display ad slots",
};

/**
 * How much element text may leave the browser.
 *
 * Enough to read a label such as "Sponsored" or "Subscribe to continue", never enough to
 * carry an article. The proxy truncates to this again, so a modified client cannot send
 * more than the content script was willing to disclose.
 */
export const AD_TEXT_SNIPPET_CHARS = 240;

/**
 * How much image alt/accessible text may leave the browser.
 *
 * Same snippet-length discipline as element text: enough to read a disclosure
 * ("Sponsored", "Advertisement") in alt or aria-label, never enough to carry an
 * article. The proxy truncates to this again, so a modified client cannot send more.
 */
export const AD_IMAGE_ALT_CHARS = 120;

/** Image-delivery shape of a candidate. `none` means no image evidence was found. */
export type ImageKind = "none" | "img" | "picture" | "background";

const IMAGE_KINDS: readonly ImageKind[] = ["none", "img", "picture", "background"];

/** Narrow an unknown wire value to `ImageKind`; anything else means no image evidence. */
export function isImageKind(value: unknown): value is ImageKind {
  return typeof value === "string" && (IMAGE_KINDS as readonly string[]).includes(value);
}

/**
 * Longest host-only image evidence the proxy accepts.
 *
 * 253 is the maximum DNS hostname length: anything longer is not a host the client
 * extracted, so the proxy caps it here rather than passing it to the judge.
 */
export const AD_IMAGE_HOST_CHARS = 253;

/**
 * Above this much text, a node is hidden but never deleted.
 *
 * Shared with the client's own guard so the two cannot drift: the server refuses to issue
 * `remove` past this length, and the content script refuses to carry one out.
 */
export const AD_REMOVE_TEXT_CAP = 400;

/**
 * Structural signals the content script may disclose about one element.
 *
 * This is a deliberately closed whitelist, not a DOM dump: no cookies, no URLs of the
 * page itself, no form values, no full text. `text` is truncated to
 * `AD_TEXT_SNIPPET_CHARS` because the judge needs to read the label ("Sponsored",
 * "Subscribe to continue") but not the article.
 */
export interface AdSignals {
  readonly tag: string;
  readonly idAttr: string;
  readonly classes: readonly string[];
  readonly role: string;
  readonly ariaLabel: string;
  readonly isIframe: boolean;
  readonly iframeSrc: string;
  readonly width: number;
  readonly height: number;
  /** Fraction of the viewport area the element covers, 0..1. */
  readonly viewportRatio: number;
  readonly position: string;
  readonly zIndex: number;
  readonly textLength: number;
  /** Links per 100 characters of text. Ad and nav chrome is link-dense. */
  readonly linkDensity: number;
  /** True when inside `<main>`, `<article>`, or `[role=main]`. */
  readonly inMainContent: boolean;
  /** Truncated visible text. */
  readonly text: string;
  /** Which heuristics shortlisted this element. Explains the decision to the model. */
  readonly reasons: readonly string[];
  /**
   * Compact image evidence (ticket 05; populated by ticket 04's collection).
   *
   * Closed whitelist like the rest of this contract: `imageHost` is host-only,
   * extracted client-side — full image URLs and tracking query strings never leave
   * the page. `imageAlt` is truncated to `AD_IMAGE_ALT_CHARS`. `inFigure` marks
   * figure/picture-with-caption structures, which are hide-at-most, never removed.
   */
  readonly imageKind: ImageKind;
  readonly imageHost: string;
  readonly imageAlt: string;
  readonly inFigure: boolean;
}

export interface AdCandidate extends AdSignals {
  /** Stable per-page id, e.g. "c12". The content script maps it back to a node. */
  readonly id: string;
}

/** `remove` is destructive and only ever issued for confirmed, unprotected nodes. */
export type AdAction = "remove" | "hide" | "keep";

export interface AdVerdict {
  readonly id: string;
  readonly action: AdAction;
  readonly category: AdCategory | null;
  /** Highest probability across the enabled categories. This drives the action. */
  readonly probability: number;
  readonly probabilities: Readonly<Partial<Record<AdCategory, number>>>;
  /** Probability the element is primary content. Null when not asked. */
  readonly contentVeto: number | null;
  /** Human-readable justification, shown in the popup's removal log. */
  readonly reason: string;
}

export interface JudgeAdsRequest {
  readonly pageUrl: string;
  readonly enabled: readonly AdCategory[];
  readonly candidates: readonly AdCandidate[];
}

export interface JudgeAdsResponse {
  readonly verdicts: readonly AdVerdict[];
  readonly usage: UsageTotals;
  readonly meta: ResponseMeta;
}

// ---------------------------------------------------------------------------
// Feature 2: semantic find
// ---------------------------------------------------------------------------

export interface TextBlock {
  /** Same id space as the Choice criteria, e.g. "b042". */
  readonly id: string;
  readonly text: string;
  readonly words: number;
}

export interface SearchRequest {
  readonly pageUrl: string;
  readonly query: string;
  readonly blocks: readonly TextBlock[];
}

export type MatchTier = "strong" | "loose";

export interface SearchHit {
  readonly id: string;
  /** Post-merge relevance, comparable across windows. */
  readonly relevance: number;
  readonly tier: MatchTier;
}

/** Mirrors the cookbook's three-way `verdict()` on the `exists` probability. */
export type SearchVerdict = "answered" | "partial" | "absent";

export interface SearchResponse {
  readonly verdict: SearchVerdict;
  /** Probability the document addresses the query at all. */
  readonly exists: number;
  readonly hits: readonly SearchHit[];
  readonly usage: UsageTotals;
  readonly meta: ResponseMeta;
}

// ---------------------------------------------------------------------------
// Health & stats
// ---------------------------------------------------------------------------

export interface HealthResponse {
  readonly ok: true;
  readonly mode: "jev" | "stub";
  readonly model: string;
  readonly version: string;
}

export interface StatsResponse {
  readonly totals: UsageTotals;
  readonly adsJudged: number;
  readonly searches: number;
  readonly cacheEntries: number;
}
