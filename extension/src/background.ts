/**
 * Service worker.
 *
 * It forwards judgement calls from content scripts to the local proxy and nothing else.
 * It keeps no judgement state, so being killed and restarted (which Manifest V3 does
 * freely) cannot corrupt a verdict — the worst it does is force the content script to
 * retry, which `sendMessage` already surfaces as an error.
 */

import { mergeSettings } from "../../shared/settings.ts";
import type { WorkerRequest } from "./worker-client.ts";

async function proxyBase(): Promise<string> {
  const stored = await chrome.storage.local.get("jev:settings");
  return mergeSettings(stored["jev:settings"]).proxyUrl;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (cause) {
    throw new Error(
      "could not reach the Jev proxy. Start it with `npm run dev` and check the proxy URL in the popup.",
      { cause },
    );
  }

  const json = (await response.json().catch(() => null)) as { message?: unknown } | null;
  if (!response.ok) {
    const message = json?.message;
    throw new Error(
      typeof message === "string" && message !== ""
        ? message
        : `the proxy answered with HTTP ${response.status}`,
    );
  }
  return json as T;
}

chrome.runtime.onMessage.addListener(
  (message: unknown, sender, sendResponse: (value: unknown) => void) => {
    if (typeof message !== "object" || message === null) return false;
    const msg = message as Record<string, unknown>;
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
    const typed = message as WorkerRequest;

    const path = typed.type === "jev:judge-ads" ? "/v1/ads/judge" : "/v1/search";
    const request = typed.request;

    void (async () => {
      try {
        const payload = await postJson<{ verdicts?: { action: string }[] }>(
          `${await proxyBase()}${path}`,
          request,
        );
        const tabId = sender.tab?.id;
        if (typeof tabId === "number" && Array.isArray(payload.verdicts)) {
          const ads = payload.verdicts.filter(
            (v) => v.action === "remove" || v.action === "hide",
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
          message: cause instanceof Error ? cause.message : String(cause),
        });
      }
    })();

    // Keep the channel open for the async reply above.
    return true;
  },
);
