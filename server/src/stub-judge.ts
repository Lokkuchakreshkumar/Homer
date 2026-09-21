/**
 * A deterministic, offline stand-in for Jev.
 *
 * Two jobs. It lets the test suite exercise the full pipeline — windowing, question
 * construction, probability parsing, thresholding, merging — with no key, no network, and
 * no spend. And it lets the extension be developed end to end before a key exists.
 *
 * It is a stand-in, not a model. It scores keyword and structural overlap, so it will
 * agree with Jev on an obvious ad with `class="ad-container"` and disagree on an
 * unlabelled native ad, which is exactly the case Jev is there to handle. Its categories
 * are detected from the *instruction text* rather than from question keys so that a
 * malformed or ambiguous instruction shows up as a test failure instead of passing
 * silently.
 */

import type { Questions } from "@typesafe-ai/sdk";
import type { Judge, JudgeResult } from "./judge.ts";
import type { AdCandidate, AdCategory } from "../shared/wire.ts";

const STOPWORDS: ReadonlySet<string> = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "is", "are", "was", "were", "for", "on",
  "at", "by", "with", "from", "that", "this", "it", "as", "be", "has", "have", "had", "not",
  "but", "you", "your", "we", "our", "they", "their", "its", "into", "than", "then", "there",
  "here", "what", "which", "who", "whom", "whose", "when", "where", "why", "how", "does",
  "do", "did", "can", "could", "should", "would", "will", "about", "am", "if", "he", "she",
  "me", "my", "no", "so", "up", "us", "im", "id", "el", "la", "le",
]);

/** Split identifier-ish strings on separators and camelCase boundaries. */
export function tokenize(text: string): string[] {
  return text
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/'s\b/gi, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 2 && !STOPWORDS.has(token));
}

/** Basic English stemmer for common suffixes (plurals, possessives, participle). */
export function stemToken(token: string): string {
  if (token.length <= 3) return token;
  if (token.endsWith("'s")) return token.slice(0, -2);
  if (token.endsWith("ies") && token.length > 4) return token.slice(0, -3) + "y";
  if (token.endsWith("ing") && token.length > 5) return token.slice(0, -3);
  if (token.endsWith("ed") && token.length > 4) return token.slice(0, -2);
  if (token.endsWith("es") && token.length > 4) return token.slice(0, -2);
  if (token.endsWith("s") && !token.endsWith("ss") && token.length > 3) return token.slice(0, -1);
  return token;
}

/** Aggressive comparison form: "whitehouse" and "White House" both become "whitehouse". */
function compress(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, "");
}

const AD_KEYWORDS: Record<AdCategory, readonly string[]> = {
  overlay: [
    "overlay", "modal", "popup", "interstitial", "paywall", "subscribe", "subscription",
    "newsletter", "signup", "consent", "gdpr", "cookie", "appinstall", "install", "promo",
    "discount", "survey", "takeover", "sticky", "blocker",
  ],
  sponsored: [
    "sponsored", "promoted", "promotion", "paid", "partnership", "advertorial", "native",
    "ad", "ads", "advert", "advertisement", "brandvoice",
  ],
  adslot: [
    "ad", "ads", "advert", "advertisement", "banner", "leaderboard", "skyscraper",
    "googleads", "gpt", "prebid", "doubleclick", "dfp", "taboola", "outbrain", "adslot",
    "sponsor",
  ],
};

function candidateHaystack(candidate: AdCandidate): Set<string> {
  const parts: string[] = [candidate.idAttr, candidate.ariaLabel, candidate.text];
  for (const cls of candidate.classes) parts.push(cls);
  for (const reason of candidate.reasons) parts.push(reason);
  if (candidate.iframeSrc !== "") parts.push(candidate.iframeSrc);
  // Compact image evidence (ticket 05): host-only source plus the short alt snippet.
  // Host tokens match ad-network keywords (e.g. "doubleclick" in "x.doubleclick.net");
  // alt disclosure tokens ("sponsored", "advertisement") match the category keywords.
  if (candidate.imageHost !== "") parts.push(candidate.imageHost);
  if (candidate.imageAlt !== "") parts.push(candidate.imageAlt);
  const tokens = new Set<string>();
  for (const part of parts) {
    for (const token of tokenize(part)) tokens.add(token);
  }
  return tokens;
}

