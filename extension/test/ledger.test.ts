/**
 * Unit tests for AdLedger state management, mode toggling (hide vs highlight),
 * and visual badge attachment.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { AdLedger, JEV_AD_ATTRIBUTE } from "../src/content/ledger.ts";

test("ledger marks elements and claims ids", () => {
  const { document } = parseHTML("<div><div id='ad1'>Ad content</div></div>");
  const ledger = new AdLedger();
  const ad1 = document.getElementById("ad1")!;

  assert.equal(ledger.claim("ad1", ad1), true);
  assert.equal(ledger.claim("ad1", ad1), false, "cannot claim the same id twice");
  assert.equal(ledger.has("ad1"), true);

  ledger.mark(ad1, "hide");
  assert.equal(ad1.getAttribute(JEV_AD_ATTRIBUTE), "hide");

  ledger.mark(ad1, null);
  assert.equal(ad1.hasAttribute(JEV_AD_ATTRIBUTE), false);
});

test("ledger attaches, removes and clears inspection badges", () => {
  const { document } = parseHTML("<main><div id='ad1'>Banner</div></main>");
  const ledger = new AdLedger();
  const ad1 = document.getElementById("ad1")!;

  const badge = ledger.attachBadge("ad1", ad1, "🚨 Jev Detected Ad: sponsored (95%)");
  assert.ok(badge);
  assert.equal(badge?.className, "jev-ad-badge");
  assert.equal(badge?.textContent, "🚨 Jev Detected Ad: sponsored (95%)");
  assert.equal(ad1.previousElementSibling, badge);

  ledger.removeBadge("ad1");
  assert.equal(ad1.previousElementSibling, null);
  assert.equal(ledger.badges.size, 0);

  // Re-attach and clearBadges
  ledger.attachBadge("ad1", ad1, "🚨 Jev Detected Ad");
  assert.equal(ledger.badges.size, 1);
  ledger.clearBadges();
  assert.equal(ledger.badges.size, 0);
  assert.equal(ad1.previousElementSibling, null);
});

test("setMode switches between hide and highlight dynamically", () => {
  const { document } = parseHTML("<main><div id='ad1'>Banner 1</div><div id='ad2'>Banner 2</div></main>");
  const ledger = new AdLedger();
  const main = document.querySelector("main")!;
  const ad1 = document.getElementById("ad1")!;
  const ad2 = document.getElementById("ad2")!;

  ledger.claim("ad1", ad1);
  ledger.claim("ad2", ad2);
  ledger.record("ad1", { summary: "div#ad1", category: "sponsored", probability: 0.92, action: "hide", host: "" });
  ledger.record("ad2", { summary: "div#ad2", category: "overlay", probability: 0.88, action: "remove", host: "" });

  // Simulate ad2 being removed from DOM
  const ad2Sibling = ad2.nextSibling;
  ad2.remove();
  ledger.stashRemoval("ad2", { node: ad2, parent: main, nextSibling: ad2Sibling });

  // Initially in hide mode
  ledger.setMode("hide");
  assert.equal(ad1.getAttribute(JEV_AD_ATTRIBUTE), "hide");
  assert.equal(ledger.badges.size, 0);

  // Switch to highlight mode
  ledger.setMode("highlight");
  assert.equal(ad1.getAttribute(JEV_AD_ATTRIBUTE), "highlight");
  assert.equal(ad2.getAttribute(JEV_AD_ATTRIBUTE), "highlight");
  assert.equal(ad2.parentNode, main, "ad2 was re-inserted into main container");
  assert.equal(ledger.badges.size, 2, "two visual badges attached");

  // Switch back to hide mode
  ledger.setMode("hide");
  assert.equal(ad1.getAttribute(JEV_AD_ATTRIBUTE), "hide");
  assert.equal(ad2.getAttribute(JEV_AD_ATTRIBUTE), "hide");
  assert.equal(ledger.badges.size, 0, "badges cleared in hide mode");
});

test("restore clears every hide — including image hides — with one action", () => {
  // Ticket 07: one "Restore Page" undoes every shield change, image hides included.
  // Image hides are plain "hide" marks (hide-at-most, never removed), so restore must
  // clear them alongside iframe hides without needing the removal path.
  const { document } = parseHTML(
    "<main><figure id='fig'><img alt='Sponsored watch'><figcaption>Sponsored</figcaption></figure>" +
      "<div id='slot'>Banner</div></main>",
  );
  const ledger = new AdLedger();
  const fig = document.getElementById("fig")!;
  const slot = document.getElementById("slot")!;

  ledger.claim("img", fig);
  ledger.mark(fig, "hide");
  ledger.record("img", { summary: "figure#fig", category: "sponsored", probability: 0.95, imageHost: "cdn.ads.example.com" });
  ledger.claim("slot", slot);
  ledger.mark(slot, "hide");
  ledger.record("slot", { summary: "div#slot", category: "adslot", probability: 0.97, host: "" });

  const restored = ledger.restore();
  assert.equal(restored, 0, "no nodes were removed, so none are re-inserted");
  assert.equal(fig.hasAttribute(JEV_AD_ATTRIBUTE), false, "the image hide is undone");
  assert.equal(slot.hasAttribute(JEV_AD_ATTRIBUTE), false, "the slot hide is undone");
});

test("restore puts back removed elements and clears attributes and badges", () => {
  const { document } = parseHTML("<main><div id='ad1'>Banner</div></main>");
  const ledger = new AdLedger();
  const main = document.querySelector("main")!;
  const ad1 = document.getElementById("ad1")!;

  ledger.claim("ad1", ad1);
  ledger.record("ad1", { summary: "div#ad1", category: "sponsored", probability: 0.95, host: "" });
  ledger.stashRemoval("ad1", { node: ad1, parent: main, nextSibling: null });
  ad1.remove();

  ledger.setMode("highlight");
  assert.equal(ad1.parentNode, main);
  assert.equal(ledger.badges.size, 1);

  const restored = ledger.restore();
  assert.equal(restored, 1);
  assert.equal(ad1.hasAttribute(JEV_AD_ATTRIBUTE), false);
  assert.equal(ledger.badges.size, 0);
  assert.equal(ledger.events.length, 1, "history persists until reset");

  ledger.reset();
  assert.equal(ledger.events.length, 0);
});

test("image verdicts record their source host for the audit log", () => {
  // Ticket 06: the popup's removal log must show *where* an image ad came from.
  // Host-only by contract — full URLs never reach the ledger.
  const ledger = new AdLedger();
  ledger.record("img", {
    summary: "div#img-ad",
    category: "adslot",
    probability: 0.97,
    imageHost: "ads.doubleclick.net",
  });
  ledger.record("slot", {
    summary: "div#slot",
    category: "adslot",
    probability: 0.9,
    imageHost: "",
  });
  assert.equal(ledger.events[0]?.imageHost, "ads.doubleclick.net");
  assert.equal(ledger.events[1]?.imageHost, "");
});
