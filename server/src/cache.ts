/**
 * Content-addressed cache for judgments.
 *
 * The docs make the case for this directly: once evidence and question meanings are
 * unchanged, a different threshold or display filter does not justify rerunning
 * inference. The same idea applies more literally here — a page you have already opened,
 * or an element that survived a re-scan, should not be paid for twice.
 *
 * Keyed per candidate rather than per request, because chunk boundaries shift as a page
 * mutates while candidates do not.
 */

import { createHash } from "node:crypto";

export function hashKey(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

/** Insertion-ordered map used as an LRU: re-reading a key moves it to the back. */
export class LruCache<V> {
  readonly #entries = new Map<string, V>();
  readonly #max: number;
  #hits = 0;
  #misses = 0;

  constructor(max = 1000) {
    this.#max = Math.max(1, max);
  }

  get(key: string): V | undefined {
    const value = this.#entries.get(key);
    if (value === undefined) {
      this.#misses += 1;
      return undefined;
    }
    this.#hits += 1;
    this.#entries.delete(key);
    this.#entries.set(key, value);
    return value;
  }

  set(key: string, value: V): void {
    this.#entries.delete(key);
    this.#entries.set(key, value);
    while (this.#entries.size > this.#max) {
      const oldest = this.#entries.keys().next().value;
      if (oldest === undefined) break;
      this.#entries.delete(oldest);
    }
  }

  get size(): number {
    return this.#entries.size;
  }

  get hits(): number {
    return this.#hits;
  }

  get misses(): number {
    return this.#misses;
  }

  clear(): void {
    this.#entries.clear();
    this.#hits = 0;
    this.#misses = 0;
  }
}
