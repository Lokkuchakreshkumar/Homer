// extension/shared/wire.ts
var AD_CATEGORIES = ["overlay", "sponsored", "adslot"];

// extension/shared/settings.ts
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

// extension/src/background.ts
async function proxyBase() {
  const stored = await chrome.storage.local.get("jev:settings");
  return mergeSettings(stored["jev:settings"]).proxyUrl;
}
async function postJson(url, body) {
  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
  } catch (cause) {
    throw new Error(
      "could not reach the Jev proxy. Start it with `npm run dev` and check the proxy URL in the popup.",
      { cause }
    );
  }
  const json = await response.json().catch(() => null);
  if (!response.ok) {
    const message = json?.message;
    throw new Error(
      typeof message === "string" && message !== "" ? message : `the proxy answered with HTTP ${response.status}`
    );
  }
  return json;
}
chrome.runtime.onMessage.addListener(
  (message, sender, sendResponse) => {
    if (typeof message !== "object" || message === null) return false;
    const msg = message;
    const type = typeof msg["type"] === "string" ? msg["type"] : "";
    if (type === "jev:update-badge") {
      const tabId = sender.tab?.id;
      if (typeof tabId === "number") {
        const count = typeof msg["count"] === "number" ? msg["count"] : 0;
        if (count > 0) {
          chrome.action.setBadgeText({ tabId, text: String(count) });
          chrome.action.setBadgeBackgroundColor({ tabId, color: "#f43f5e" });
          chrome.action.setTitle({ tabId, title: `Jev Copilot: ${count} ad(s) detected` });
        } else {
          chrome.action.setBadgeText({ tabId, text: "" });
          chrome.action.setTitle({ tabId, title: "Jev Copilot" });
        }
      }
      sendResponse({ ok: true });
      return false;
    }
    if (type !== "jev:judge-ads" && type !== "jev:search") return false;
    const typed = message;
    const path = typed.type === "jev:judge-ads" ? "/v1/ads/judge" : "/v1/search";
    const request = typed.request;
    void (async () => {
      try {
        const payload = await postJson(
          `${await proxyBase()}${path}`,
          request
        );
        const tabId = sender.tab?.id;
        if (typeof tabId === "number" && Array.isArray(payload.verdicts)) {
          const ads = payload.verdicts.filter(
            (v) => v.action === "remove" || v.action === "hide"
          ).length;
          if (ads > 0) {
            chrome.action.setBadgeText({ tabId, text: String(ads) });
            chrome.action.setBadgeBackgroundColor({ tabId, color: "#f43f5e" });
            chrome.action.setTitle({ tabId, title: `Jev Copilot: ${ads} ad(s) detected` });
          }
        }
        sendResponse({ ok: true, payload });
      } catch (cause) {
        sendResponse({
          ok: false,
          message: cause instanceof Error ? cause.message : String(cause)
        });
      }
    })();
    return true;
  }
);
//# sourceMappingURL=background.js.map
