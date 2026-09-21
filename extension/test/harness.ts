/**
 * Test harness for the DOM adapter.
 *
 * `dom.ts` takes a `Measurer` instead of calling `getComputedStyle` and
 * `getBoundingClientRect` directly, because layout is the one thing a headless DOM cannot
 * provide. That seam is what lets these tests run the real extraction code over the real
 * fixture files instead of over hand-written descriptors.
 */

import { readFileSync } from "node:fs";
import { parseHTML } from "linkedom";
import type { Measurer } from "../src/dom.ts";

export interface Box {
  readonly width: number;
  readonly height: number;
  readonly position?: string;
  readonly zIndex?: number;
  readonly display?: string;
  readonly backgroundImage?: string;
}

export const VIEWPORT = { width: 1280, height: 800 } as const;

/** Applied when no table entry matches: visible, ordinary, unremarkable. */
export const DEFAULT_BOX: Box = { width: 600, height: 60 };

/** A measurer that answers from a selector-keyed table, first match wins. */
export function measurerFor(table: Readonly<Record<string, Box>>): Measurer {
  const lookup = (element: Element): Box => {
    for (const [selector, box] of Object.entries(table)) {
      try {
        if (element.matches(selector)) return box;
      } catch {
        // A malformed selector in a test table should fail loudly at the assertion, not here.
      }
    }
    return DEFAULT_BOX;
  };

  return {
    style: (element) => {
      const box = lookup(element);
      return {
        position: box.position ?? "static",
        zIndex: box.zIndex === undefined ? "auto" : String(box.zIndex),
        display: box.display ?? "block",
        visibility: "visible",
        opacity: "1",
        backgroundImage: box.backgroundImage ?? "none",
      };
    },
    rect: (element) => {
      const box = lookup(element);
      return { width: box.width, height: box.height };
    },
    viewport: () => ({ ...VIEWPORT }),
  };
}

/** Parse one of the fixture pages into a linkedom document. */
export function parseFixture(name: string): Document {
  const html = readFileSync(new URL(`../../server/fixtures/${name}`, import.meta.url), "utf8");
  return parseHTML(html).document as unknown as Document;
}

export function fixtureText(name: string): string {
  return readFileSync(new URL(`../../server/fixtures/${name}`, import.meta.url), "utf8");
}

/**
 * Geometry for `fixtures/ads.html`, keyed by selector. Mirrors the fixture's own CSS.
 *
 * Shared so that the DOM tests and the end-to-end pipeline test measure the same page the
 * same way. If these two ever disagreed, the pipeline test would be validating a different
 * page from the one the extraction test does.
 */
export const ADS_LAYOUT: Readonly<Record<string, Box>> = {
  "#ad-leaderboard": { width: 728, height: 90 },
  "#newsletter-modal": { width: 1280, height: 800, position: "fixed", zIndex: 9999 },
  "#sponsored-card-1": { width: 600, height: 80 },
  "#ad-iframe-wrap": { width: 300, height: 250 },
  "#google-ads-frame": { width: 300, height: 250 },
  "#outbrain-feed": { width: 600, height: 220 },
  "#sponsored-in-feed": { width: 600, height: 90 },
  "#youtube-player": { width: 560, height: 315 },
  "#cookie-consent": { width: 1280, height: 90, position: "fixed", zIndex: 500 },
  "#site-nav": { width: 1280, height: 40 },
  "#promo-sticky": { width: 1280, height: 70, position: "fixed", zIndex: 1000 },
  "#site-brand": { width: 120, height: 40 },
  "#story-teaser-2": { width: 300, height: 250 },
  "#img-picture-srcset": { width: 300, height: 250 },
  "#img-native-caption": { width: 360, height: 300 },
  "#img-editorial": { width: 800, height: 500 },
  "#img-chart-note": { width: 800, height: 500 },  main: { width: 800, height: 600 },
  article: { width: 760, height: 500 },
};

/**
 * Every element in `fixtures/ads.html` that carries a `data-expect` annotation, read out
 * of the fixture itself rather than restated here.
 */
export function fixtureExpectations(name = "ads.html"): Map<string, string> {
  const html = fixtureText(name);
  const expectations = new Map<string, string>();
  const pattern = /id="([^"]+)"[^>]*data-expect="([^"]+)"/g;
  for (let match = pattern.exec(html); match !== null; match = pattern.exec(html)) {
    const id = match[1];
    const expectation = match[2];
    if (id !== undefined && expectation !== undefined) expectations.set(id, expectation);
  }
  return expectations;
}
