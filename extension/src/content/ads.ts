/**
 * The ad pipeline: scan, conceal, ask, act.
 *
 * The order of operations is the whole point of feature 1. Nothing is deleted on a
 * heuristic alone and nothing is deleted before the judge answers. The scan finds shapes;
 * `visibility: hidden` keeps those shapes from painting; the proxy decides; and this file
 * carries the verdict out — subject to one last check, because the plan called for the
 * client to refuse a `remove` its own rules would have refused, even when the server says
 * go ahead.
 */

import type { AdAction, AdCandidate, AdCategory, UsageTotals } from "../../../shared/wire.ts";
import { emptyUsage } from "../../../shared/wire.ts";
import { browserMeasurer, describeElement, scanForAds } from "../dom.ts";
import type { ScanResult } from "../dom.ts";
import { mayRemove, toCandidate } from "../heuristics.ts";
import { AdLedger, type AdMark } from "./ledger.ts";
import { judgeAdsViaWorker } from "../worker-client.ts";
import { hostnameOf } from "../../../shared/settings.ts";
import type { AdVerdict } from "../../../shared/wire.ts";

export interface AdScanOptions {
  /** Snapshot of settings at scan time. The scan does not re-read them mid-flight. */
  readonly enabled: boolean;
  readonly categories: readonly AdCategory[];
  readonly provisionalHide: boolean;
  readonly mode?: "hide" | "highlight";
  readonly neverSendHosts: readonly string[];
  readonly onVerdict?: (applied: AppliedVerdict[]) => void;
}

export interface AppliedVerdict {
  readonly id: string;
  readonly action: AdAction;
  readonly reason: string;
}

export interface AdScanOutcome {
  readonly sent: number;
  readonly remove: number;
  readonly hide: number;
  readonly highlight: number;
  readonly keep: number;
  readonly applied: readonly AppliedVerdict[];
  readonly warnings: readonly string[];
  readonly usage: UsageTotals;
}

/** The same shape, but mutable while the scan is assembling it. */
interface MutableOutcome {
  sent: number;
  remove: number;
  hide: number;
  highlight: number;
  keep: number;
  readonly applied: AppliedVerdict[];
  readonly warnings: string[];
}

