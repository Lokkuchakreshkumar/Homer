/**
 * HTTP surface for the proxy.
 *
 * Bound to loopback by the entrypoint. CORS headers are reflected rather than restricted
 * because the server is not reachable off-host; that lets the fixture pages and the
 * extension both call it without a second code path.
 */

import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { HealthResponse, JudgeAdsRequest, SearchRequest } from "../shared/wire.ts";
import type { AdCandidate, AdCategory, ImageKind } from "../shared/wire.ts";
import { AD_CATEGORIES, AD_IMAGE_ALT_CHARS, AD_IMAGE_HOST_CHARS, isImageKind } from "../shared/wire.ts";
import { UpstreamError, describeError } from "./service.ts";
import type { JevService } from "./service.ts";
import { AD_TEXT_SNIPPET_CHARS } from "./ads.ts";

export const VERSION = "0.1.0";

import { existsSync } from "node:fs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = existsSync(resolve(HERE, "../fixtures"))
  ? resolve(HERE, "../fixtures")
  : resolve(HERE, "../../fixtures");

/** Generous: the extension sends summaries, not page dumps. */
const MAX_BODY_BYTES = 4 * 1024 * 1024;

export class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

function statusOf(cause: unknown): number {
  if (cause instanceof HttpError) return cause.status;
  if (cause instanceof UpstreamError) return cause.status;
  const status = (cause as { status?: unknown } | null)?.status;
  if (typeof status === "number" && status >= 400 && status < 600) return status;
  return 500;
}

function applyCors(res: ServerResponse, origin: string | undefined): void {
  res.setHeader("Access-Control-Allow-Origin", origin ?? "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  res.setHeader("Access-Control-Max-Age", "600");
  res.setHeader("Vary", "Origin");
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

async function readJson<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, "request body is too large");
    chunks.push(buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (text.trim() === "") throw new HttpError(400, "request body is empty");
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new HttpError(400, "request body is not valid JSON");
  }
}

function requireObject(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new HttpError(422, `\`${field}\` must be an object`);
  }
  return value as Record<string, unknown>;
}

function requireArray(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) throw new HttpError(422, `\`${field}\` must be an array`);
  return value;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function asImageKind(value: unknown): ImageKind {
  return isImageKind(value) ? value : "none";
}

/**
 * Rebuild each candidate from known fields.
 *
 * The client is trusted to be ours, but not to be correct: a missing numeric field would
 * otherwise reach the comparison in `verdictFor` as `undefined` and silently take the
 * permissive branch. Filling defaults here means policy always sees complete objects.
 */
function normalizeCandidate(raw: unknown, index: number): AdCandidate {
  const item = requireObject(raw, `candidates[${index}]`);
  const id = asString(item["id"]);
  if (id === "") {
    throw new HttpError(422, `\`candidates[${index}].id\` must be a non-empty string`);
  }
  return {
    id,
    tag: asString(item["tag"]).toLowerCase(),
    idAttr: asString(item["idAttr"]),
    classes: asStringArray(item["classes"]),
    role: asString(item["role"]),
    ariaLabel: asString(item["ariaLabel"]),
    isIframe: asBoolean(item["isIframe"]),
    iframeSrc: asString(item["iframeSrc"]),
    width: asNumber(item["width"]),
    height: asNumber(item["height"]),
    viewportRatio: asNumber(item["viewportRatio"]),
    position: asString(item["position"]),
    zIndex: asNumber(item["zIndex"]),
    textLength: asNumber(item["textLength"]),
    linkDensity: asNumber(item["linkDensity"]),
    inMainContent: asBoolean(item["inMainContent"]),
    // Truncated again here, so a modified client still cannot send page text.
    text: asString(item["text"]).slice(0, AD_TEXT_SNIPPET_CHARS),
    imageKind: asImageKind(item["imageKind"]),
    // Host-only and truncated again here: a modified client still cannot smuggle a
    // full image URL or tracking string past the proxy.
    imageHost: asString(item["imageHost"]).trim().toLowerCase().slice(0, AD_IMAGE_HOST_CHARS),
    imageAlt: asString(item["imageAlt"]).slice(0, AD_IMAGE_ALT_CHARS),
    inFigure: asBoolean(item["inFigure"]),
    reasons: asStringArray(item["reasons"]),
  };
}

