/**
 * The stylesheet that makes hidden candidates invisible.
 *
 * Provisional candidates are concealed with `visibility` rather than `display` so the
 * page does not reflow around them while the judge thinks; committed `hide` verdicts take
 * them out of layout entirely. Both are `!important` so site and ad styles cannot win.
 */

import { JEV_AD_ATTRIBUTE } from "./ledger.ts";

export function stylesheetText(): string {
  return [
    `[${JEV_AD_ATTRIBUTE}="prov"] { visibility: hidden !important; }`,
    `[${JEV_AD_ATTRIBUTE}="hide"] { display: none !important; }`,
    `[${JEV_AD_ATTRIBUTE}="remove"] { display: none !important; }`,
    `[${JEV_AD_ATTRIBUTE}="highlight"] {
      outline: 2px dashed rgba(244, 63, 94, 0.85) !important;
      outline-offset: 2px !important;
      background-color: rgba(244, 63, 94, 0.05) !important;
      border-radius: 8px !important;
      position: relative !important;
      transition: outline 0.2s ease, background-color 0.2s ease !important;
    }`,
    `.jev-ad-badge {
      position: absolute !important;
      top: -11px !important;
      left: 8px !important;
      background: #18181b !important;
      color: #fda4af !important;
      border: 1px solid rgba(244, 63, 94, 0.4) !important;
      font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", system-ui, sans-serif !important;
      font-size: 10.5px !important;
      font-weight: 600 !important;
      padding: 2px 9px !important;
      border-radius: 9999px !important;
      z-index: 2147483647 !important;
      pointer-events: none !important;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.45) !important;
      letter-spacing: 0.01em !important;
      display: inline-flex !important;
      align-items: center !important;
      gap: 5px !important;
      white-space: nowrap !important;
    }`,
  ].join("\n");
}

/** Install the rule once per document. Called before any scanning runs. */
export function installAdStylesheet(document: Document): void {
  if (document.getElementById("jev-ad-style") !== null) return;
  const holder = document.documentElement ?? document.head ?? document.body;
  if (!holder) return;
  const style = document.createElement("style");
  style.id = "jev-ad-style";
  style.textContent = stylesheetText();
  holder.appendChild(style);
}
