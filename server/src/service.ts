/**
 * The two features, orchestrated.
 *
 * Kept separate from the HTTP plumbing so the interesting logic can be exercised directly
 * from tests, and so the failure policy is stated once in each direction:
 *
 * - Ad judgment fails soft. A failed chunk yields `keep` verdicts, because the content
 *   script has already hidden candidates provisionally and the safe recovery is to put
 *   the page back rather than leave holes in it.
 * - Semantic find fails loud. Nothing destructive is pending, and "no matches" is a
 *   meaningful answer that a transport error must not be allowed to impersonate.
 */

import type { Judge, JudgeResult } from "./judge.ts";
import { readChoices, readNouls } from "./judge.ts";
import { LruCache, hashKey } from "./cache.ts";
import { costOf } from "./cost.ts";
import { applyAdVerdicts, buildAdQuestions, chunkCandidates } from "./ads.ts";
import {
  buildSearchQuestions,
  buildSearchState,
  mergeSearchResults,
  windowBlocks,
} from "./search.ts";
import { addUsage, emptyUsage } from "../shared/wire.ts";
import type {
  AdCandidate,
  AdVerdict,
  JudgeAdsRequest,
  JudgeAdsResponse,
  SearchRequest,
  SearchResponse,
  StatsResponse,
  TextBlock,
  UsageTotals,
} from "../shared/wire.ts";
import { AD_CATEGORIES } from "../shared/wire.ts";

/**
 * Jev's state budget is 32k tokens. At a rough four characters per token that is about
 * 128k characters; this leaves headroom for the questions themselves.
 */
export const SEARCH_MAX_STATE_CHARS = 100_000;

export class UpstreamError extends Error {
  readonly status: number;

  constructor(message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "UpstreamError";
    this.status = 502;
  }
}

function usageFrom(result: JudgeResult, upstreamRequests: number): UsageTotals {
  return {
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    costUsd: costOf(result.inputTokens, result.outputTokens),
    upstreamRequests,
    cacheHits: 0,
    model: result.model,
  };
}

/** Keep the state inside the model's per-request budget, and say so when we trim. */
function clampBlocks(
  blocks: readonly TextBlock[],
  maxChars: number,
): { blocks: TextBlock[]; truncated: boolean } {
  const kept: TextBlock[] = [];
  let used = 0;
  for (const block of blocks) {
    const cost = block.text.length + block.id.length + 3;
    if (used + cost > maxChars) return { blocks: kept, truncated: true };
    used += cost;
    kept.push(block);
  }
  return { blocks: kept, truncated: false };
}

export function describeError(cause: unknown): string {
  if (cause instanceof Error) {
    const status = (cause as { status?: unknown }).status;
    return typeof status === "number" ? `${cause.message} (HTTP ${status})` : cause.message;
  }
  return String(cause);
}

export interface JevServiceOptions {
  readonly judge: Judge;
  /** Why this judge was chosen, surfaced in /health so the mode is never a mystery. */
  readonly judgeReason: string;
}

export class JevService {
  readonly judge: Judge;
  readonly judgeReason: string;
  readonly #adCache = new LruCache<AdVerdict>(2000);
  readonly #searchCache = new LruCache<SearchResponse>(200);
  #totals: UsageTotals = emptyUsage();
  #adsJudged = 0;
  #searches = 0;

  constructor(options: JevServiceOptions) {
    this.judge = options.judge;
    this.judgeReason = options.judgeReason;
  }

