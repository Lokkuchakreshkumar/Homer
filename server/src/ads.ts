/**
 * Feature 1 policy: turn shortlisted DOM elements into Jev questions, then turn the
 * answers back into actions.
 *
 * The split matters. Jev supplies the judgment — "is this an ad?" — and this file owns
 * every rule about what may be done as a result. That keeps the destructive part of the
 * feature reviewable and testable without an API key, and it means a better model changes
 * the answers while the safety policy stays put.
 *
 * Questions are asked per candidate rather than once per category because a Noul is a
 * single yes/no. The docs call this speculative fan-out: independent questions over one
 * shared state, evaluated in parallel inside a single request. Adding questions costs a
 * few tokens, not a round trip.
 */

import { noul } from "@typesafe-ai/sdk";
import type { Questions } from "@typesafe-ai/sdk";
import type { AdAction, AdCandidate, AdCategory, AdVerdict } from "../shared/wire.ts";
import { AD_REMOVE_TEXT_CAP, AD_TEXT_SNIPPET_CHARS } from "../shared/wire.ts";

export { AD_TEXT_SNIPPET_CHARS };

export const AD_THRESHOLDS = {
  /** Probability at or above which a confirmed, unprotected node is removed from the DOM. */
  remove: 0.9,
  /** Probability at or above which a node is hidden but kept in the DOM. */
  hide: 0.6,
  /** Above this, the element counts as primary content and is never removed. */
  contentVeto: 0.5,
  /**
   * Elements carrying more text than this are hidden at most. Long text is content until
   * proven otherwise, and a wrong `remove()` on a 2,000-character node is unrecoverable
   * without a reload. Shared with the client's guard so the two cannot drift.
   */
  removeTextLengthCap: AD_REMOVE_TEXT_CAP,
  /** Ask the content-veto question once text reaches this length, or inside main content. */
  contentVetoTextLength: 160,
  /**
   * Candidates per upstream request. Each becomes up to 3 + 1 questions, and the state
   * carries every candidate, so this bounds both token spend and answer jaggedness.
   */
  maxCandidatesPerRequest: 48,
} as const;

/**
 * Nodes that are structurally never ads. A `<body>` "ad" means the judge is confused, and
 * the blast radius of acting on it is the whole page.
 */
export const PROTECTED_TAGS: ReadonlySet<string> = new Set([
  "html",
  "body",
  "head",
  "main",
  "article",
  "nav",
  "script",
  "style",
  "link",
  "meta",
]);

interface CategorySpec {
  /** Predicate substituted into "Is `candidates[i]` <predicate>?" */
  readonly predicate: string;
  readonly yes: string;
  readonly no: string;
}

/**
 * The three categories, each phrased to be answerable from structural signals alone.
 *
 * Each predicate names what the element *is used for*, not what it looks like, because
 * class names lie and the visual signals are only approximate in state. The `no` criteria
 * carry the load: they are where the false-positive cases get named, so the model is not
 * forced to guess what we mean by "not an ad".
 */
const CATEGORY_SPEC: Record<AdCategory, CategorySpec> = {
  overlay: {
    predicate:
      "a blocking overlay, interstitial, or modal popup that exists to promote something " +
      "(a subscription, newsletter, app install, discount, or survey) or to obstruct the " +
      "page's own content until the reader reacts to it",
    yes:
      "The element is a promotional or obstructive layer sitting over the page: a paywall " +
      "or newsletter interstitial, a cookie-consent-plus-marketing wall, an app-install " +
      "prompt, a discount popup, a survey takeover, or a covering image promo or popup " +
      "interstitial whose creative is image-delivered.",
    no:
      "The element is part of the page's own interface or content: site navigation, a " +
      "search box, a content dropdown, a media player control, a form the reader came to " +
      "fill in, a tooltip on real content, or a legitimate consent dialog that only asks " +
      "for a choice with no promotion attached.",
  },
  sponsored: {
    predicate:
      "a sponsored, promoted, or paid-advertising content block — including in-feed " +
      "native advertising, advertorials, and paid-partnership posts — that is presented " +
      "alongside the site's editorial content",
    yes:
      "The element is paid placement dressed as content: a 'Sponsored' or 'Promoted' or " +
      "'Paid partnership' card, a native ad inside a feed or article list, an advertorial, " +
      "a product block disclosed as advertising, an image-delivered creative (bare img, " +
      "picture/srcset, or background-image unit) carrying a disclosure, or a captioned " +
      "native unit disclosed as advertising.",
    no:
      "The element is the site's own editorial or organic content — a genuine news article, " +
      "a user's own post, an editorial photo or captioned figure the reader came for, a " +
      "brand logo or article illustration with no disclosure, a product listing the site " +
      "sells itself, or a related-links module with no advertising disclosure.",
  },
  adslot: {
    predicate:
      "a display-advertising slot — a container, placeholder, or iframe reserved for " +
      "programmatic or direct-sold advertising, including served banner, leaderboard, " +
      "sidebar, and in-article ad units",
    yes:
      "The element is an advertising unit: an ad iframe (DoubleClick, Google Ad Manager, " +
      "Prebid, Amazon TAM, Taboola, Outbrain, and similar), an image-delivered display " +
      "unit (img, picture/srcset, or background-image creative served from an ad host), " +
      "an ad container with ad-shaped dimensions, or an empty reserved slot where an ad " +
      "will render.",
    no:
      "The element is a legitimate embedded frame or reserved box: a YouTube or Vimeo " +
      "player, a map, a payment or login widget, a code sandbox, a user-uploaded embed, " +
      "an editorial image or captioned figure, or ordinary page layout that merely " +
      "happens to be an iframe or a fixed-size box.",
  },
};

