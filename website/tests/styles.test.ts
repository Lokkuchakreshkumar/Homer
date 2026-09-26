import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

function channel(value: number): number {
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const red = channel(Number.parseInt(hex.slice(1, 3), 16) / 255);
  const green = channel(Number.parseInt(hex.slice(3, 5), 16) / 255);
  const blue = channel(Number.parseInt(hex.slice(5, 7), 16) / 255);
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrast(foreground: string, background: string): number {
  const foregroundLuminance = luminance(foreground);
  const backgroundLuminance = luminance(background);
  return (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) / (Math.min(foregroundLuminance, backgroundLuminance) + 0.05);
}

async function styles(): Promise<string> {
  const globals = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  const tokens = await readFile(new URL("../tokens.css", import.meta.url), "utf8");
  return `${tokens}\n${globals}`;
}

function variable(css: string, name: string): string {
  const value = css.match(new RegExp(`${name}:\\s*(#[0-9a-f]{6})`, "i"))?.[1];
  assert.ok(value, `${name} must be a six-digit hex color`);
  return value;
}

function rule(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const value = css.match(new RegExp(`(?:^|})\\s*${escaped}\\s*\\{([^}]*)\\}`, "i"))?.[1];
  assert.ok(value, `${selector} must have a CSS rule`);
  return value;
}

test("section labels meet WCAG AA on the paper-deep background", async () => {
  const css = await styles();
  const labelColor = variable(css, "--purple-deep");
  const paperDeep = variable(css, "--paper-deep");
  assert.match(rule(css, ".section-label"), /color:\s*var\(--purple-deep\)/);
  assert.match(rule(css, ".section-product"), /background:\s*var\(--paper-deep\)/);
  assert.ok(contrast(labelColor, paperDeep) >= 4.5, `${labelColor} on ${paperDeep} must have a contrast ratio of at least 4.5`);
});

test("muted text meets WCAG AA on every light surface it uses", async () => {
  const css = await styles();
  const muted = variable(css, "--secondary-foreground");
  const lightSurfaces = [
    "--canvas",
    "--surface",
    "--surface-soft",
    "--cream",
    "--paper-deep",
    "--lavender-soft",
    "--lavender",
    "--coral-soft",
  ].map((name) => variable(css, name));

  for (const surface of lightSurfaces) {
    assert.ok(contrast(muted, surface) >= 4.5, `${muted} on ${surface} must have a contrast ratio of at least 4.5`);
  }

  for (const selector of [".eyebrow", ".hero-document-footer", ".document-footer", ".context-paragraph", ".demo-boundary", ".faq-intro > p"]) {
    assert.match(rule(css, selector), /color:\s*var\(--secondary-foreground\)/, `${selector} must use the audited muted token`);
  }
});

test("selected sample queries and highlighted passages meet WCAG AA", async () => {
  const css = await styles();
  const surface = variable(css, "--surface");
  const selectedBackground = variable(css, "--purple-deep");
  const selectedRule = css.match(/\.query-chip:hover,\s*\.query-chip:has\(input:checked\)\s*\{([^}]*)\}/i)?.[1];
  assert.ok(selectedRule);
  assert.match(selectedRule, /background:\s*var\(--purple-deep\)/);
  assert.match(selectedRule, /color:\s*var\(--surface\)/);
  assert.ok(contrast(surface, selectedBackground) >= 4.5);

  const highlightBackground = css.match(/mark\s*\{[^}]*background:\s*(#[0-9a-f]{6})/i)?.[1];
  const highlightForeground = variable(css, "--ink");
  assert.ok(highlightBackground);
  assert.match(rule(css, "mark"), /color:\s*var\(--ink\)/);
  assert.ok(contrast(highlightForeground, highlightBackground) >= 4.5);
});

test("the trust section keeps its dark surface and readable overrides", async () => {
  const css = await styles();
  const trustSurface = variable(css, "--trust-surface");
  const trustMuted = variable(css, "--trust-muted");
  const trustForeground = variable(css, "--surface");
  assert.match(rule(css, ".section-privacy"), /background:\s*var\(--ink\)/);
  assert.match(rule(css, ".section-privacy"), /color:\s*var\(--surface\)/);
  assert.ok(contrast(trustMuted, trustSurface) >= 4.5);
  assert.ok(contrast(trustForeground, trustSurface) >= 4.5);
});