  /**
   * Judge shortlisted elements.
   *
   * Cached per candidate, so re-scanning a page after a DOM mutation only pays for what
   * actually changed instead of re-judging the whole shortlist.
   */
  async judgeAds(request: JudgeAdsRequest): Promise<JudgeAdsResponse> {
    const started = Date.now();
    const warnings: string[] = [];

    const enabled = AD_CATEGORIES.filter((category) => request.enabled.includes(category));
    if (enabled.length === 0 || request.candidates.length === 0) {
      return {
        verdicts: [],
        usage: emptyUsage(),
        meta: {
          elapsedMs: Date.now() - started,
          cached: false,
          warnings: enabled.length === 0 ? ["no ad categories are enabled"] : [],
        },
      };
    }

    const verdicts = new Map<string, AdVerdict>();
    const pending: AdCandidate[] = [];
    const keyById = new Map<string, string>();
    let cacheHits = 0;

    for (const candidate of request.candidates) {
      if (keyById.has(candidate.id) || verdicts.has(candidate.id)) continue;
      const key = hashKey({ v: 1, enabled, candidate });
      const hit = this.#adCache.get(key);
      if (hit !== undefined) {
        verdicts.set(candidate.id, hit);
        cacheHits += 1;
        continue;
      }
      keyById.set(candidate.id, key);
      pending.push(candidate);
    }

    let usage = emptyUsage();

    for (const chunk of chunkCandidates(pending)) {
      const state = { page_url: request.pageUrl, candidates: chunk };
      const plan = buildAdQuestions(chunk, enabled);
      try {
        const result = await this.judge.ask(state, plan.questions);
        const chunkVerdicts = applyAdVerdicts(chunk, enabled, plan, readNouls(result.answers));
        for (const verdict of chunkVerdicts) {
          const key = keyById.get(verdict.id);
          if (key !== undefined) this.#adCache.set(key, verdict);
          verdicts.set(verdict.id, verdict);
        }
        usage = addUsage(usage, usageFrom(result, 1));
      } catch (cause) {
        // Fail soft: everything in this chunk stays on the page.
        warnings.push(`judgment failed for ${chunk.length} element(s): ${describeError(cause)}`);
        for (const candidate of chunk) {
          verdicts.set(candidate.id, {
            id: candidate.id,
            action: "keep",
            category: null,
            probability: 0,
            probabilities: {},
            contentVeto: null,
            reason: "not judged: the proxy could not reach the model",
          });
        }
      }
    }

    // Preserve the caller's order, including any ids it sent twice.
    const ordered: AdVerdict[] = [];
    for (const candidate of request.candidates) {
      const verdict = verdicts.get(candidate.id);
      if (verdict !== undefined) ordered.push(verdict);
    }

    usage = { ...usage, cacheHits };
    this.#totals = addUsage(this.#totals, usage);
    this.#adsJudged += request.candidates.length;

    return {
      verdicts: ordered,
      usage,
      meta: {
        elapsedMs: Date.now() - started,
        cached: usage.upstreamRequests === 0 && cacheHits > 0,
        warnings,
      },
    };
  }

  /**
   * Rank the page's text blocks against a plain-language query.
   *
   * Empty results are distinguished from failed ones: an empty query and a page with no
   * readable text come back as `absent` with a warning, while a transport problem throws.
   */
  async semanticFind(request: SearchRequest): Promise<SearchResponse> {
    const started = Date.now();
    const query = request.query.trim();
    const warnings: string[] = [];

    const empty = (warning: string): SearchResponse => ({
      verdict: "absent",
      exists: 0,
      hits: [],
      usage: emptyUsage(),
      meta: { elapsedMs: Date.now() - started, cached: false, warnings: [warning] },
    });

    if (query === "") return empty("the query was empty");

    const { blocks, truncated } = clampBlocks(request.blocks, SEARCH_MAX_STATE_CHARS);
    if (blocks.length === 0) return empty("no readable text was found on the page");
    if (truncated) {
      warnings.push(
        `only the first ${blocks.length} text blocks were searched, to stay inside the model's state budget`,
      );
    }

    const cacheKey = hashKey({ v: 1, query, blocks });
    const cached = this.#searchCache.get(cacheKey);
    if (cached !== undefined) {
      const usage: UsageTotals = { ...emptyUsage(), cacheHits: 1, model: cached.usage.model };
      this.#totals = addUsage(this.#totals, usage);
      this.#searches += 1;
      return {
        ...cached,
        usage,
        meta: { ...cached.meta, cached: true, elapsedMs: Date.now() - started },
      };
    }

    const windows = windowBlocks(blocks);
    const plan = buildSearchQuestions(query, windows);
    const state = buildSearchState(request.pageUrl, query, windows);

    let result: JudgeResult;
    try {
      result = await this.judge.ask(state, plan.questions);
    } catch (cause) {
      throw new UpstreamError(`the model could not be reached: ${describeError(cause)}`, cause);
    }

    const choices = readChoices(result.answers);
    const nouls = readNouls(result.answers);

    const perWindow: Record<string, number>[] = windows.map((window) => {
      const distribution = choices[`where_${window.key}`];
      if (distribution === undefined) {
        warnings.push(`no ranking came back for passage ${window.key}`);
        return {};
      }
      return distribution;
    });
    const perWindowExists = windows.map((window) => nouls[`exists_${window.key}`] ?? 0);
    const merged = mergeSearchResults(windows, perWindow, perWindowExists);

    const usage = usageFrom(result, 1);
    this.#totals = addUsage(this.#totals, usage);
    this.#searches += 1;

    const response: SearchResponse = {
      verdict: merged.verdict,
      exists: merged.exists,
      hits: merged.hits,
      usage,
      meta: {
        elapsedMs: Date.now() - started,
        cached: false,
        passes: windows.length,
        warnings,
      },
    };
    this.#searchCache.set(cacheKey, response);
    return response;
  }

  stats(): StatsResponse {
    return {
      totals: this.#totals,
      adsJudged: this.#adsJudged,
      searches: this.#searches,
      cacheEntries: this.#adCache.size + this.#searchCache.size,
    };
  }
}