/** What a question is asking, inferred from its wording. */
export type StubQuestionKind = AdCategory | "veto" | "exists" | "unknown";

/**
 * Read the kind out of the instruction rather than the question key.
 *
 * The keys are code's business and are never sent to the model, so a test double that
 * used them would keep passing while the real instruction said something else entirely.
 */
export function detectQuestionKind(instruction: string): StubQuestionKind {
  const text = instruction.toLowerCase();
  if (text.includes("primary editorial content")) return "veto";
  if (text.includes("blocking overlay")) return "overlay";
  if (text.includes("sponsored, promoted")) return "sponsored";
  if (text.includes("display-advertising slot")) return "adslot";
  if (text.includes("address, match, or answer")) return "exists";
  return "unknown";
}

export function candidateIndexFrom(instruction: string): number | null {
  const match = /candidates\[(\d+)\]/.exec(instruction);
  return match?.[1] === undefined ? null : Number(match[1]);
}

export function windowKeyFrom(instruction: string): string | null {
  const match = /passages\.([A-Za-z0-9_]+)/.exec(instruction);
  return match?.[1] ?? null;
}

/** Structural corroboration, the way a reader uses size and position rather than names. */
function structuralBonus(candidate: AdCandidate, category: AdCategory): number {
  let bonus = 0;
  if (category === "overlay") {
    if (candidate.position === "fixed" && candidate.viewportRatio >= 0.35) bonus += 1;
    if (candidate.zIndex >= 1000) bonus += 1;
  }
  if (category === "adslot" && candidate.isIframe) bonus += 1;
  if (category === "adslot" && candidate.viewportRatio <= 0.35) bonus += 1;
  return bonus;
}

export function stubAdProbability(candidate: AdCandidate, category: AdCategory): number {
  const haystack = candidateHaystack(candidate);
  let hits = 0;
  for (const keyword of AD_KEYWORDS[category]) {
    if (haystack.has(keyword)) hits += 1;
  }
  if (hits === 0) return 0.07;
  // Structural evidence corroborates a labelled ad; it never creates one from nothing.
  // Giving points for "a box of plausible size" on its own would drag ordinary page
  // furniture over the hide threshold, and the shortlist already used size to get here.
  hits += structuralBonus(candidate, category);
  return Math.min(0.97, 0.45 + Math.min(hits, 3) * 0.18);
}

export function stubVetoProbability(candidate: AdCandidate): number {
  // Advertising chrome is never the reader's article, whatever its position in the tree.
  const haystack = candidateHaystack(candidate);
  for (const category of ["overlay", "sponsored", "adslot"] as const) {
    for (const keyword of AD_KEYWORDS[category]) {
      if (keyword.length >= 5 && haystack.has(keyword)) return 0.05;
    }
  }
  if (candidate.inMainContent) return 0.9;
  // A captioned figure photo reads as content the reader came for — unless ad
  // keywords already fired above, which return early precisely so disclosures win.
  if (candidate.inFigure) return 0.9;
  if (candidate.textLength >= 1200) return 0.85;
  if (candidate.textLength >= 200 && candidate.linkDensity <= 1) return 0.6;
  return 0.1;
}

