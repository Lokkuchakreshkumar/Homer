/**
 * The popup: focused Semantic Find controller and configuration.
 *
 * Provides instant shortcut launch, preferences (master switch, key intercept, debounce),
 * and proxy connection health. All ad shielding is eliminated.
 */

import {
  DEFAULT_SETTINGS,
  SETTINGS_KEY,
  mergeSettings,
} from "../../shared/settings.ts";
import type { Settings } from "../../shared/settings.ts";
import type { HealthResponse, StatsResponse } from "../../shared/wire.ts";
import { formatCost } from "../content/format.ts";

interface TabState {
  readonly host: string;
  readonly sessionCostUsd: number;
  readonly findOpen: boolean;
  readonly lastQuery: string;
}

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const element = document.getElementById(id) as T | null;
  if (element === null) throw new Error(`popup is missing #${id}`);
  return element;
};

const errorBox = $("error");
const proxyStatus = $("proxy-status");
const tabHost = $("tab-host");
const sessionCost = $("session-cost");
const btnOpenFind = $("btn-open-find");
const shortcutDisplay = $("shortcut-display");
const takeoverSub = $("takeover-sub");

const findEnabledInput = $<HTMLInputElement>("find-enabled");
const takeoverInput = $<HTMLInputElement>("takeover");
const debounceInput = $<HTMLInputElement>("debounce");
const debounceVal = $("debounce-val");

const proxyUrlInput = $<HTMLInputElement>("proxy-url");
const neverSendInput = $<HTMLTextAreaElement>("never-send");
const nativeFindInput = $<HTMLTextAreaElement>("native-find");
const telemetryInfo = $("telemetry-info");

function showError(message: string): void {
  errorBox.textContent = message;
}

function clearError(): void {
  errorBox.textContent = "";
}

async function activeTabId(): Promise<number | null> {
  try {
    const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    const id = tabs[0]?.id;
    return typeof id === "number" ? id : null;
  } catch {
    return null;
  }
}

async function askTab<T>(type: string, extra: Record<string, unknown> = {}): Promise<T | null> {
  const tabId = await activeTabId();
  if (tabId === null) return null;
  try {
    const response = (await chrome.tabs.sendMessage(tabId, { type, ...extra })) as T | null;
    return response ?? null;
  } catch {
    return null;
  }
}

async function currentSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  return mergeSettings(stored[SETTINGS_KEY]);
}

async function saveSettings(patch: Partial<Settings> | ((prev: Settings) => Settings)): Promise<Settings> {
  const prev = await currentSettings();
  const next = typeof patch === "function" ? patch(prev) : mergeSettings({ ...prev, ...patch });
  await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}

async function proxyJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return (await response.json()) as T;
}

function detectPlatformShortcut(): string {
  const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/i.test(navigator.platform);
  return isMac ? "⌘F" : "Ctrl+F";
}

async function refreshTabState(): Promise<void> {
  const state = await askTab<TabState>("jev:get-tab-state");
  if (state === null) {
    tabHost.textContent = "No active web page";
    sessionCost.textContent = "$0.00";
    return;
  }
  tabHost.textContent = state.host || "Active page";
  sessionCost.textContent = formatCost(state.sessionCostUsd);
}

async function checkProxyHealth(settings: Settings): Promise<void> {
  const base = settings.proxyUrl.replace(/\/+$/, "");
  proxyStatus.className = "proxy-badge";
  proxyStatus.querySelector(".status-text")!.textContent = "Connecting...";

  try {
    const health = await proxyJson<HealthResponse>(`${base}/v1/health`);
    proxyStatus.className = "proxy-badge ok";
    const statusText = proxyStatus.querySelector(".status-text")!;
    statusText.textContent = health.mode === "stub" ? "Stub mode" : "Online";

    try {
      const stats = await proxyJson<StatsResponse>(`${base}/v1/stats`);
      telemetryInfo.innerHTML = `
        <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
          <span>Model</span>
          <span style="font-weight:600; color:var(--text-main);">${escapeHtml(health.model)}</span>
        </div>
        <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
          <span>Mode</span>
          <span style="font-weight:600; color:var(--text-main);">${health.mode}</span>
        </div>
        <div style="display:flex; justify-content:space-between;">
          <span>Proxy Cost</span>
          <span style="font-weight:600; color:var(--text-main);">${formatCost(stats.totals.costUsd)}</span>
        </div>
      `;
    } catch {
      telemetryInfo.textContent = `Model: ${health.model} (${health.mode})`;
    }
  } catch (cause) {
    proxyStatus.className = "proxy-badge err";
    proxyStatus.querySelector(".status-text")!.textContent = "Proxy unreachable";
    telemetryInfo.textContent = `Could not reach proxy at ${base}. Run npm run dev.`;
  }
}

function escapeHtml(raw: string): string {
  return raw.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

function parseLines(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

async function boot(): Promise<void> {
  const shortcut = detectPlatformShortcut();
  shortcutDisplay.textContent = shortcut;
  takeoverSub.textContent = `Trigger Homer on ${shortcut}`;

  const settings = await currentSettings();

  findEnabledInput.checked = settings.enabled && settings.semanticFind.enabled;
  takeoverInput.checked = settings.semanticFind.takeOverCtrlF;
  debounceInput.value = String(settings.semanticFind.debounceMs);
  debounceVal.textContent = `${settings.semanticFind.debounceMs} ms`;

  proxyUrlInput.value = settings.proxyUrl;
  neverSendInput.value = settings.neverSendHosts.join("\n");
  nativeFindInput.value = settings.nativeFindHosts.join("\n");

  findEnabledInput.addEventListener("change", () => {
    void saveSettings((prev) => ({
      ...prev,
      enabled: findEnabledInput.checked,
      semanticFind: {
        ...prev.semanticFind,
        enabled: findEnabledInput.checked,
      },
    }));
  });

  takeoverInput.addEventListener("change", () => {
    void saveSettings((prev) => ({
      ...prev,
      semanticFind: {
        ...prev.semanticFind,
        takeOverCtrlF: takeoverInput.checked,
      },
    }));
  });

  debounceInput.addEventListener("input", () => {
    const ms = Number(debounceInput.value);
    debounceVal.textContent = `${ms} ms`;
  });

  debounceInput.addEventListener("change", () => {
    const ms = Number(debounceInput.value);
    void saveSettings((prev) => ({
      ...prev,
      semanticFind: {
        ...prev.semanticFind,
        debounceMs: ms,
      },
    }));
  });

  proxyUrlInput.addEventListener("change", () => {
    const nextUrl = proxyUrlInput.value.trim() || DEFAULT_SETTINGS.proxyUrl;
    void saveSettings({ proxyUrl: nextUrl }).then((updated) => {
      void checkProxyHealth(updated);
    });
  });

  neverSendInput.addEventListener("change", () => {
    void saveSettings({ neverSendHosts: parseLines(neverSendInput.value) });
  });

  nativeFindInput.addEventListener("change", () => {
    void saveSettings({ nativeFindHosts: parseLines(nativeFindInput.value) });
  });

  btnOpenFind.addEventListener("click", async () => {
    clearError();
    const result = await askTab<{ opened?: boolean }>("jev:open-find");
    if (result?.opened) {
      window.close();
    } else {
      showError("Could not open find bar on this tab. Refresh page or check permissions.");
    }
  });

  await refreshTabState();
  await checkProxyHealth(settings);
}

document.addEventListener("DOMContentLoaded", () => {
  void boot().catch((err) => {
    showError(err instanceof Error ? err.message : String(err));
  });
});