/** One question slot, mapped back to the candidate and category that produced it. */
interface Slot {
  readonly key: string;
  readonly index: number;
  /** null means the content-veto question. */
  readonly category: AdCategory | null;
}

export interface QuestionPlan {
  readonly questions: Questions;
  readonly slots: readonly Slot[];
}

/** `candidates[3]` — the backticked path form the docs use to point at nested state. */
function candidatePath(index: number): string {
  return `\`candidates[${index}]\``;
}

/**
 * Ask the inverse question where a wrong answer is expensive.
 *
 * Speculative fan-out means we can afford to ask "is this actually the article?" about
 * the exact elements most likely to be a false positive, and let code ignore the answer
 * everywhere else. Veto questions are only planned for candidates where removal is
 * genuinely on the table.
 */
export function needsContentVeto(candidate: AdCandidate): boolean {
  if (candidate.inMainContent || candidate.textLength >= AD_THRESHOLDS.contentVetoTextLength) {
    return true;
  }
  // Image candidates always earn a veto question (ticket 05): a photo or captioned
  // figure the reader came for must get deterministic protection rather than risking
  // a misjudgment on category signal alone.
  return candidate.imageKind !== "none" || candidate.inFigure;
}

export function buildAdQuestions(
  candidates: readonly AdCandidate[],
  enabled: readonly AdCategory[],
): QuestionPlan {
  const questions: Record<string, ReturnType<typeof noul>> = {};
  const slots: Slot[] = [];

  candidates.forEach((_candidate, index) => {
    for (const category of enabled) {
      const spec = CATEGORY_SPEC[category];
      const key = `ad_${index}_${category}`;
      questions[key] = noul(
        `Is ${candidatePath(index)} ${spec.predicate}?`,
        { true: spec.yes, false: spec.no },
      );
      slots.push({ key, index, category });
    }
  });

  candidates.forEach((candidate, index) => {
    if (!needsContentVeto(candidate)) return;
    const key = `veto_${index}`;
    questions[key] = noul(
      `Is ${candidatePath(index)} the page's own primary editorial content — the body of ` +
        `the article, the headline, the reader's own post, an editorial photo or captioned ` +
        `figure — or a container holding that content?`,
      {
        true: "Removing this element would delete content the reader came to the page for, " +
          "including editorial photos, figures, and their captions.",
        false: "This element is not the reader's primary content; it is ancillary.",
      },
    );
    slots.push({ key, index, category: null });
  });

  return { questions, slots };
}

/** Split candidates so no single request carries too many questions. */
export function chunkCandidates(
  candidates: readonly AdCandidate[],
  size: number = AD_THRESHOLDS.maxCandidatesPerRequest,
): AdCandidate[][] {
  const chunks: AdCandidate[][] = [];
  for (let i = 0; i < candidates.length; i += size) {
    chunks.push(candidates.slice(i, i + size));
  }
  return chunks;
}

/** The largest probability among the enabled categories, and which one it was. */
function strongest(
  probabilities: Readonly<Partial<Record<AdCategory, number>>>,
  enabled: readonly AdCategory[],
): { category: AdCategory | null; probability: number } {
  let category: AdCategory | null = null;
  let probability = 0;
  for (const candidate of enabled) {
    const value = probabilities[candidate] ?? 0;
    if (value > probability) {
      probability = value;
      category = candidate;
    }
  }
  return { category, probability };
}