function summarize(element: Element): string {
  const tag = element.tagName.toLowerCase();
  const id = element.getAttribute("id");
  const label = id ? `#${id}` : "";
  const text = (element.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
  return `<${tag}${label}> ${text}`;
}

/**
 * Scan the page, conceal candidates, judge them, and carry out the verdicts.
 *
 * Idempotent per node: claiming happens before any mutation, so a MutationObserver that
 * fires because of our own attribute writes cannot re-enter this scan for the same node.
 */
export async function scanAndJudgeAds(
  document: Document,
  ledger: AdLedger,
  options: AdScanOptions,
): Promise<AdScanOutcome> {
  const applied: AppliedVerdict[] = [];

  const claimed: ScanResult[] = [];
  const warnings: string[] = [];
  let usage: UsageTotals = emptyUsage();
  for (const result of scanForAds(document, browserMeasurer)) {
    if (ledger.has(result.key) || !ledger.claim(result.key, result.element)) continue;
    claimed.push(result);
    // Conceal at once so nothing ad-shaped paints, even though the verdict is unknown.
    if (options.provisionalHide) ledger.mark(result.element, "prov");
  }

  if (claimed.length === 0) {
    return { sent: 0, remove: 0, hide: 0, highlight: 0, keep: 0, applied, warnings, usage };
  }

  const host = hostnameOf(document.location?.href ?? "");
  const neverSend = options.neverSendHosts.some((pattern) => {
    const needle = pattern.trim().toLowerCase();
    return needle !== "" && host.toLowerCase().includes(needle);
  });

  if (neverSend) {
    for (const result of claimed) {
      ledger.mark(result.element, null);
      ledger.record(result.key, {
        summary: summarize(result.element),
        category: null,
        probability: 0,
        imageHost: result.descriptor.imageHost,
      });
      applied.push({ id: result.key, action: "keep", reason: "host is on the never-send list" });
    }
    return { sent: 0, remove: 0, hide: 0, highlight: 0, keep: claimed.length, applied, warnings, usage };
  }

  const candidates: AdCandidate[] = claimed.map((result) =>
    toCandidate(result.key, result.descriptor, result.reasons),
  );

  let verdicts: readonly AdVerdict[];
  try {
    const response = await judgeAdsViaWorker({
      type: "jev:judge-ads",
      request: { pageUrl: document.location?.href ?? "", enabled: options.categories, candidates },
    });
    warnings.push(...response.meta.warnings);
    usage = response.usage;
    verdicts = response.verdicts;
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    warnings.push(`the judge could not be reached: ${message}`);
    verdicts = candidates.map(
      (candidate): AdVerdict => ({
        id: candidate.id,
        action: "keep",
        category: null,
        probability: 0,
        probabilities: {},
        contentVeto: null,
        reason:
          "the judge could not be reached, so nothing was changed; check that the proxy is running",
      }),
    );
  }

  const outcome: MutableOutcome = {
    sent: candidates.length,
    remove: 0,
    hide: 0,
    highlight: 0,
    keep: 0,
    applied,
    warnings,
  };

  const mode = options.mode ?? "hide";
  for (const verdict of verdicts) {
    const result = claimed.find((entry) => entry.key === verdict.id);
    if (result === undefined) continue;
    applyVerdict(ledger, result, verdict, outcome, mode);
  }

  options.onVerdict?.(applied);
  return { ...outcome, usage };
}

/** Carry one verdict out, subject to the client's own removal guard. */
function applyVerdict(
  ledger: AdLedger,
  result: ScanResult,
  verdict: AdVerdict,
  outcome: MutableOutcome,
  mode: "hide" | "highlight" = "hide",
): void {
  if (mode === "highlight" && (verdict.action === "remove" || verdict.action === "hide")) {
    ledger.mark(result.element, "highlight");
    const cat = verdict.category ?? "ad";
    const pct = verdict.probability > 0 ? ` (${Math.round(verdict.probability * 100)}%)` : "";
    ledger.attachBadge(verdict.id, result.element, `🚨 Jev Detected Ad: ${cat}${pct}`);
    ledger.record(verdict.id, {
      summary: summarize(result.element),
      category: verdict.category,
      probability: verdict.probability,
      action: "highlight",
      imageHost: result.descriptor.imageHost,
    });
    outcome.highlight += 1;
    outcome.applied.push({ id: verdict.id, action: "hide", reason: `highlighted on page: ${verdict.reason}` });
    return;
  }
  if (verdict.action === "remove") {
    // The server already refused the dangerous cases, and this refuses them again against
    // the live node — belt and suspenders on purpose, because a layout shift or a late
    // render can change what a node is between the scan and the answer.
    const live = describeElement(result.element, browserMeasurer);
    const guard = mayRemove(live);
    if (!guard.ok) {
      ledger.mark(result.element, "hide");
      ledger.record(verdict.id, {
        summary: summarize(result.element),
        category: verdict.category,
        probability: verdict.probability,
        imageHost: result.descriptor.imageHost,
      });
      outcome.hide += 1;
      outcome.applied.push({
        id: verdict.id,
        action: "hide",
        reason: `the verdict said remove, but the live node no longer qualifies: ${guard.reason}`,
      });
      return;
    }

    const parent = result.element.parentNode;
    if (parent === null) {
      ledger.mark(result.element, null);
      ledger.release(verdict.id);
      outcome.keep += 1;
      outcome.applied.push({ id: verdict.id, action: "keep", reason: "its parent was already gone" });
      return;
    }

    ledger.mark(result.element, "remove");
    ledger.stashRemoval(verdict.id, {
      node: result.element,
      parent,
      nextSibling: result.element.nextSibling,
    });
    try {
      result.element.remove();
    } catch {
      // `remove()` losing a race with the page's own rendering is exactly the failure the
      // guard rails exist to make survivable: count it, release the claim, move on.
      ledger.mark(result.element, "hide");
      ledger.release(verdict.id);
      outcome.keep += 1;
      outcome.applied.push({ id: verdict.id, action: "keep", reason: "removal raced a page mutation" });
      return;
    }
    ledger.record(verdict.id, {
      summary: summarize(result.element),
      category: verdict.category,
      probability: verdict.probability,
      imageHost: result.descriptor.imageHost,
    });
    outcome.remove += 1;
    outcome.applied.push({ id: verdict.id, action: "remove", reason: verdict.reason });
    return;
  }

  if (verdict.action === "hide") {
    ledger.mark(result.element, "hide");
    ledger.record(verdict.id, {
      summary: summarize(result.element),
      category: verdict.category,
      probability: verdict.probability,
      imageHost: result.descriptor.imageHost,
    });
    outcome.hide += 1;
    outcome.applied.push({ id: verdict.id, action: "hide", reason: verdict.reason });
    return;
  }

  ledger.mark(result.element, null);
  outcome.keep += 1;
  outcome.applied.push({ id: verdict.id, action: "keep", reason: verdict.reason });
}
