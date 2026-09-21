/**
 * The proxy over a real socket.
 *
 * Most of the interesting logic is tested at the service level, so this stays at the
 * boundary: routes exist, malformed input is rejected with the right status, good input
 * flows through, and a transport error from the model becomes a `502` rather than a
 * connection hang or a misleading success.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";

import { JevService } from "../src/service.ts";
import { createJevServer } from "../src/http.ts";
import { StubJudge } from "../src/stub-judge.ts";
import { FailingJudge } from "./scripted-judge.ts";
import { makeBlocks, makeCandidate } from "./helpers.ts";
import { createJudge } from "../src/model.ts";

interface LiveServer {
  readonly base: string;
  readonly close: () => Promise<void>;
}

async function start(judge: StubJudge | FailingJudge): Promise<LiveServer> {
  const service = new JevService({ judge, judgeReason: "test" });
  const server = createJevServer(service);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}

async function request(base: string, path: string, init?: RequestInit) {
  const response = await fetch(`${base}${path}`, init);
  const body = await response.text();
  let json: unknown = null;
  try {
    json = JSON.parse(body);
  } catch {
    // A fixture returns HTML rather than JSON.
  }
  return { status: response.status, body, json };
}

const stub = await start(new StubJudge());
const failing = await start(new FailingJudge());
test.after(async () => {
  // The default timeout is too short when every suite shares it; close promptly and let any
  // in-flight response drain through the socket it already owns.
  await Promise.all([stub.close(), failing.close()]);
});

test("health reports the mode and the model", async () => {
  const response = await request(stub.base, "/health");
  assert.equal(response.status, 200);
  const json = response.json as { ok: boolean; mode: string; model: string; version: string };
  assert.equal(json.ok, true);
  assert.equal(json.mode, "stub");
  assert.equal(typeof json.model, "string");
  assert.equal(typeof json.version, "string");
});

test("stats reflect accumulated work", async () => {
  const response = await request(stub.base, "/stats");
  assert.equal(response.status, 200);
  const json = response.json as { searches: number; totals: { upstreamRequests: number } };
  assert.equal(typeof json.searches, "number");
  assert.equal(typeof json.totals.upstreamRequests, "number");
});

test("a judged page comes back as JSON with the expected shape", async () => {
  const response = await request(stub.base, "/v1/ads/judge", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      pageUrl: "https://example.test/",
      enabled: ["adslot"],
      candidates: [makeCandidate({ id: "a" })],
    }),
  });

  assert.equal(response.status, 200);
  const json = response.json as {
    verdicts: { id: string; action: string }[];
    usage: { costUsd: number; inputTokens: number; upstreamRequests: number; model: string | null };
    meta: { cached: boolean };
  };
  assert.equal(json.verdicts.length, 1);
  assert.equal(typeof json.usage.costUsd, "number");
  assert.equal(json.meta.cached, false);
  // The popup shows these from every response, so the boundary guarantees them here too.
  assert.ok(json.usage.inputTokens > 0);
  assert.ok(json.usage.upstreamRequests >= 1);
});

test("search comes back ranked with a verdict", async () => {
  const response = await request(stub.base, "/v1/search", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      pageUrl: "https://example.test/",
      query: "whitehouse",
      blocks: makeBlocks(6),
    }),
  });

  assert.equal(response.status, 200);
  const json = response.json as { verdict: string; exists: number; hits: unknown[] };
  assert.ok(["answered", "partial", "absent"].includes(json.verdict));
  assert.ok(Array.isArray(json.hits));
});

test("a fixture is served as HTML, and leaving fixtures is refused", async () => {
  const fixture = await request(stub.base, "/fixtures/ads.html");
  assert.equal(fixture.status, 200);
  assert.match(fixture.body, /data-expect="remove"/);

  const traversal = await request(stub.base, "/fixtures/%2e%2e/server/src/index.ts");
  assert.ok([400, 404].includes(traversal.status), `got ${traversal.status}`);

  const wrongRoute = await request(stub.base, "/no/such/route");
  assert.equal(wrongRoute.status, 404);
});

test("non-JSON and wrong-shaped bodies are rejected, not executed", async () => {
  const notJson = await request(stub.base, "/v1/ads/judge", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "this is not JSON",
  });
  assert.equal(notJson.status, 400);

  const empty = await request(stub.base, "/v1/ads/judge", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "",
  });
  assert.equal(empty.status, 400);

  const notAnObject = await request(stub.base, "/v1/search", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "[1, 2, 3]",
  });
  assert.equal(notAnObject.status, 422);

  const missingBlocks = await request(stub.base, "/v1/search", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: "q" }),
  });
  assert.equal(missingBlocks.status, 422);
});

test("an oversized body is refused before it is read", async () => {
  const big = await request(stub.base, "/v1/search", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      query: "q",
      blocks: [{ id: "b0", text: "x".repeat(5 * 1024 * 1024), words: 1 }],
    }),
  });
  assert.equal(big.status, 413);
});

test("a judge failure on search becomes a 502 the find bar can say out loud", async () => {
  const response = await request(failing.base, "/v1/search", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pageUrl: "p", query: "q", blocks: makeBlocks(2) }),
  });

  assert.equal(response.status, 502);
  assert.equal((response.json as { error: string }).error, "upstream_error");
});

test("a judge failure on ads is reported, not thrown, because the page must be restored", async () => {
  const response = await request(failing.base, "/v1/ads/judge", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      pageUrl: "p",
      enabled: ["overlay"],
      candidates: [makeCandidate({ id: "a" })],
    }),
  });

  // 200, because the request itself is fine — the model is what failed, and the warning
  // plus the keep verdict is how the client learns that.
  assert.equal(response.status, 200);
  const json = response.json as { verdicts: { action: string }[]; meta: { warnings: string[] } };
  assert.equal(json.verdicts[0]?.action, "keep");
  assert.ok(json.meta.warnings.length > 0);
});

test("the judge factory prefers no key over a wrong one and a key over a default", () => {
  assert.equal(createJudge({}).judge.mode, "stub");
  assert.equal(createJudge({ TYPESAFE_API_KEY: "" }).judge.mode, "stub");
  assert.equal(createJudge({ JEV_FAKE: "1", TYPESAFE_API_KEY: "k" }).judge.mode, "stub");
  assert.equal(createJudge({ TYPESAFE_API_KEY: "k" }).judge.mode, "jev");
  assert.match(createJudge({}).reason, /TYPESAFE_API_KEY/);
});