function parseJudgeAds(body: unknown): JudgeAdsRequest {
  const root = requireObject(body, "body");
  return {
    pageUrl: asString(root["pageUrl"]),
    enabled: asStringArray(root["enabled"]).filter((category): category is AdCategory =>
      (AD_CATEGORIES as readonly string[]).includes(category),
    ),
    candidates: requireArray(root["candidates"], "candidates").map(normalizeCandidate),
  };
}

function parseSearch(body: unknown): SearchRequest {
  const root = requireObject(body, "body");
  const blocks = requireArray(root["blocks"], "blocks").map((raw, index) => {
    const item = requireObject(raw, `blocks[${index}]`);
    const id = asString(item["id"]);
    if (id === "") {
      throw new HttpError(422, `\`blocks[${index}].id\` must be a non-empty string`);
    }
    const text = asString(item["text"]);
    const words = item["words"];
    return {
      id,
      text,
      words: typeof words === "number" && Number.isFinite(words)
        ? words
        : text.split(/\s+/).filter((word) => word !== "").length,
    };
  });
  return { pageUrl: asString(root["pageUrl"]), query: asString(root["query"]), blocks };
}

/** Flat names only, so the pattern itself rules out traversal. */
const FIXTURE_NAME = /^[a-z0-9_-]+\.(?:html|css|js)$/i;

const FIXTURE_TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
};

async function serveFixture(res: ServerResponse, pathname: string): Promise<void> {
  const name = pathname.slice("/fixtures/".length);
  if (!FIXTURE_NAME.test(name)) throw new HttpError(404, `no such fixture: ${name}`);
  let body: Buffer;
  try {
    body = await readFile(join(FIXTURES_DIR, name));
  } catch {
    throw new HttpError(404, `no such fixture: ${name}`);
  }
  res.writeHead(200, {
    "content-type": FIXTURE_TYPES[name.split(".").pop() ?? ""] ?? "application/octet-stream",
    "content-length": body.length,
  });
  res.end(body);
}

async function handle(
  service: JevService,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  applyCors(res, req.headers.origin);

  if (req.method === "OPTIONS") {
    res.writeHead(204).end();
    return;
  }

  try {
    if (req.method === "GET" && url.pathname === "/health") {
      const health: HealthResponse = {
        ok: true,
        mode: service.judge.mode,
        model: service.judge.model,
        version: VERSION,
      };
      sendJson(res, 200, { ...health, judgeReason: service.judgeReason });
      return;
    }

    if (req.method === "GET" && url.pathname === "/stats") {
      sendJson(res, 200, service.stats());
      return;
    }

    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/dashboard")) {
      await serveFixture(res, "/fixtures/index.html");
      return;
    }

    if (req.method === "GET" && url.pathname.startsWith("/fixtures/")) {
      await serveFixture(res, url.pathname);
      return;
    }

    if (req.method === "POST" && url.pathname === "/v1/ads/judge") {
      sendJson(res, 200, await service.judgeAds(parseJudgeAds(await readJson(req))));
      return;
    }

    if (req.method === "POST" && url.pathname === "/v1/search") {
      sendJson(res, 200, await service.semanticFind(parseSearch(await readJson(req))));
      return;
    }

    sendJson(res, 404, { error: "not_found", message: `no route for ${req.method} ${url.pathname}` });
  } catch (cause) {
    const status = statusOf(cause);
    if (status >= 500) {
      console.error(`[jev-proxy] ${req.method} ${url.pathname} failed:`, cause);
    }
    sendJson(res, status, {
      error: status >= 500 ? "upstream_error" : "invalid_request",
      message: describeError(cause),
    });
  }
}

export function createJevServer(service: JevService): Server {
  return createServer((req, res) => {
    void handle(service, req, res);
  });
}