/** Score one tagged passage's blocks against the query and soften into a distribution. */
export function rankPassage(query: string, passage: string): Record<string, number> {
  const queryTokens = [...new Set(tokenize(query))];
  const queryStems = queryTokens.map(stemToken);
  const compressedQuery = compress(query);

  interface ParsedBlock {
    readonly id: string;
    readonly tokens: ReadonlySet<string>;
    readonly stems: ReadonlySet<string>;
    readonly comp: string;
  }

  const parsed: ParsedBlock[] = [];
  for (const line of passage.split("\n")) {
    const separator = line.indexOf("|");
    if (separator < 0) continue;
    const id = line.slice(0, separator).trim();
    const body = line.slice(separator + 1);
    if (id === "") continue;

    const tokens = new Set(tokenize(body));
    const stems = new Set([...tokens].map(stemToken));
    const comp = compress(body);
    parsed.push({ id, tokens, stems, comp });
  }

  if (parsed.length === 0 || queryTokens.length === 0) return {};

  // Compute Document Frequency (DF) across blocks in this passage to weight rare terms higher (IDF).
  // E.g., on an Elon Musk page, "Elon" appears in almost every block (high DF -> low IDF),
  // while "brother" appears in only 1-2 blocks (low DF -> high IDF).
  const N = parsed.length;
  const docFreq = new Map<string, number>();
  for (let i = 0; i < queryTokens.length; i++) {
    const qToken = queryTokens[i]!;
    const qStem = queryStems[i]!;
    let df = 0;
    for (const b of parsed) {
      if (
        b.tokens.has(qToken) ||
        b.stems.has(qStem) ||
        (qToken.length >= 4 && b.comp.includes(qToken))
      ) {
        df += 1;
      }
    }
    docFreq.set(qToken, df);
  }

  const idf = new Map<string, number>();
  for (const qToken of queryTokens) {
    const df = docFreq.get(qToken) ?? 0;
    const weight = df > 0 ? Math.log(1 + (N - df + 0.5) / (df + 0.5)) + 1.0 : 0;
    idf.set(qToken, weight);
  }

  const scored: { id: string; score: number }[] = [];
  let maxScore = 0;

  for (const b of parsed) {
    let score = 0;
    let matchedTerms = 0;

    for (let i = 0; i < queryTokens.length; i++) {
      const qToken = queryTokens[i]!;
      const qStem = queryStems[i]!;
      const weight = idf.get(qToken) ?? 1.0;

      if (b.tokens.has(qToken)) {
        score += weight * 3.0;
        matchedTerms += 1;
      } else if (b.stems.has(qStem)) {
        score += weight * 2.2;
        matchedTerms += 1;
      } else if (qToken.length >= 4 && b.comp.includes(qToken)) {
        score += weight * 1.0;
        matchedTerms += 1;
      }
    }

    // Coordination bonus: matching multiple distinct query terms in the same block
    // provides strong confidence (e.g. both "elon" AND "brother").
    if (queryTokens.length > 1 && matchedTerms > 1) {
      score *= 1 + (matchedTerms - 1) * 0.6;
    }

    // Exact phrase / concatenated query match bonus.
    if (compressedQuery.length >= 4 && b.comp.includes(compressedQuery)) {
      score += 6.0;
    }

    if (score > maxScore) maxScore = score;
    scored.push({ id: b.id, score });
  }

  if (maxScore === 0) return {};

  // Softmax with temperature 4.5 ensures clear winners while preserving reasonable
  // distribution for top candidate hits without zeroing them out below the relevance floor.
  const temperature = 4.5;
  const weights = scored.map((entry) =>
    entry.score > 0 ? Math.exp((entry.score - maxScore) / temperature) : 0,
  );
  const total = weights.reduce((sum, weight) => sum + weight, 0);

  const distribution: Record<string, number> = {};
  scored.forEach((entry, index) => {
    distribution[entry.id] = total > 0 ? (weights[index] ?? 0) / total : 0;
  });
  return distribution;
}

