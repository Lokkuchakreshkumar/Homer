(() => {
  // extension/shared/wire.ts
  var AD_CATEGORIES = ["overlay", "sponsored", "adslot"];

  // extension/shared/settings.ts
  var SETTINGS_KEY = "jev:settings";
  var DEFAULT_PROXY_URL = "https://homer-3rx8.onrender.com";
  var DEFAULT_SETTINGS = {
    enabled: true,
    adBlocking: {
      enabled: true,
      categories: { overlay: true, sponsored: true, adslot: true },
      provisionalHide: true,
      mode: "hide"
    },
    semanticFind: {
      enabled: true,
      takeOverCtrlF: true,
      debounceMs: 300
    },
    proxyUrl: DEFAULT_PROXY_URL,
    neverSendHosts: [],
    nativeFindHosts: ["docs.google.com", "notion.so", "vscode.dev", "github.dev"]
  };
  function mergeSettings(stored) {
    const base = structuredClone(DEFAULT_SETTINGS);
    if (typeof stored !== "object" || stored === null) return base;
    const src = stored;
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
        base.semanticFind.debounceMs = Math.min(2e3, Math.max(0, find.debounceMs));
      }
    }
    return base;
  }

  // extension/src/content/format.ts
  function formatCost(usd) {
    if (!Number.isFinite(usd) || usd <= 0) return "$0.00";
    if (usd < 0.01) return `$${usd.toFixed(5)}`;
    return `$${usd.toFixed(2)}`;
  }

  // extension/src/popup/popup.ts
  var $ = (id) => {
    const element = document.getElementById(id);
    if (element === null) throw new Error(`popup is missing #${id}`);
    return element;
  };
  var errorBox = $("error");
  var proxyStatus = $("proxy-status");
  var tabHost = $("tab-host");
  var sessionCost = $("session-cost");
  var btnOpenFind = $("btn-open-find");
  var shortcutDisplay = $("shortcut-display");
  var takeoverSub = $("takeover-sub");
  var findEnabledInput = $("find-enabled");
  var takeoverInput = $("takeover");
  var debounceInput = $("debounce");
  var debounceVal = $("debounce-val");
  var proxyUrlInput = $("proxy-url");
  var neverSendInput = $("never-send");
  var nativeFindInput = $("native-find");
  var telemetryInfo = $("telemetry-info");
  function showError(message) {
    errorBox.textContent = message;
  }
  function clearError() {
    errorBox.textContent = "";
  }
  async function activeTabId() {
    try {
      const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      const id = tabs[0]?.id;
      return typeof id === "number" ? id : null;
    } catch {
      return null;
    }
  }
  async function askTab(type, extra = {}) {
    const tabId = await activeTabId();
    if (tabId === null) return null;
    try {
      const response = await chrome.tabs.sendMessage(tabId, { type, ...extra });
      return response ?? null;
    } catch {
      return null;
    }
  }
  async function currentSettings() {
    const stored = await chrome.storage.local.get(SETTINGS_KEY);
    return mergeSettings(stored[SETTINGS_KEY]);
  }
  async function saveSettings(patch) {
    const prev = await currentSettings();
    const next = typeof patch === "function" ? patch(prev) : mergeSettings({ ...prev, ...patch });
    await chrome.storage.local.set({ [SETTINGS_KEY]: next });
    return next;
  }
  async function proxyJson(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  }
  function detectPlatformShortcut() {
    const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/i.test(navigator.platform);
    return isMac ? "\u2318F" : "Ctrl+F";
  }
  async function refreshTabState() {
    const state = await askTab("jev:get-tab-state");
    if (state === null) {
      tabHost.textContent = "No active web page";
      sessionCost.textContent = "$0.00";
      return;
    }
    tabHost.textContent = state.host || "Active page";
    sessionCost.textContent = formatCost(state.sessionCostUsd);
  }
  async function checkProxyHealth(settings) {
    const base = settings.proxyUrl.replace(/\/+$/, "");
    proxyStatus.className = "proxy-badge";
    proxyStatus.querySelector(".status-text").textContent = "Connecting...";
    try {
      const health = await proxyJson(`${base}/v1/health`);
      proxyStatus.className = "proxy-badge ok";
      const statusText = proxyStatus.querySelector(".status-text");
      statusText.textContent = health.mode === "stub" ? "Stub mode" : "Online";
      try {
        const stats = await proxyJson(`${base}/v1/stats`);
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
      proxyStatus.querySelector(".status-text").textContent = "Proxy unreachable";
      telemetryInfo.textContent = `Could not reach proxy at ${base}. Run npm run dev.`;
    }
  }
  function escapeHtml(raw) {
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
  function parseLines(raw) {
    return raw.split(/\r?\n/).map((s) => s.trim()).filter((s) => s.length > 0);
  }
  async function boot() {
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
          enabled: findEnabledInput.checked
        }
      }));
    });
    takeoverInput.addEventListener("change", () => {
      void saveSettings((prev) => ({
        ...prev,
        semanticFind: {
          ...prev.semanticFind,
          takeOverCtrlF: takeoverInput.checked
        }
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
          debounceMs: ms
        }
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
      const result = await askTab("jev:open-find");
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
})();
//# sourceMappingURL=popup.js.map
