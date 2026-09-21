/**
 * The find bar.
 *
 * A Shadow DOM host is what keeps the UI from leaking into the page and the page from
 * leaking into the UI: the page's styles cannot restyle our input, and our ids cannot
 * collide with the site's, because the shadow boundary runs both ways. The host itself is
 * a fixed-position element at the top-right, where both the browser's own bar and
 * Vim's `/` put it - the muscle-memory position.
 *
 * The bar is deliberately a view, not a controller. It reports intent (query text,
 * next, previous, dismiss) to the content script through callbacks and renders whatever
 * the content script hands back.
 */

import type { SearchVerdict } from "../../shared/wire.ts";

export type FindBarIntent =
  | { readonly kind: "query"; readonly text: string }
  | { readonly kind: "next" }
  | { readonly kind: "prev" }
  | { readonly kind: "dismiss" };

export interface FindBarCallbacks {
  readonly onIntent: (intent: FindBarIntent) => void;
}

export interface FindBarStatus {
  readonly text: string;
  /** `"info"` is neutral; `"warn"` is terminal for the search (an error, not "no match"). */
  readonly tone: "info" | "warn";
}

export interface FindBarCounts {
  readonly answer: number;
  readonly context: number;
  readonly current: number;
}

const BAR_STYLES = `
  :host {
    all: initial;
    position: fixed;
    top: 20px;
    right: 24px;
    z-index: 2147483647;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "SF Pro Text", Helvetica, Arial, sans-serif;
    font-size: 13px;
    line-height: 1.4;
    color: #09090b;
    user-select: none;
    -webkit-font-smoothing: antialiased;
  }
  .jev-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    background: #ffffff;
    border: 1px solid #e4e4e7;
    border-radius: 12px;
    padding: 0 8px 0 14px;
    box-shadow: 0 12px 36px -4px rgba(0, 0, 0, 0.12), 0 2px 8px rgba(0, 0, 0, 0.04);
    min-width: 440px;
    max-width: 680px;
    height: 44px;
    box-sizing: border-box;
    animation: jev-slide-down 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  }
  @keyframes jev-slide-down {
    from { opacity: 0; transform: translateY(-8px) scale(0.98); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }
  .jev-brand {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    font-weight: 600;
    letter-spacing: -0.01em;
    color: #09090b;
    padding-right: 8px;
    border-right: 1px solid #e4e4e7;
    flex-shrink: 0;
  }
  .jev-icon {
    display: inline-flex;
    align-items: center;
    color: #09090b;
  }
  .jev-input {
    flex: 1;
    min-width: 150px;
    height: 100%;
    border: none;
    border-radius: 0;
    padding: 0 4px;
    font: inherit;
    font-size: 13px;
    background: transparent;
    color: #09090b;
    outline: none;
  }
  .jev-input::placeholder {
    color: #a1a1aa;
  }
  .jev-count {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 11px;
    font-weight: 500;
    color: #52525b;
    white-space: nowrap;
    padding: 2px 8px;
    background: #f4f4f5;
    border: 1px solid #e4e4e7;
    border-radius: 6px;
    flex-shrink: 0;
  }
  .jev-count:empty {
    display: none;
  }
  .jev-divider {
    width: 1px;
    height: 18px;
    background: #e4e4e7;
    flex-shrink: 0;
  }
  .jev-btn-group {
    display: flex;
    align-items: center;
    gap: 2px;
    flex-shrink: 0;
  }
  .jev-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    border: 1px solid transparent;
    border-radius: 6px;
    background: transparent;
    color: #52525b;
    cursor: pointer;
    transition: all 0.12s ease;
    padding: 0;
  }
  .jev-btn:hover:not(:disabled) {
    background: #f4f4f5;
    color: #09090b;
    border-color: #e4e4e7;
  }
  .jev-btn:active:not(:disabled) {
    transform: scale(0.94);
  }
  .jev-btn:disabled {
    opacity: 0.25;
    cursor: default;
    pointer-events: none;
  }
  .jev-btn.close {
    margin-left: 2px;
    color: #71717a;
  }
  .jev-btn.close:hover {
    background: #f4f4f5;
    color: #09090b;
    border-color: #e4e4e7;
  }
  .jev-status-wrap {
    font-size: 11px;
    color: #71717a;
    white-space: nowrap;
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
  }
  .jev-status:empty {
    display: none;
  }
  .jev-status {
    max-width: 180px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .jev-status[data-action='reload'] {
    cursor: pointer;
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .jev-status[data-action='reload']:hover {
    color: #09090b;
  }
  .jev-status[data-tone='warn'] {
    color: #dc2626;
  }
  .jev-bar[data-searching='true'] .jev-status {
    color: #09090b;
    font-weight: 500;
  }
  .jev-spinner {
    display: none;
    width: 12px;
    height: 12px;
    border: 2px solid #e4e4e7;
    border-top-color: #09090b;
    border-radius: 50%;
    animation: jev-spin 0.6s linear infinite;
    flex-shrink: 0;
  }
  .jev-bar[data-searching='true'] .jev-spinner {
    display: inline-block;
  }
  @keyframes jev-spin {
    to { transform: rotate(360deg); }
  }
`;

export function describeCounts(counts: FindBarCounts): string {
  if (counts.answer === 0 && counts.context === 0) return "0 matches";
  const parts: string[] = [];
  if (counts.answer > 0) parts.push(counts.answer === 1 ? "1 answer" : `${counts.answer} answers`);
  if (counts.context > 0) parts.push(`${counts.context} context`);
  const walked = ` · ${counts.current + 1}/${counts.answer + counts.context}`;
  return `${parts.join(" + ")}${walked}`;
}