/** Does this passage address the query at all? A `Noul` needs a probability, not a rank. */
export function stubExistsProbability(query: string, passage: string): number {
  const queryTokens = new Set(tokenize(query));
  const compressedQuery = compress(query);
  let bestOverlap = 0;
  for (const line of passage.split("\n")) {
    const separator = line.indexOf("|");
    if (separator < 0) continue;
    const body = line.slice(separator + 1);
    const compressedBody = compress(body);
    if (compressedQuery.length >= 4 && compressedBody.includes(compressedQuery)) return 0.92;
    let overlap = 0;
    const bodyTokens = new Set(tokenize(body));
    const bodyStems = new Set([...bodyTokens].map(stemToken));
    for (const token of queryTokens) {
      const stem = stemToken(token);
      if (bodyTokens.has(token)) {
        overlap += 1;
      } else if (bodyStems.has(stem)) {
        overlap += 1;
      } else if (token.length >= 4 && compressedBody.includes(token)) {
        overlap += 1;
      }
    }
    bestOverlap = Math.max(bestOverlap, overlap);
  }
  if (bestOverlap >= 2) return 0.85;
  // One shared word is weak evidence: it clears the partial bar (0.2) without reaching
  // the answered one (0.5), so the offline stub mirrors the three-way verdict contract
  // instead of only ever emitting answered-or-absent (ticket 08).
  if (bestOverlap === 1) return 0.35;
  return 0.05;
}

/** How concentrated a distribution is, on the same footing as the API's `confidence`. */
function concentration(probabilities: Readonly<Record<string, number>>): number {
  const values = Object.values(probabilities);
  if (values.length === 0) return 0;
  const best = Math.max(...values);
  if (values.length === 1) return best;
  // 0 when every option is equally likely, 1 when one option takes everything.
  return Math.max(0, Math.min(1, (best * values.length - 1) / (values.length - 1)));
}

interface StubState {
  candidates?: AdCandidate[];
  query?: string;
  passages?: Record<string, string>;
}

function stubNoul(state: StubState, kind: StubQuestionKind, instructions: string): number {
  if (kind === "exists") {
    const windowKey = windowKeyFrom(instructions);
    if (windowKey === null) return 0;
    return stubExistsProbability(state.query ?? "", state.passages?.[windowKey] ?? "");
  }

  const index = candidateIndexFrom(instructions);
  if (index === null) return 0;
  const candidate = state.candidates?.[index];
  if (candidate === undefined) return 0;

  if (kind === "veto") return stubVetoProbability(candidate);
  if (kind === "unknown") return 0;
  return stubAdProbability(candidate, kind);
}

/**
 * The offline judge. Selected when `JEV_FAKE=1` or when no API key is configured, so the
 * extension is usable and testable before a key exists.
 */
export class StubJudge implements Judge {
  readonly mode = "stub" as const;
  readonly model = "stub-1";

  async ask(state: unknown, questions: Questions): Promise<JudgeResult> {
    const parsed = (state ?? {}) as StubState;
    const answers: Record<string, unknown> = {};
    let outputTokens = 0;

    for (const [key, question] of Object.entries(questions)) {
      const instructions =
        typeof question.instructions === "string" ? question.instructions : "";
      const kind = detectQuestionKind(instructions);

      if (question.type === "noul") {
        answers[key] = { type: "noul", noul: stubNoul(parsed, kind, instructions) };
        outputTokens += 2;
        continue;
      }

      const windowKey = windowKeyFrom(instructions);
      const passage = windowKey === null ? "" : (parsed.passages?.[windowKey] ?? "");
      const probabilities = rankPassage(parsed.query ?? "", passage);

      let choice = "";
      let best = -1;
      for (const [label, probability] of Object.entries(probabilities)) {
        if (probability > best) {
          best = probability;
          choice = label;
        }
      }
      answers[key] = {
        type: "choice",
        choice,
        confidence: concentration(probabilities),
        probabilities,
      };
      outputTokens += Object.keys(probabilities).length + 2;
    }

    return {
      answers,
      // Rough, and deliberately generous: the point is that cost is visible, not audited.
      inputTokens: Math.ceil(JSON.stringify(state).length / 4),
      outputTokens,
      model: this.model,
    };
  }
}
