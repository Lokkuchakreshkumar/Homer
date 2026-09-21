(() => {
  // extension/shared/wire.ts
  function emptyUsage() {
    return {
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      upstreamRequests: 0,
      cacheHits: 0,
      model: null
    };
  }
  function addUsage(a, b) {
    return {
      inputTokens: a.inputTokens + b.inputTokens,
      outputTokens: a.outputTokens + b.outputTokens,
      costUsd: a.costUsd + b.costUsd,
      upstreamRequests: a.upstreamRequests + b.upstreamRequests,
      cacheHits: a.cacheHits + b.cacheHits,
      model: b.model ?? a.model
    };
  }
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
  function hostMatches(host, patterns) {
    if (host === "") return false;
    const needle = host.toLowerCase();
    return patterns.some((raw) => {
      const pattern = raw.trim().toLowerCase();
      return pattern !== "" && needle.includes(pattern);
    });
  }
  function hostnameOf(rawUrl) {
    try {
      return new URL(rawUrl).hostname;
    } catch {
      return "";
    }
  }

  // extension/src/heuristics.ts
  var BLOCK_RULES = {
    /** Below this, a block is a label or a fragment and not worth a question option. */
    minWords: 4,
    /** Adjacent siblings this short get merged, so a heading rides with its paragraph. */
    mergeBelowWords: 15,
    /** Above this, a block is split on sentence boundaries. */
    splitAboveWords: 200,
    /** Cap per search. Two thousand blocks covers full long-form encyclopedic articles. */
    maxBlocks: 2e3
  };
  function cleanBlockText(raw) {
    return raw.replace(/\s+/g, " ").trim();
  }
  function countWords(text) {
    const cleaned = text.trim();
    return cleaned === "" ? 0 : cleaned.split(/\s+/).length;
  }
  function isEligibleBlock(text) {
    const cleaned = cleanBlockText(text);
    if (cleaned.length < 12) return false;
    return countWords(cleaned) >= BLOCK_RULES.minWords;
  }
  function blockId(index) {
    return `b${index.toString().padStart(3, "0")}`;
  }
  function toTextBlock(index, text) {
    const cleaned = cleanBlockText(text);
    return { id: blockId(index), text: cleaned, words: countWords(cleaned) };
  }
  function isSentenceBoundary(raw, termEnd) {
    let index = termEnd;
    while (index < raw.length && /\s/.test(raw[index] ?? "")) index += 1;
    if (index >= raw.length) return true;
    return /[\p{Lu}"“'(\[]/u.test(raw[index] ?? "");
  }
  function splitSentenceSpans(raw) {
    if (raw === "") return [];
    const spans = [];
    const terminator = /[.!?…]+["')\]]*/gu;
    let from = 0;
    let match;
    while ((match = terminator.exec(raw)) !== null) {
      const termStart = match.index;
      const termEnd = termStart + match[0].length;
      if (/([.\s]|^)[A-Z]$/.test(raw.slice(0, termStart))) continue;
      if (!isSentenceBoundary(raw, termEnd)) continue;
      spans.push({ start: from, end: termEnd });
      from = termEnd;
      while (from < raw.length && /\s/.test(raw[from] ?? "")) from += 1;
    }
    if (from < raw.length) spans.push({ start: from, end: raw.length });
    return spans;
  }

  // extension/src/dom.ts
  var DEFAULT_STYLE = {
    position: "static",
    zIndex: "auto",
    display: "block",
    visibility: "visible",
    opacity: "1",
    backgroundImage: "none"
  };
  var browserMeasurer = {
    style(element) {
      const view = element.ownerDocument?.defaultView;
      const computed = view?.getComputedStyle?.(element);
      if (!computed) return DEFAULT_STYLE;
      let backgroundImage = "none";
      try {
        const raw = computed.getPropertyValue("background-image") ?? "";
        if (raw !== "" && raw !== "none") backgroundImage = raw;
      } catch {
      }
      return {
        position: computed.position || DEFAULT_STYLE.position,
        zIndex: computed.zIndex || DEFAULT_STYLE.zIndex,
        display: computed.display || DEFAULT_STYLE.display,
        visibility: computed.visibility || DEFAULT_STYLE.visibility,
        opacity: computed.opacity || DEFAULT_STYLE.opacity,
        backgroundImage
      };
    },
    rect(element) {
      const box = element.getBoundingClientRect();
      return { width: box.width, height: box.height };
    },
    viewport() {
      return {
        width: globalThis.innerWidth ?? 0,
        height: globalThis.innerHeight ?? 0
      };
    }
  };
  var EXCLUDED_BLOCK_CONTAINER_SELECTOR = "ol.references, .references, .reflist, .navbox, footer, nav, [role='navigation'], #mw-navigation, noscript";
  var BLOCK_SELECTOR = "p, li, h1, h2, h3, h4, h5, h6, blockquote, td, th, dd, dt, figcaption, summary, pre";
  function isVisible(element, measurer) {
    const style = measurer.style(element);
    if (style.display === "none" || style.visibility === "hidden") return false;
    if (Number.parseFloat(style.opacity) === 0) return false;
    const rect = measurer.rect(element);
    return rect.width > 0 && rect.height > 0;
  }
  function isInExcludedBlockContainer(element) {
    try {
      return element.closest(EXCLUDED_BLOCK_CONTAINER_SELECTOR) !== null;
    } catch {
      return false;
    }
  }
  function textPieces(element) {
    const pieces = [];
    let offset = 0;
    const walker = element.ownerDocument.createTreeWalker(
      element,
      4
      /* SHOW_TEXT */
    );
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const text = node;
      const length = text.data.length;
      if (length === 0) continue;
      pieces.push({ node: text, start: offset, end: offset + length });
      offset += length;
    }
    return pieces;
  }
  function rangeFromOffsets(document2, pieces, from, to) {
    let start = null;
    let end = null;
    for (const piece of pieces) {
      if (start === null && from >= piece.start && from <= piece.end) start = piece;
      if (to >= piece.start && to <= piece.end) {
        end = piece;
        break;
      }
    }
    if (start === null || end === null) return null;
    try {
      const range = document2.createRange();
      range.setStart(start.node, from - start.start);
      range.setEnd(end.node, to - end.start);
      return range;
    } catch {
      return null;
    }
  }
  function rangesForElement(element, maxWords = BLOCK_RULES.splitAboveWords) {
    const document2 = element.ownerDocument;
    const whole = document2.createRange();
    whole.selectNodeContents(element);
    const pieces = textPieces(element);
    const raw = pieces.map((piece) => piece.node.data).join("");
    if (raw.split(/\s+/).filter((word) => word !== "").length <= maxWords) return [whole];
    const boundaries = [];
    const sentenceEnd = /[.!?]["')\]]?\s/g;
    for (let match = sentenceEnd.exec(raw); match !== null; match = sentenceEnd.exec(raw)) {
      boundaries.push(match.index + match[0].length);
    }
    if (boundaries.length === 0) return [whole];
    const ranges = [];
    let from = 0;
    let words = 0;
    let cursor = 0;
    for (let index = 0; index < raw.length; index += 1) {
      if (index === 0 || /\s/.test(raw[index - 1] ?? " ")) {
        const next = raw.slice(index).split(/\s+/)[0] ?? "";
        if (next !== "") words += 1;
      }
      if (words >= maxWords && boundaries[cursor] !== void 0 && index >= (boundaries[cursor] ?? 0)) {
        const to = boundaries[cursor] ?? index;
        const range = rangeFromOffsets(document2, pieces, from, to);
        if (range !== null) ranges.push(range);
        from = to;
        cursor += 1;
        words = 0;
      }
    }
    const tail = rangeFromOffsets(document2, pieces, from, raw.length);
    if (tail !== null) ranges.push(tail);
    return ranges.length > 0 ? ranges : [whole];
  }
  function extractBlocks(root, measurer, limit = BLOCK_RULES.maxBlocks) {
    const candidates = [];
    try {
      for (const element of root.querySelectorAll(BLOCK_SELECTOR)) {
        const element_ = element;
        if (isInExcludedBlockContainer(element_)) continue;
        if (!isVisible(element_, measurer)) continue;
        const text = cleanBlockText(element_.textContent ?? "");
        if (!isEligibleBlock(text)) continue;
        candidates.push(element_);
      }
    } catch {
      return [];
    }
    const chosen = candidates.filter((element) => {
      const inner = candidates.some(
        (other) => other !== element && element.contains(other)
      );
      return !inner;
    });
    const blocks = [];
    for (const element of chosen) {
      if (blocks.length >= limit) break;
      pushElementBlocks(element, blocks, limit);
    }
    return blocks;
  }
  function pushElementBlocks(element, blocks, limit) {
    const document2 = element.ownerDocument;
    const pieces = textPieces(element);
    const raw = pieces.map((piece) => piece.node.data).join("");
    const sentences = splitSentenceSpans(raw);
    if (sentences.length <= 1) {
      pushWholeElementBlock(element, blocks);
      return;
    }
    const eligible = sentences.map((span) => ({ ...span, text: cleanBlockText(raw.slice(span.start, span.end)) })).filter((span) => isEligibleBlock(span.text));
    if (eligible.length === 0) {
      pushWholeElementBlock(element, blocks);
      return;
    }
    for (const span of eligible) {
      if (blocks.length >= limit) break;
      const range = rangeFromOffsets(document2, pieces, span.start, span.end) ?? wholeElementRange(document2, element);
      blocks.push({ block: toTextBlock(blocks.length, span.text), element, ranges: [range] });
    }
  }
  function pushWholeElementBlock(element, blocks) {
    const ranges = rangesForElement(element);
    const text = cleanBlockText(element.textContent ?? "");
    blocks.push({ block: toTextBlock(blocks.length, text), element, ranges });
  }
  function wholeElementRange(document2, element) {
    const range = document2.createRange();
    range.selectNodeContents(element);
    return range;
  }

  // extension/src/content/highlight.ts
  var HIGHLIGHT_STRONG = "jev-hit-strong";
  var HIGHLIGHT_LOOSE = "jev-hit-loose";
  var HIGHLIGHT_ACTIVE = "jev-hit-active";
  var MARK_ATTRIBUTE = "data-jev-hit";
  function customHighlightsAvailable() {
    try {
      return typeof CSS !== "undefined" && "highlights" in CSS && typeof globalThis.Highlight === "function";
    } catch {
      return false;
    }
  }
  function highlightStylesheetText() {
    return [
      // Answer tier: amber highlight ("this is the answer span"). Fixed meaning (ticket 07):
      // strong always paints the answer, never a generic "strong match".
      `::highlight(${HIGHLIGHT_STRONG}) { background-color: rgba(245, 158, 11, 0.45); color: inherit; border-radius: 2px; }`,
      // Context tier: slate-blue highlight ("supporting passage"). Fixed meaning (ticket 07):
      // loose always paints context hits, never a generic "loose match".
      `::highlight(${HIGHLIGHT_LOOSE}) { background-color: rgba(99, 132, 172, 0.30); color: inherit; border-radius: 2px; }`,
      // Active tier: vivid electric cyan with bold contrast so the selected hit pops immediately
      `::highlight(${HIGHLIGHT_ACTIVE}) { background-color: #38bdf8; color: #020617; font-weight: 600; border-radius: 2px; }`,
      `mark[${MARK_ATTRIBUTE}] { background-color: rgba(245, 158, 11, 0.45); color: inherit; border-radius: 2px; }`,
      `mark[${MARK_ATTRIBUTE}="loose"] { background-color: rgba(99, 132, 172, 0.30); }`,
      `mark[${MARK_ATTRIBUTE}="active"] { background-color: #38bdf8; color: #020617; font-weight: 600; border-radius: 2px; }`,
      // Visual focus ring for the target element currently navigated to
      `.jev-target-active { outline: 2px solid #38bdf8 !important; outline-offset: 4px !important; border-radius: 4px !important; transition: outline 0.2s ease !important; }`
    ].join("\n");
  }
  function installHighlightStylesheet(document2) {
    if (document2.getElementById("jev-highlight-style") !== null) return;
    const holder = document2.documentElement ?? document2.head ?? document2.body;
    if (!holder) return;
    const style = document2.createElement("style");
    style.id = "jev-highlight-style";
    style.textContent = highlightStylesheetText();
    holder.appendChild(style);
  }
  var HighlightConstructor = customHighlightsAvailable() ? globalThis["Highlight"] : null;
  function setCustomHighlight(name, ranges) {
    if (HighlightConstructor === null) return;
    const highlights = CSS.highlights;
    try {
      highlights.set(name, new HighlightConstructor(...ranges));
    } catch {
    }
  }
  function clearCustomHighlight(name) {
    if (!customHighlightsAvailable()) return;
    try {
      CSS.highlights.delete(name);
    } catch {
    }
  }
  function wrapRangesInMarks(ranges, tier) {
    const marks = [];
    for (const range of ranges) {
      const document2 = range.startContainer.ownerDocument;
      if (!document2) continue;
      try {
        const mark = document2.createElement("mark");
        mark.setAttribute(MARK_ATTRIBUTE, tier === "strong" ? "strong" : "loose");
        range.surroundContents(mark);
        marks.push(mark);
      } catch {
        try {
          const mark = document2.createElement("mark");
          mark.setAttribute(MARK_ATTRIBUTE, tier === "strong" ? "strong" : "loose");
          mark.appendChild(range.extractContents());
          range.insertNode(mark);
          marks.push(mark);
        } catch {
        }
      }
    }
    return marks;
  }
  var Highlighter = class {
    #custom;
    #marks = [];
    #activeMark = null;
    #activeOriginalTier = null;
    constructor() {
      this.#custom = customHighlightsAvailable();
    }
    get technique() {
      return this.#custom ? "custom" : "marks";
    }
    paint(document2, strong, loose) {
      installHighlightStylesheet(document2);
      this.clear(document2);
      if (this.#custom) {
        setCustomHighlight(HIGHLIGHT_STRONG, strong);
        setCustomHighlight(HIGHLIGHT_LOOSE, loose);
        clearCustomHighlight(HIGHLIGHT_ACTIVE);
        return;
      }
      this.#marks.push(...wrapRangesInMarks(strong, "strong"));
      this.#marks.push(...wrapRangesInMarks(loose, "loose"));
    }
    setActive(range) {
      if (this.#custom) {
        if (range === null) {
          clearCustomHighlight(HIGHLIGHT_ACTIVE);
        } else {
          setCustomHighlight(HIGHLIGHT_ACTIVE, [range]);
        }
        return;
      }
      if (this.#activeMark !== null && this.#activeOriginalTier !== null) {
        this.#activeMark.setAttribute(MARK_ATTRIBUTE, this.#activeOriginalTier);
        this.#activeMark = null;
        this.#activeOriginalTier = null;
      }
      if (range === null) return;
      const node = range.commonAncestorContainer;
      for (const mark of this.#marks) {
        if (mark === node || mark.contains(node) || node.contains(mark)) {
          this.#activeOriginalTier = mark.getAttribute(MARK_ATTRIBUTE) ?? "strong";
          mark.setAttribute(MARK_ATTRIBUTE, "active");
          this.#activeMark = mark;
          break;
        }
      }
    }
    clear(document2) {
      if (this.#custom) {
        clearCustomHighlight(HIGHLIGHT_STRONG);
        clearCustomHighlight(HIGHLIGHT_LOOSE);
        clearCustomHighlight(HIGHLIGHT_ACTIVE);
        return;
      }
      this.#activeMark = null;
      this.#activeOriginalTier = null;
      for (const mark of this.#marks.splice(0)) {
        try {
          const parent = mark.parentNode;
          if (parent === null) continue;
          while (mark.firstChild !== null) parent.insertBefore(mark.firstChild, mark);
          parent.removeChild(mark);
        } catch {
        }
      }
      void document2;
    }
  };

  // extension/src/content/findbar.ts
  var BAR_STYLES = `
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
  function describeCounts(counts) {
    if (counts.answer === 0 && counts.context === 0) return "0 matches";
    const parts = [];
    if (counts.answer > 0) parts.push(counts.answer === 1 ? "1 answer" : `${counts.answer} answers`);
    if (counts.context > 0) parts.push(`${counts.context} context`);
    const walked = ` \xB7 ${counts.current + 1}/${counts.answer + counts.context}`;
    return `${parts.join(" + ")}${walked}`;
  }
  function describeVerdict(verdict, counts) {
    if (verdict === "answered") {
      return counts.answer > 0 ? "answer found" : "closest wording, not a confident match";
    }
    if (verdict === "partial") return "partially addressed";
    return "no answer on this page";
  }
  function mountFindBar(document2, callbacks) {
    const host = document2.createElement("div");
    host.id = "jev-find-bar";
    host.setAttribute("data-jev-ui", "true");
    document2.documentElement.appendChild(host);
    const shadow = host.attachShadow({ mode: "closed" });
    const style = document2.createElement("style");
    style.textContent = BAR_STYLES;
    shadow.appendChild(style);
    const bar = document2.createElement("div");
    bar.className = "jev-bar";
    bar.setAttribute("data-searching", "false");
    shadow.appendChild(bar);
    const brand = document2.createElement("div");
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
    const input = document2.createElement("input");
    input.className = "jev-input";
    input.type = "search";
    input.placeholder = "Search by meaning...";
    input.setAttribute("aria-label", "Semantic find");
    bar.appendChild(input);
    const count = document2.createElement("span");
    count.className = "jev-count";
    count.textContent = "";
    bar.appendChild(count);
    const divider = document2.createElement("div");
    divider.className = "jev-divider";
    bar.appendChild(divider);
    const btnGroup = document2.createElement("div");
    btnGroup.className = "jev-btn-group";
    const prev = document2.createElement("button");
    prev.className = "jev-btn";
    prev.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"></polyline></svg>`;
    prev.title = "Previous match (Shift+Enter)";
    prev.disabled = true;
    btnGroup.appendChild(prev);
    const next = document2.createElement("button");
    next.className = "jev-btn";
    next.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>`;
    next.title = "Next match (Enter)";
    next.disabled = true;
    btnGroup.appendChild(next);
    const close = document2.createElement("button");
    close.className = "jev-btn close";
    close.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;
    close.title = "Close (Esc)";
    btnGroup.appendChild(close);
    bar.appendChild(btnGroup);
    const statusWrap = document2.createElement("div");
    statusWrap.className = "jev-status-wrap";
    const spinner = document2.createElement("span");
    spinner.className = "jev-spinner";
    const status = document2.createElement("div");
    status.className = "jev-status";
    status.textContent = "";
    statusWrap.append(spinner, status);
    bar.appendChild(statusWrap);
    status.addEventListener("click", () => {
      if (status.getAttribute("data-action") === "reload") {
        try {
          window.location.reload();
        } catch {
        }
      }
    });
    input.addEventListener("input", () => callbacks.onIntent({ kind: "query", text: input.value }));
    input.addEventListener("keydown", (event) => {
      const keyboard = event;
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
    for (const element of [input, prev, next, close]) {
      element.addEventListener("keydown", (event) => event.stopPropagation());
      element.addEventListener("keypress", (event) => event.stopPropagation());
    }
    prev.addEventListener("click", () => callbacks.onIntent({ kind: "prev" }));
    next.addEventListener("click", () => callbacks.onIntent({ kind: "next" }));
    close.addEventListener("click", () => callbacks.onIntent({ kind: "dismiss" }));
    const selection = document2.getSelection?.()?.toString().trim() ?? "";
    if (selection !== "") input.value = selection;
    return {
      host,
      query: () => input.value,
      preset: (text) => {
        input.value = text;
      },
      focus: () => {
        input.focus();
        input.select();
      },
      remove: () => {
        host.remove();
      },
      setSearching: (searching) => {
        bar.setAttribute("data-searching", searching ? "true" : "false");
      },
      setStatus: (nextStatus) => {
        status.textContent = nextStatus.text;
        status.title = nextStatus.text;
        status.setAttribute("data-tone", nextStatus.tone);
        if (nextStatus.text.toLowerCase().includes("refresh")) {
          status.setAttribute("data-action", "reload");
        } else {
          status.removeAttribute("data-action");
        }
      },
      setCounts: (counts) => {
        count.textContent = describeCounts(counts);
        const hasMatches = counts.answer + counts.context > 0;
        prev.disabled = !hasMatches;
        next.disabled = !hasMatches;
      }
    };
  }

  // extension/src/worker-client.ts
  function isEnvelope(value) {
    return typeof value === "object" && value !== null && "ok" in value;
  }
  async function sendWorkerMessage(message) {
    if (typeof chrome !== "undefined" && !chrome.runtime?.id) {
      throw new Error("Extension reloaded. Please refresh this page (Ctrl+R).");
    }
    try {
      return await chrome.runtime.sendMessage(message);
    } catch (cause) {
      const msg = cause instanceof Error ? cause.message : String(cause);
      if (msg.includes("Extension context invalidated") || typeof chrome !== "undefined" && !chrome.runtime?.id) {
        throw new Error("Extension reloaded. Please refresh this page (Ctrl+R).");
      }
      throw cause;
    }
  }
  async function searchViaWorker(message) {
    const raw = await sendWorkerMessage(message);
    if (!isEnvelope(raw)) {
      throw new Error("the companion did not answer; it may have been restarted mid-request");
    }
    if (!raw.ok) throw new Error(raw.message);
    if (!("hits" in raw.payload)) {
      throw new Error("the companion answered with the wrong payload shape");
    }
    return raw.payload;
  }

  // extension/src/content/search.ts
  var MIN_REEXTRACTION_GAP_MS = 800;
  function partitionAnswer(hits) {
    const answerIndex = hits.findIndex((hit) => hit.tier === "strong");
    const answer = answerIndex === -1 ? void 0 : hits[answerIndex];
    if (answer === void 0) return { answer: null, context: hits };
    return { answer, context: [...hits.slice(0, answerIndex), ...hits.slice(answerIndex + 1)] };
  }
  function isLiveRange(document2, range) {
    try {
      const node = range.commonAncestorContainer;
      return node !== null && node !== void 0 && document2.contains(node);
    } catch {
      return false;
    }
  }
  function resolveHitRanges(document2, entries, hits) {
    const byId = new Map(entries.map((entry) => [entry.block.id, entry]));
    const { answer, context } = partitionAnswer(hits);
    const answerRanges = [];
    const contextRanges = [];
    const matches = [];
    let answerSpans = 0;
    let contextSpans = 0;
    let nextSpan = 0;
    const collect = (hit, tier, into) => {
      const entry = byId.get(hit.id);
      if (entry === void 0) return;
      const live = entry.ranges.filter((range) => isLiveRange(document2, range));
      if (live.length === 0) return;
      const span = nextSpan++;
      into.push(...live);
      for (const range of live) matches.push({ range, tier, element: entry.element, span });
      if (tier === "strong") answerSpans += 1;
      else contextSpans += 1;
    };
    if (answer !== null) collect(answer, "strong", answerRanges);
    for (const hit of context) collect(hit, "loose", contextRanges);
    return { answer: answerRanges, context: contextRanges, matches, answerSpans, contextSpans };
  }
  var SemanticFinder = class {
    #highlighter = new Highlighter();
    #bar = null;
    #blocks = [];
    #matches = [];
    #current = 0;
    #answerSpans = 0;
    #contextSpans = 0;
    #activeElement = null;
    #generation = 0;
    #debounceTimer = null;
    #lastExtraction = 0;
    /** The query the current highlights answer. Enter with an unchanged query walks instead. */
    #lastSearchedQuery = null;
    #document;
    #debounceMs;
    /** Called with every search's usage so the tab can account for the session. */
    onUsage;
    /** Called with the query each search actually answers, for the popup's record. */
    onQuery;
    constructor(document2, debounceMs, callbacks = {}) {
      this.#document = document2;
      this.#debounceMs = Math.max(0, Math.min(2e3, debounceMs));
      this.onUsage = callbacks.onUsage ?? (() => void 0);
      this.onQuery = callbacks.onQuery ?? (() => void 0);
    }
    get isOpen() {
      return this.#bar !== null;
    }
    open(preset = "") {
      this.close();
      this.#matches = [];
      this.#current = 0;
      this.#blocks = [];
      this.#lastExtraction = 0;
      this.#bar = mountFindBar(this.#document, { onIntent: (intent) => this.#onIntent(intent) });
      if (preset !== "") this.#bar.preset(preset);
      this.#bar.focus();
      this.#bar.setCounts({ answer: 0, context: 0, current: 0 });
      const initial = preset !== "" ? preset : this.#bar.query();
      if (initial.trim() !== "") void this.#runSearch(initial);
    }
    close() {
      if (this.#debounceTimer !== null) {
        clearTimeout(this.#debounceTimer);
        this.#debounceTimer = null;
      }
      this.#generation += 1;
      if (this.#activeElement !== null) {
        this.#activeElement.classList.remove("jev-target-active");
        this.#activeElement = null;
      }
      this.#highlighter.clear(this.#document);
      this.#bar?.remove();
      this.#bar = null;
      this.#matches = [];
      this.#current = 0;
    }
    /** Step the current match by `direction`, wrapping around. No-op without matches. */
    step(direction) {
      this.#step(direction);
    }
    #onIntent(intent) {
      switch (intent.kind) {
        case "dismiss":
          this.close();
          break;
        case "query":
          this.#schedule(intent.text);
          break;
        case "next":
          if (this.#bar !== null) void this.#searchNow(this.#bar.query());
          break;
        case "prev":
          this.#step(-1);
          break;
      }
    }
    #schedule(text) {
      if (this.#debounceTimer !== null) clearTimeout(this.#debounceTimer);
      if (text.trim() === "") {
        this.#clearResults("Semantic find \xB7 powered by Jev");
        return;
      }
      this.#debounceTimer = setTimeout(() => {
        this.#debounceTimer = null;
        void this.#runSearch(text);
      }, this.#debounceMs);
    }
    async #searchNow(query) {
      if (this.#debounceTimer !== null) {
        clearTimeout(this.#debounceTimer);
        this.#debounceTimer = null;
      }
      const trimmed = query.trim();
      if (trimmed === "") {
        this.#clearResults("Semantic find \xB7 powered by Jev");
        return;
      }
      if (trimmed === this.#lastSearchedQuery && this.#matches.length > 0) {
        this.#step(1);
        return;
      }
      await this.#runSearch(query);
    }
    /** Refresh blocks when they are stale, send the query, paint the answer. */
    async #runSearch(query) {
      const bar = this.#bar;
      if (bar === null) return;
      const trimmed = query.trim();
      if (trimmed === "") {
        this.#clearResults("Semantic find \xB7 powered by Jev");
        return;
      }
      const now = Date.now();
      if (this.#blocks.length === 0 || now - this.#lastExtraction >= MIN_REEXTRACTION_GAP_MS) {
        this.#blocks = extractBlocks(this.#document, browserMeasurer);
        this.#lastExtraction = now;
      }
      if (this.#blocks.length === 0) {
        this.#clearResults("No readable text on this page");
        return;
      }
      this.#lastSearchedQuery = trimmed;
      this.#clearPaint();
      const generation = this.#generation += 1;
      bar.setSearching(true);
      bar.setStatus({ text: "Asking Jev\u2026", tone: "info" });
      let response;
      try {
        response = await searchViaWorker({
          type: "jev:search",
          request: {
            pageUrl: this.#document.location?.href ?? "",
            query: trimmed,
            blocks: this.#blocks.map((entry) => entry.block)
          }
        });
      } catch (cause) {
        if (generation !== this.#generation || this.#bar === null) return;
        bar.setSearching(false);
        const message = cause instanceof Error ? cause.message : String(cause);
        if (message.includes("Extension context invalidated") || message.includes("Extension reloaded") || typeof chrome !== "undefined" && !chrome.runtime?.id) {
          bar.setStatus({
            text: "Extension reloaded \u2014 click to refresh page",
            tone: "warn"
          });
        } else {
          bar.setStatus({ text: `Could not search: ${message}`, tone: "warn" });
        }
        return;
      }
      if (generation !== this.#generation || this.#bar === null) return;
      this.onUsage(response.usage);
      this.onQuery(trimmed);
      this.#paint(response.hits, response.verdict, response.meta.warnings);
    }
    #paint(hits, verdict, warnings) {
      const bar = this.#bar;
      if (bar === null) return;
      bar.setSearching(false);
      const resolved = resolveHitRanges(this.#document, this.#blocks, hits);
      this.#matches = resolved.matches;
      this.#current = 0;
      this.#answerSpans = resolved.answerSpans;
      this.#contextSpans = resolved.contextSpans;
      this.#highlighter.paint(this.#document, resolved.answer, resolved.context);
      bar.setCounts({ answer: this.#answerSpans, context: this.#contextSpans, current: 0 });
      const verdictText = describeVerdict(verdict, {
        answer: this.#answerSpans,
        context: this.#contextSpans
      });
      if (warnings.length > 0) {
        const isBudgetNotice = warnings.some(
          (w) => w.includes("state budget") || w.includes("text blocks were searched")
        );
        if (isBudgetNotice) {
          const match = /first\s+(\d+)\s+text\s+blocks/i.exec(warnings.join(" "));
          const note = match?.[1] ? `(first ${match[1]} blocks)` : `(budget limit)`;
          bar.setStatus({ text: `${verdictText} ${note}`, tone: "info" });
        } else {
          bar.setStatus({ text: warnings.join(" \xB7 "), tone: "warn" });
        }
      } else {
        bar.setStatus({ text: verdictText, tone: "info" });
      }
      if (this.#matches.length > 0) {
        this.#updateActive(this.#current, false);
      } else {
        this.#updateActive(0, false);
      }
    }
    /** Drop paint, matches, and span totals without touching the query or status. */
    #clearPaint() {
      this.#matches = [];
      this.#current = 0;
      this.#answerSpans = 0;
      this.#contextSpans = 0;
      if (this.#activeElement !== null) {
        this.#activeElement.classList.remove("jev-target-active");
        this.#activeElement = null;
      }
      this.#highlighter.clear(this.#document);
      this.#bar?.setCounts({ answer: 0, context: 0, current: 0 });
    }
    #clearResults(status) {
      this.#clearPaint();
      this.#lastSearchedQuery = null;
      this.#bar?.setStatus({ text: status, tone: "info" });
    }
    #step(direction) {
      if (this.#matches.length === 0) return;
      this.#current = (this.#current + direction + this.#matches.length) % this.#matches.length;
      const position = this.#matches[this.#current]?.span ?? 0;
      this.#bar?.setCounts({
        answer: this.#answerSpans,
        context: this.#contextSpans,
        current: position
      });
      this.#updateActive(this.#current, true);
    }
    #updateActive(index, smooth) {
      const match = this.#matches[index];
      if (match === void 0) {
        this.#highlighter.setActive(null);
        if (this.#activeElement !== null) {
          this.#activeElement.classList.remove("jev-target-active");
          this.#activeElement = null;
        }
        return;
      }
      this.#highlighter.setActive(match.range);
      if (this.#activeElement !== match.element) {
        this.#activeElement?.classList.remove("jev-target-active");
        this.#activeElement = match.element;
        match.element.classList.add("jev-target-active");
      }
      try {
        match.element.scrollIntoView({ block: "center", behavior: smooth ? "smooth" : "auto" });
      } catch {
      }
    }
  };

  // extension/src/content/index.ts
  var settings = DEFAULT_SETTINGS;
  var finder = null;
  var settingsReady = false;
  var lastQuery = "";
  function setLastQuery(query) {
    lastQuery = query;
  }
  var sessionUsage = emptyUsage();
  function isTopFrame() {
    try {
      return window.top === window.self;
    } catch {
      return false;
    }
  }
  function tabEligible() {
    if (!isTopFrame()) return false;
    const href = document.location?.href ?? "";
    if (!/^https?:/i.test(href)) return false;
    return true;
  }
  async function loadSettings() {
    try {
      const stored = await chrome.storage.local.get(SETTINGS_KEY);
      return mergeSettings(stored[SETTINGS_KEY]);
    } catch {
      return DEFAULT_SETTINGS;
    }
  }
  function currentHost() {
    return hostnameOf(document.location?.href ?? "");
  }
  function nativeFindAllowedHere() {
    return hostMatches(currentHost(), settings.nativeFindHosts);
  }
  function shouldTakeOverFind(event) {
    const key = event.key?.toLowerCase();
    if (key !== "f") return { take: false, preset: "" };
    if (!event.ctrlKey && !event.metaKey) return { take: false, preset: "" };
    if (event.altKey) return { take: false, preset: "" };
    const isSemanticShortcut = event.shiftKey;
    const input = event.target;
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
  function finderInstance() {
    if (!settings.enabled || !settings.semanticFind.enabled) return null;
    if (finder === null) {
      finder = new SemanticFinder(document, settings.semanticFind.debounceMs, {
        onUsage: (usage) => {
          sessionUsage = addUsage(sessionUsage, usage);
        },
        onQuery: (query) => setLastQuery(query)
      });
    }
    return finder;
  }
  function onKeyDown(event) {
    if (!settings.enabled || event.defaultPrevented) return;
    const { take } = shouldTakeOverFind(event);
    if (!take) return;
    const instance = finderInstance();
    if (instance === null) return;
    try {
      event.preventDefault();
      event.stopPropagation();
    } catch {
    }
    if (event.key?.toLowerCase() === "f" && (event.ctrlKey || event.metaKey) && event.shiftKey) {
      instance.open();
      return;
    }
    if (!instance.isOpen) instance.open();
  }
  function onKeyUp(event) {
    const key = event.key?.toLowerCase();
    const findNext = key === "f3" || (event.ctrlKey || event.metaKey) && key === "g";
    if (!findNext || finder === null || !finder.isOpen) return;
    try {
      event.preventDefault();
      event.stopPropagation();
    } catch {
    }
    finder.step(event.shiftKey ? -1 : 1);
  }
  function tabState() {
    return {
      host: currentHost(),
      sessionCostUsd: sessionUsage.costUsd,
      findOpen: finder?.isOpen ?? false,
      lastQuery
    };
  }
  function onTabMessage(message, sendResponse) {
    if (typeof message !== "object" || message === null) return false;
    const type = message.type;
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
      instance.open(message.preset ?? "");
      sendResponse({ opened: true });
      return true;
    }
    return false;
  }
  async function boot() {
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
        if (!settings.enabled && finder !== null) {
          finder.close();
        }
      });
    });
  }
  if (document.documentElement instanceof Element) {
    void boot();
  }
})();
//# sourceMappingURL=content.js.map