function verdictFor(
  candidate: AdCandidate,
  enabled: readonly AdCategory[],
  probabilities: Readonly<Partial<Record<AdCategory, number>>>,
  contentVeto: number | null,
): AdVerdict {
  const { category, probability } = strongest(probabilities, enabled);
  const base = { id: candidate.id, category, probability, probabilities, contentVeto };
  const decide = (action: AdAction, reason: string): AdVerdict => ({ ...base, action, reason });
  // Auditable image verdicts (ticket 05): host travels with the reason so the removal
  // log explains which image source was judged, at which confidence.
  const hostSuffix = candidate.imageHost !== "" ? ` (image host: ${candidate.imageHost})` : "";
  const isImage = candidate.imageKind !== "none";

  if (PROTECTED_TAGS.has(candidate.tag)) {
    return decide("keep", `\`${candidate.tag}\` is a protected structural element`);
  }

  const veto = contentVeto ?? 0;
  if (veto >= AD_THRESHOLDS.contentVeto) {
    // The judge thinks this is an ad and also thinks it is the article. The second answer
    // is the one that protects the reader, so it wins. Hide only, and only for the case
    // where an overlay is genuinely sitting over the content.
    const coveringOverlay =
      category === "overlay" && probability >= 0.97 && !candidate.inMainContent;
    if (coveringOverlay) {
      return decide("hide", "overlay over the content, hidden but not removed (content flag)");
    }
    if (isImage) {
      // Strict structural image veto: a vetoed image with real ad signal hides at most —
      // never removed, never left painting when the judge is confident it is an ad. With
      // no ad signal at all, it is kept like any below-threshold candidate.
      if (probability < AD_THRESHOLDS.hide) {
        return decide("keep", `possibly primary content (${veto.toFixed(2)}); left untouched`);
      }
      return decide(
        "hide",
        `image candidate flagged as possible content (${veto.toFixed(2)}); hidden, not removed${hostSuffix}`,
      );
    }
    return decide("keep", `possibly primary content (${veto.toFixed(2)}); left untouched`);
  }

  if (probability < AD_THRESHOLDS.hide) {
    return decide("keep", `below hide threshold (${probability.toFixed(2)})`);
  }

  if (probability < AD_THRESHOLDS.remove) {
    return decide("hide", `${category} at ${probability.toFixed(2)}, below remove threshold${hostSuffix}`);
  }

  // Confident it is an ad. Two guards remain — three for images, where
  // figure/picture-with-caption structures hide at most, like main content.
  if (candidate.inMainContent || candidate.inFigure) {
    const where =
      candidate.inFigure && !candidate.inMainContent
        ? "inside a figure/caption structure"
        : "inside main content";
    return decide("hide", `${category} but ${where}; hidden, not removed${hostSuffix}`);
  }
  if (candidate.textLength > AD_THRESHOLDS.removeTextLengthCap) {
    return decide(
      "hide",
      `${category} carrying ${candidate.textLength} characters of text; hidden, not removed${hostSuffix}`,
    );
  }
  return decide("remove", `${category} at ${probability.toFixed(2)}${hostSuffix}`);
}

/**
 * Fold Noul probabilities back into verdicts.
 *
 * `nouls` is keyed by the question keys `buildAdQuestions` produced. Missing keys are
 * treated as zero rather than throwing, so a partial upstream failure degrades into
 * "leave it alone" instead of a page-level error.
 */
export function applyAdVerdicts(
  candidates: readonly AdCandidate[],
  enabled: readonly AdCategory[],
  plan: QuestionPlan,
  nouls: Readonly<Record<string, number>>,
): AdVerdict[] {
  const byIndex = new Map<number, Partial<Record<AdCategory, number>>>();
  const vetoByIndex = new Map<number, number>();

  for (const slot of plan.slots) {
    const value = nouls[slot.key] ?? 0;
    if (slot.category === null) {
      vetoByIndex.set(slot.index, value);
      continue;
    }
    const bucket = byIndex.get(slot.index) ?? {};
    bucket[slot.category] = value;
    byIndex.set(slot.index, bucket);
  }

  return candidates.map((candidate, index) =>
    verdictFor(
      candidate,
      enabled,
      byIndex.get(index) ?? {},
      vetoByIndex.has(index) ? (vetoByIndex.get(index) ?? 0) : null,
    ),
  );
}
