/**
 * Settings behaviour.
 *
 * The defaults are the security posture from the design: everything on but scoped, the
 * proxy local, and no never-send list in the way. A stored object is merged rather than
 * trusted, so a corrupt or hostile settings payload can at worst turn the extension off,
 * never widen what it sends.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_PROXY_URL,
  DEFAULT_SETTINGS,
  SETTINGS_KEY,
  enabledCategories,
  hostMatches,
  hostnameOf,
  mergeSettings,
} from "./settings.ts";

test("defaults enable both features with every category on", () => {
  assert.equal(DEFAULT_SETTINGS.enabled, true);
  assert.equal(DEFAULT_SETTINGS.adBlocking.enabled, true);
  assert.equal(DEFAULT_SETTINGS.adBlocking.mode, "hide");
  assert.deepEqual(enabledCategories(DEFAULT_SETTINGS), ["overlay", "sponsored", "adslot"]);
  assert.equal(DEFAULT_SETTINGS.semanticFind.enabled, true);
  assert.equal(DEFAULT_SETTINGS.semanticFind.takeOverCtrlF, true);
  assert.equal(DEFAULT_SETTINGS.proxyUrl, DEFAULT_PROXY_URL);
  assert.deepEqual(DEFAULT_SETTINGS.neverSendHosts, []);
});

test("merging keeps what it recognises and discards the rest", () => {
  const merged = mergeSettings({
    enabled: false,
    proxyUrl: "http://localhost:9000///",
    adBlocking: { categories: { overlay: false }, mode: "highlight" },
    semanticFind: { debounceMs: -5 },
    neverSendHosts: ["bank"],
    nativeFindHosts: 42,
    evil: true,
  });

  assert.equal(merged.enabled, false);
  assert.equal(merged.proxyUrl, "http://localhost:9000", "trailing slashes are normalised");
  assert.equal(merged.adBlocking.categories.overlay, false);
  assert.equal(merged.adBlocking.categories.sponsored, true, "a missing category stays default");
  assert.equal(merged.adBlocking.mode, "highlight", "mode is kept");
  assert.equal(merged.semanticFind.debounceMs, 0, "clamped into range");
  assert.deepEqual(merged.neverSendHosts, ["bank"]);
  assert.ok(!("evil" in merged));
});

test("merging a non-object yields the defaults rather than throwing", () => {
  for (const stored of [null, undefined, 42, "nope", []]) {
    assert.deepEqual(mergeSettings(stored), DEFAULT_SETTINGS);
  }
});

test("debouce clamps to the stated range", () => {
  assert.equal(mergeSettings({ semanticFind: { debounceMs: 99999 } }).semanticFind.debounceMs, 2000);
  assert.equal(
    mergeSettings({ semanticFind: { debounceMs: NaN } }).semanticFind.debounceMs,
    DEFAULT_SETTINGS.semanticFind.debounceMs,
  );
});

test("host matching is a case-insensitive substring match with no empty patterns", () => {
  assert.equal(hostMatches("mail.google.com", ["google"]), true);
  assert.equal(hostMatches("mail.google.com", ["GOOGLE"]), true);
  assert.equal(hostMatches("example.com", ["bank"]), false);
  assert.equal(hostMatches("mybank.com", ["bank"]), true);
  assert.equal(hostMatches("anything.example", []), false);
  assert.equal(hostMatches("anything.example", ["", "  "]), false);
  assert.equal(hostMatches("", ["bank"]), false);
});

test("hostnames are extracted safely", () => {
  assert.equal(hostnameOf("https://mail.google.com/mail"), "mail.google.com");
  assert.equal(hostnameOf("http://localhost:8787/health"), "localhost");
  assert.equal(hostnameOf("not a url"), "");
  assert.equal(hostnameOf(""), "");
});

test("the settings key is a versioned namespace, not a bare word", () => {
  assert.match(SETTINGS_KEY, /^jev:/);
});
