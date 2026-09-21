/**
 * Extension settings, shared by the content script, the service worker, and the popup so
 * all three agree on defaults and on host matching.
 */

import type { AdCategory } from "./wire.ts";
import { AD_CATEGORIES } from "./wire.ts";

export const SETTINGS_KEY = "jev:settings";

/** Must match `PORT` in .env on the proxy side. */
export const DEFAULT_PROXY_URL = "http://localhost:8787";

export type AdShieldMode = "hide" | "highlight";

export interface Settings {
  /** Master switch. Off means the content script does nothing at all. */
  enabled: boolean;
  adBlocking: {
    enabled: boolean;
    categories: Record<AdCategory, boolean>;
    /**
     * Heuristically matched elements are hidden at once so nothing ad-shaped ever paints,
     * then the judge confirms. Turning this off means waiting for the verdict, which
     * trades a flash of ad for a flash of caution.
     */
    provisionalHide: boolean;
    /**
     * Whether detected ads are automatically hidden/removed, or highlighted on the page
     * so the reader can inspect what Jev caught.
     */
    mode: AdShieldMode;
  };
  semanticFind: {
    enabled: boolean;
    /**
     * Intercept Ctrl+F / Cmd+F and show our own find bar. Off leaves the native bar
     * alone, and semantic search moves to Ctrl+Shift+F.
     */
    takeOverCtrlF: boolean;
    /** Milliseconds to wait after the last keystroke before asking. Enter skips the wait. */
    debounceMs: number;
  };
  proxyUrl: string;
  /**
   * Hostnames whose content is never sent to the proxy. Substring match, so `bank`
   * covers `mybank.com`. Feature 1 still works locally on heuristics alone.
   */
  neverSendHosts: string[];
  /** Hostnames where we let the native find bar through, e.g. sites with their own find. */
  nativeFindHosts: string[];
}

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  adBlocking: {
    enabled: true,
    categories: { overlay: true, sponsored: true, adslot: true },
    provisionalHide: true,
    mode: "hide",
  },
  semanticFind: {
    enabled: true,
    takeOverCtrlF: true,
    debounceMs: 300,
  },
  proxyUrl: DEFAULT_PROXY_URL,
  neverSendHosts: [],
  nativeFindHosts: ["docs.google.com", "notion.so", "vscode.dev", "github.dev"],
};

/** Fill in anything a partially stored settings object is missing. */
export function mergeSettings(stored: unknown): Settings {
  const base = structuredClone(DEFAULT_SETTINGS);
  if (typeof stored !== "object" || stored === null) return base;
  const src = stored as Partial<Settings>;
  if (typeof src.enabled === "boolean") base.enabled = src.enabled;
  if (typeof src.proxyUrl === "string" && src.proxyUrl.trim() !== "") {
    base.proxyUrl = src.proxyUrl.trim().replace(/\/+$/, "");
  }
  if (Array.isArray(src.neverSendHosts)) base.neverSendHosts = src.neverSendHosts.map(String);
  if (Array.isArray(src.nativeFindHosts)) base.nativeFindHosts = src.nativeFindHosts.map(String);

  const ads = src.adBlocking;
  if (ads && typeof ads === "object") {
    if (typeof ads.enabled === "boolean") base.adBlocking.enabled = ads.enabled;
    if (typeof ads.provisionalHide === "boolean") {
      base.adBlocking.provisionalHide = ads.provisionalHide;
    }
    if (ads.mode === "hide" || ads.mode === "highlight") {
      base.adBlocking.mode = ads.mode;
    }
    for (const category of AD_CATEGORIES) {
      const value = ads.categories?.[category];
      if (typeof value === "boolean") base.adBlocking.categories[category] = value;
    }
  }

  const find = src.semanticFind;
  if (find && typeof find === "object") {
    if (typeof find.enabled === "boolean") base.semanticFind.enabled = find.enabled;
    if (typeof find.takeOverCtrlF === "boolean") {
      base.semanticFind.takeOverCtrlF = find.takeOverCtrlF;
    }
    if (typeof find.debounceMs === "number" && Number.isFinite(find.debounceMs)) {
      base.semanticFind.debounceMs = Math.min(2000, Math.max(0, find.debounceMs));
    }
  }
  return base;
}

export function enabledCategories(settings: Settings): AdCategory[] {
  return AD_CATEGORIES.filter((c) => settings.adBlocking.categories[c]);
}

/** Substring match against a list of patterns. Empty list matches nothing. */
export function hostMatches(host: string, patterns: readonly string[]): boolean {
  if (host === "") return false;
  const needle = host.toLowerCase();
  return patterns.some((raw) => {
    const pattern = raw.trim().toLowerCase();
    return pattern !== "" && needle.includes(pattern);
  });
}

export function hostnameOf(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname;
  } catch {
    return "";
  }
}
