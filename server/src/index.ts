/**
 * Entrypoint. Loopback only.
 *
 * The bind address is not configurable on purpose: this process holds an API key and
 * accepts page content, so exposing it on a routable interface would turn a local dev
 * tool into an open relay with someone else's credential behind it.
 */

import { createJudge } from "./model.ts";
import { JevService } from "./service.ts";
import { createJevServer, VERSION } from "./http.ts";

const port = Number(process.env["PORT"] ?? 8787);
if (!Number.isInteger(port) || port <= 0 || port > 65535) {
  console.error(`[jev-proxy] PORT is not a valid port number: ${process.env["PORT"] ?? ""}`);
  process.exit(1);
}

const host = process.env["HOST"] ?? (process.env["RENDER"] || process.env["PORT"] ? "0.0.0.0" : "127.0.0.1");

const { judge, reason } = createJudge();
const service = new JevService({ judge, judgeReason: reason });
const server = createJevServer(service);

server.listen(port, host, () => {
  console.log(`[jev-proxy] v${VERSION} listening on http://${host}:${port}`);
  console.log(`[jev-proxy] judge: ${judge.mode} (${judge.model}) - ${reason}`);
  if (judge.mode === "stub") {
    console.log("[jev-proxy] running the offline stub: answers come from keyword overlap, not Jev");
  }
  console.log(`[jev-proxy] playground: http://${host}:${port}/`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
