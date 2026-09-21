/**
 * What happens to matched elements, and how it is undone.
 *
 * Elements carry their Jev state as a data attribute rather than an inline style, so the
 * hiding rule lives in one injected stylesheet and the page's own classes and cascades
 * stay untouched. `remove()` is the only operation that cannot be reversed with an
 * attribute flip, and even it records everything needed to re-insert the node.
 */

/**
 * Attribute keyed on the verdict's action. A stylesheet injected by the content script
 * hides `prov` and `hide` and leaves `keep` explicitly normal, so a node that survives a
 * second scan can have its attribute cleared without inheriting a stale rule.
 */
export const JEV_AD_ATTRIBUTE = "data-jev-ad";

export type AdMark = "prov" | "hide" | "remove" | "highlight";

export interface RemovalEvent {
  /** The candidate id, matching the verdict that produced it. */
  readonly id: string;
  /** Tag, classes and first words of text — for the popup's log, never sent anywhere. */
  readonly summary: string;
  readonly category: string | null;
  readonly probability: number;
  /**
   * Image-source host for the audit log ("" when the unit carries no image
   * evidence). Named `imageHost` (not `host`) to stay distinct from the page
   * host elsewhere in tab state. Host-only by contract, like the rest of the
   * image evidence.
   */
  readonly imageHost: string;
  readonly at: number;
  readonly action?: "remove" | "hide" | "highlight";
}

export interface RemovedNode {
  readonly node: Node;
  readonly parent: ParentNode;
  readonly nextSibling: ChildNode | null;
}

/**
 * Everything the content script needs to say "what did you do to this page?" and to
 * take it back.
 */
export class AdLedger {
  /** Candidate ids we have ever acted on, so a re-scan never double-counts a node. */
  readonly actedOn = new Set<string>();
  /** Candidate ids mapped to the live node they refer to. */
  readonly nodeById = new Map<string, Element>();
  /** The history shown in the popup, newest last. */
  readonly events: RemovalEvent[] = [];
  /** Active visual badges attached to highlighted ads. */
  readonly badges = new Map<string, HTMLElement>();
  /** Nodes taken out of the tree by `remove()`, in removal order. */
  readonly #removed: (RemovedNode & { id: string })[] = [];

  has(id: string): boolean {
    return this.actedOn.has(id);
  }

  /** Remember a candidate id before acting, so a re-entrant scan cannot see it twice. */
  claim(id: string, element: Element): boolean {
    if (this.actedOn.has(id)) return false;
    this.actedOn.add(id);
    this.nodeById.set(id, element);
    return true;
  }

  mark(element: Element, value: AdMark | null): void {
    if (value === null) {
      element.removeAttribute(JEV_AD_ATTRIBUTE);
      return;
    }
    element.setAttribute(JEV_AD_ATTRIBUTE, value);
  }

  /** Append to the history shown in the popup. */
  record(id: string, event: Omit<RemovalEvent, "id" | "at">): void {
    this.events.push({ ...event, id, at: Date.now() });
  }

  /** Attach a high-visibility badge overlay next to an ad element in highlight mode. */
  attachBadge(id: string, element: Element, label: string): HTMLElement | null {
    this.removeBadge(id);
    const doc = element.ownerDocument;
    if (!doc) return null;
    const badge = doc.createElement("div");
    badge.className = "jev-ad-badge";
    badge.setAttribute("data-jev-ui", "true");
    badge.textContent = label;
    const parent = element.parentNode;
    if (parent) {
      parent.insertBefore(badge, element);
    } else {
      try {
        element.appendChild(badge);
      } catch {
        return null;
      }
    }
    this.badges.set(id, badge);
    return badge;
  }

  removeBadge(id: string): void {
    const existing = this.badges.get(id);
    if (existing) {
      try {
        existing.remove();
      } catch {
        // Already gone
      }
      this.badges.delete(id);
    }
  }

  clearBadges(): void {
    for (const badge of this.badges.values()) {
      try {
        badge.remove();
      } catch {
        // Already gone
      }
    }
    this.badges.clear();
  }

  /** Remember where a removed node lived, so undo or highlight mode can put it back. */
  stashRemoval(id: string, removed: RemovedNode): void {
    this.#removed.push({ ...removed, id });
  }

  /** Switch between Auto-Hide and Highlight mode dynamically without reloading. */
  setMode(mode: "hide" | "highlight"): void {
    if (mode === "highlight") {
      // Put back any nodes removed from the DOM so they can be inspected
      for (const entry of this.#removed) {
        try {
          if (entry.node.parentNode === null) {
            if (entry.nextSibling !== null && entry.nextSibling.parentNode === entry.parent) {
              entry.parent.insertBefore(entry.node, entry.nextSibling);
            } else {
              entry.parent.appendChild(entry.node);
            }
          }
        } catch {
          // Page re-rendered
        }
      }
      for (const [id, element] of this.nodeById.entries()) {
        this.mark(element, "highlight");
        const event = this.events.find((e) => e.id === id);
        const cat = event?.category ?? "ad";
        const pct = event && event.probability > 0 ? ` (${Math.round(event.probability * 100)}%)` : "";
        this.attachBadge(id, element, `🚨 Jev Detected Ad: ${cat}${pct}`);
      }
    } else {
      // Revert to hide mode
      this.clearBadges();
      for (const element of this.nodeById.values()) {
        this.mark(element, "hide");
      }
    }
  }

  /** Re-insert removed nodes, clear badges, and clear every attribute set. */
  restore(): number {
    this.clearBadges();
    let restored = 0;
    for (const entry of this.#removed.splice(0)) {
      try {
        if (entry.nextSibling !== null && entry.nextSibling.parentNode === entry.parent) {
          entry.parent.insertBefore(entry.node, entry.nextSibling);
        } else {
          entry.parent.appendChild(entry.node);
        }
        restored += 1;
      } catch {
        // The page re-rendered around us; the node is gone, and the attribute marks below
        // are cleared regardless so the page reads as "back to normal".
      }
      this.actedOn.delete(entry.id);
    }

    for (const element of this.nodeById.values()) {
      try {
        element.removeAttribute(JEV_AD_ATTRIBUTE);
      } catch {
        // The node is already gone from the tree.
      }
    }
    this.nodeById.clear();
    this.actedOn.clear();
    return restored;
  }

  /** Forget a claimed id so a late verdict for it is ignored. */
  release(id: string): void {
    this.removeBadge(id);
    this.actedOn.delete(id);
    this.nodeById.delete(id);
  }

  reset(): void {
    this.clearBadges();
    this.actedOn.clear();
    this.nodeById.clear();
    this.events.length = 0;
    this.#removed.length = 0;
  }
}
