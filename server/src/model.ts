/**
 * Judge selection.
 *
 * The proxy is the only place a key ever exists. It binds to loopback, and the extension
 * reaches it over localhost, so the credential stays out of the browser bundle and out of
 * the user's reach — which is what the SDK's `dangerouslyAllowBrowser` flag is warning
 * against.
 */

import type { Judge } from "./judge.ts";
import { TypeSafeJudge } from "./judge.ts";
import { StubJudge } from "./stub-judge.ts";

export interface JudgeChoice {
  readonly judge: Judge;
  /** Why the stub was chosen, so the popup can say so instead of silently going offline. */
  readonly reason: string;
}

export function createJudge(env: NodeJS.ProcessEnv = process.env): JudgeChoice {
  const requestedStub = env["JEV_FAKE"] === "1";
  const apiKey = (env["TYPESAFE_API_KEY"] ?? "").trim();

  if (requestedStub) {
    return { judge: new StubJudge(), reason: "JEV_FAKE=1 is set" };
  }
  if (apiKey === "") {
    return {
      judge: new StubJudge(),
      reason: "TYPESAFE_API_KEY is not set, so no requests can be made",
    };
  }
  return { judge: new TypeSafeJudge(apiKey), reason: "TYPESAFE_API_KEY is set" };
}
