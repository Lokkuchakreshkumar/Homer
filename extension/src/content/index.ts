/**
 * The content script for Semantic Find.
 *
 * It is the browser tab's side of Jev Find: key interception, in-page find bar,
 * highlight painting, and communication with the local proxy via the background worker.
 * Ad detection and ad shielding are completely removed.
 */

import {
  DEFAULT_SETTINGS,
  SETTINGS_KEY,
  hostMatches,
  hostnameOf,
  mergeSettings,
} from "../../shared/settings.ts";
import type { Settings } from "../../shared/settings.ts";
import { addUsage, emptyUsage } from "../../shared/wire.ts";
import type { UsageTotals } from "../../shared/wire.ts";
import { SemanticFinder } from "./search.ts";

interface TabState {
  readonly host: string;
  readonly sessionCostUsd: number;
  readonly findOpen: boolean;
  readonly lastQuery: string;
}

let settings: Settings = DEFAULT_SETTINGS;
let finder: SemanticFinder | null = null;
let settingsReady = false;

/** The query the tab's find bar is currently answering. Set by the search controller. */
export let lastQuery = "";
export function setLastQuery(query: string): void {
  lastQuery = query;
}

let sessionUsage: UsageTotals = emptyUsage();

function isTopFrame(): boolean {
  try {
    return window.top === window.self;
  } catch {
    return false;
  }
}

/** Whether this page is eligible for semantic search right now. */
function tabEligible(): boolean {
  if (!isTopFrame()) return false;
  const href = document.location?.href ?? "";
  if (!/^https?:/i.test(href)) return false;
  return true;
}

async function loadSettings(): Promise<Settings> {
  try {
    const stored = await chrome.storage.local.get(SETTINGS_KEY);
    return mergeSettings(stored[SETTINGS_KEY]);
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function currentHost(): string {
  return hostnameOf(document.location?.href ?? "");
}

function nativeFindAllowedHere(): boolean {
  return hostMatches(currentHost(), settings.nativeFindHosts);
}

/** Ctrl/Cmd+F, Ctrl/Cmd+Shift+F, and the page-respecting rules around hijacking them. */
function shouldTakeOverFind(event: KeyboardEvent): { take: boolean; preset: string } {
  const key = event.key?.toLowerCase();
  if (key !== "f") return { take: false, preset: "" };
  if (!event.ctrlKey && !event.metaKey) return { take: false, preset: "" };
  if (event.altKey) return { take: false, preset: "" };

  const isSemanticShortcut = event.shiftKey;
  const input = event.target as Element | null;

  // Never steal a keystroke the user typed into something that eats keys: editors,
  // address-like fields, and contentEditable regions hand back native behaviour.
  const tag = (input?.tagName ?? "").toLowerCase();
  const editable = input instanceof HTMLElement && input.isContentEditable;
  if (editable || tag === "input" || tag === "textarea" || tag === "select") {
    return { take: isSemanticShortcut, preset: "" };
  }

  if (nativeFindAllowedHere()) return { take: false, preset: "" };

  if (!settings.semanticFind.takeOverCtrlF && !isSemanticShortcut) {
    return { take: false, preset: "" };
  }
  return { take: true, preset: "" };
}

function finderInstance(): SemanticFinder | null {
  if (!settings.enabled || !settings.semanticFind.enabled) return null;
  if (finder === null) {
    finder = new SemanticFinder(document, settings.semanticFind.debounceMs, {
      onUsage: (usage) => {
        sessionUsage = addUsage(sessionUsage, usage);
      },
      onQuery: (query) => setLastQuery(query),
    });
  }
  return finder;
}

/** The page may legitimately have its own find; on those hosts we do not compete. */
function onKeyDown(event: KeyboardEvent): void {
  if (!settings.enabled || event.defaultPrevented) return;
  const { take } = shouldTakeOverFind(event);
  if (!take) return;

  const instance = finderInstance();
  if (instance === null) return;

  try {
    event.preventDefault();
    event.stopPropagation();
  } catch {
    // Some embedded frames forbid preventDefault. Losing the race there is acceptable.
  }

  if (event.key?.toLowerCase() === "f" && (event.ctrlKey || event.metaKey) && event.shiftKey) {
    instance.open();
    return;
  }

  if (!instance.isOpen) instance.open();
}

function onKeyUp(event: KeyboardEvent): void {
  // Ctrl+G / Cmd+G and F3 walk the current matches instead of opening native find next,
  // which would confuse a reader mid-walk by mixing two search models.
  const key = event.key?.toLowerCase();
  const findNext = key === "f3" || ((event.ctrlKey || event.metaKey) && key === "g");
  if (!findNext || finder === null || !finder.isOpen) return;
  try {
    event.preventDefault();
    event.stopPropagation();
  } catch {
    // Accept losing to the browser here rather than throwing inside a key handler.
  }
  finder.step(event.shiftKey ? -1 : 1);
}

function tabState(): TabState {
  return {
    host: currentHost(),
    sessionCostUsd: sessionUsage.costUsd,
    findOpen: finder?.isOpen ?? false,
    lastQuery,
  };
}

/** Popup and future callers talk to the tab through this narrow surface. */
function onTabMessage(
  message: unknown,
  sendResponse: (value: unknown) => void,
): boolean {
  if (typeof message !== "object" || message === null) return false;
  const type = (message as { type?: unknown }).type;

  if (type === "jev:get-tab-state") {
    sendResponse(tabState());
    return true;
  }
  if (type === "jev:open-find") {
    const instance = finderInstance();
    if (instance === null) {
      sendResponse({ opened: false });
      return true;
    }
    instance.open((message as { preset?: string }).preset ?? "");
    sendResponse({ opened: true });
    return true;
  }
  return false;
}

async function boot(): Promise<void> {
  if (settingsReady || !tabEligible()) return;
  settingsReady = true;
  settings = await loadSettings();

  window.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("keyup", onKeyUp, true);

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    try {
      return onTabMessage(message, sendResponse);
    } catch {
      sendResponse({ error: "the tab could not answer" });
      return true;
    }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !(SETTINGS_KEY in changes)) return;
    void loadSettings().then((next) => {
      settings = next;
      // A settings change that flips the extension off closes the bar and forgets nothing else.
      if (!settings.enabled && finder !== null) {
        finder.close();
      }
    });
  });
}

if (document.documentElement instanceof Element) {
  void boot();
}