export function describeVerdict(
  verdict: SearchVerdict,
  counts: { answer: number; context: number },
): string {
  if (verdict === "answered") {
    return counts.answer > 0 ? "answer found" : "closest wording, not a confident match";
  }
  if (verdict === "partial") return "partially addressed";
  return "no answer on this page";
}

/**
 * Mount the bar, focus the input, and start from any text the page had selected so the
 * first search begins from what the reader was looking at.
 */
export function mountFindBar(
  document: Document,
  callbacks: FindBarCallbacks,
): {
  readonly host: HTMLElement;
  readonly setStatus: (status: FindBarStatus) => void;
  readonly setCounts: (counts: FindBarCounts) => void;
  readonly setSearching: (searching: boolean) => void;
  readonly focus: () => void;
  readonly remove: () => void;
  readonly query: () => string;
  readonly preset: (text: string) => void;
} {
  const host = document.createElement("div");
  host.id = "jev-find-bar";
  host.setAttribute("data-jev-ui", "true");
  document.documentElement.appendChild(host);

  const shadow = host.attachShadow({ mode: "closed" });

  const style = document.createElement("style");
  style.textContent = BAR_STYLES;
  shadow.appendChild(style);

  const bar = document.createElement("div");
  bar.className = "jev-bar";
  bar.setAttribute("data-searching", "false");
  shadow.appendChild(bar);

  const brand = document.createElement("div");
  brand.className = "jev-brand";
  brand.innerHTML = `
    <span class="jev-icon">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
        <path d="M5 4v16M19 4v16M5 12h14" />
      </svg>
    </span>
    <span>Homer</span>
  `;
  bar.appendChild(brand);

  const input = document.createElement("input");
  input.className = "jev-input";
  input.type = "search";
  input.placeholder = "Search by meaning...";
  input.setAttribute("aria-label", "Semantic find");
  bar.appendChild(input);

  const count = document.createElement("span");
  count.className = "jev-count";
  count.textContent = "";
  bar.appendChild(count);

  const divider = document.createElement("div");
  divider.className = "jev-divider";
  bar.appendChild(divider);

  const btnGroup = document.createElement("div");
  btnGroup.className = "jev-btn-group";

  const prev = document.createElement("button");
  prev.className = "jev-btn";
  prev.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"></polyline></svg>`;
  prev.title = "Previous match (Shift+Enter)";
  prev.disabled = true;
  btnGroup.appendChild(prev);

  const next = document.createElement("button");
  next.className = "jev-btn";
  next.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>`;
  next.title = "Next match (Enter)";
  next.disabled = true;
  btnGroup.appendChild(next);

  const close = document.createElement("button");
  close.className = "jev-btn close";
  close.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;
  close.title = "Close (Esc)";
  btnGroup.appendChild(close);

  bar.appendChild(btnGroup);

  const statusWrap = document.createElement("div");
  statusWrap.className = "jev-status-wrap";
  const spinner = document.createElement("span");
  spinner.className = "jev-spinner";
  const status = document.createElement("div");
  status.className = "jev-status";
  status.textContent = "";
  statusWrap.append(spinner, status);
  bar.appendChild(statusWrap);

  status.addEventListener("click", () => {
    if (status.getAttribute("data-action") === "reload") {
      try {
        window.location.reload();
      } catch {
        // Ignored
      }
    }
  });

  input.addEventListener("input", () => callbacks.onIntent({ kind: "query", text: input.value }));
  input.addEventListener("keydown", (event: Event) => {
    const keyboard = event as KeyboardEvent;
    if (keyboard.isComposing) return;
    if (keyboard.key === "Enter" && !keyboard.shiftKey) {
      keyboard.preventDefault();
      callbacks.onIntent({ kind: "next" });
    } else if (keyboard.key === "Enter" && keyboard.shiftKey) {
      keyboard.preventDefault();
      callbacks.onIntent({ kind: "prev" });
    } else if (keyboard.key === "Escape") {
      keyboard.preventDefault();
      callbacks.onIntent({ kind: "dismiss" });
    }
  });
  // Keep the bar's own keys from reaching the page's listeners.
  for (const element of [input, prev, next, close]) {
    element.addEventListener("keydown", (event: Event) => event.stopPropagation());
    element.addEventListener("keypress", (event: Event) => event.stopPropagation());
  }

  prev.addEventListener("click", () => callbacks.onIntent({ kind: "prev" }));
  next.addEventListener("click", () => callbacks.onIntent({ kind: "next" }));
  close.addEventListener("click", () => callbacks.onIntent({ kind: "dismiss" }));

  const selection = document.getSelection?.()?.toString().trim() ?? "";
  if (selection !== "") input.value = selection;

  return {
    host,
    query: () => input.value,
    preset: (text: string) => {
      input.value = text;
    },
    focus: () => {
      input.focus();
      input.select();
    },
    remove: () => {
      host.remove();
    },
    setSearching: (searching: boolean) => {
      bar.setAttribute("data-searching", searching ? "true" : "false");
    },
    setStatus: (nextStatus: FindBarStatus) => {
      status.textContent = nextStatus.text;
      status.title = nextStatus.text;
      status.setAttribute("data-tone", nextStatus.tone);
      if (nextStatus.text.toLowerCase().includes("refresh")) {
        status.setAttribute("data-action", "reload");
      } else {
        status.removeAttribute("data-action");
      }
    },
    setCounts: (counts: FindBarCounts) => {
      count.textContent = describeCounts(counts);
      const hasMatches = counts.answer + counts.context > 0;
      prev.disabled = !hasMatches;
      next.disabled = !hasMatches;
    },
  };
}
