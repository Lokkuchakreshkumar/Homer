/**
 * LRU behaviour for the judgment cache.
 *
 * A cache that silently stopped working would look exactly like a working one from the
 * outside — only the bill would change. These tests pin the eviction order and the hit and
 * miss counters that the popup reports.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { LruCache, hashKey } from "../src/cache.ts";

test("a stored value comes back and counts as a hit", () => {
  const cache = new LruCache<string>(3);
  cache.set("a", "first");
  assert.equal(cache.get("a"), "first");
  assert.equal(cache.get("a"), "first");
  assert.equal(cache.hits, 2);
  assert.equal(cache.misses, 0);
});

test("an absent key counts as a miss and returns undefined", () => {
  const cache = new LruCache<string>(3);
  assert.equal(cache.get("nope"), undefined);
  assert.equal(cache.misses, 1);
  assert.equal(cache.hits, 0);
});

test("eviction is least-recently-used, not least-recently-added", () => {
  const cache = new LruCache<string>(2);
  cache.set("a", "1");
  cache.set("b", "2");
  // Reading "a" makes "b" the oldest, so "b" is the one that goes.
  cache.get("a");
  cache.set("c", "3");

  assert.equal(cache.get("b"), undefined);
  assert.equal(cache.get("a"), "1");
  assert.equal(cache.get("c"), "3");
});

test("re-setting a key does not grow the cache", () => {
  const cache = new LruCache<string>(2);
  cache.set("a", "1");
  cache.set("a", "2");
  assert.equal(cache.size, 1);
  assert.equal(cache.get("a"), "2");
});

test("size never exceeds the limit", () => {
  const cache = new LruCache<number>(5);
  for (let index = 0; index < 50; index += 1) cache.set(`k${index}`, index);
  assert.equal(cache.size, 5);
});

test("hashing is stable and distinguishes real differences", () => {
  assert.equal(hashKey({ a: 1, b: [2, 3] }), hashKey({ a: 1, b: [2, 3] }));
  assert.notEqual(hashKey({ a: 1 }), hashKey({ a: 2 }));
  // Key order must not matter for objects built the same way, but a different value must.
  assert.notEqual(hashKey({ enabled: ["overlay"] }), hashKey({ enabled: ["adslot"] }));
});

test("hash keys are safe to use as map keys and stable across calls", () => {
  const key = hashKey({ text: "a\nb\"c\\d" });
  assert.match(key, /^[a-f0-9]{64}$/);
  assert.equal(key, hashKey({ text: "a\nb\"c\\d" }));
});

test("clearing resets both the entries and the counters", () => {
  const cache = new LruCache<string>(2);
  cache.set("a", "1");
  cache.get("a");
  cache.get("b");
  cache.clear();
  assert.equal(cache.size, 0);
  assert.equal(cache.hits, 0);
  assert.equal(cache.misses, 0);
});
