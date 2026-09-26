import { content } from "../data/content.ts";
import type { DemoFixtureDefinition, DemoFixtureKey, DemoQueryDefinition, DemoQueryKey } from "../data/content.ts";

export type { DemoFixtureDefinition, DemoFixtureKey, DemoPassage, DemoQueryDefinition, DemoQueryKey } from "../data/content.ts";

export type DemoMode = "idle" | "answered" | "context" | "absent" | "replay" | "reset";
export type DemoView = "none" | "answer" | "context" | "absent";

export interface DemoState {
  readonly mode: DemoMode;
  readonly queryKey: DemoQueryKey | null;
  readonly queryText: string;
  readonly view: DemoView;
  readonly queryError: string | null;
}

export type DemoAction =
  | { readonly type: "ask"; readonly key: DemoQueryKey; readonly text?: string }
  | { readonly type: "edit"; readonly text: string }
  | { readonly type: "invalid"; readonly text: string }
  | { readonly type: "unsupported"; readonly text: string }
  | { readonly type: "idle" }
  | { readonly type: "context" }
  | { readonly type: "replay" }
  | { readonly type: "reset" };

export const demoQueries: readonly DemoQueryDefinition[] = content.demo.queries;
export const demoFixtures: readonly DemoFixtureDefinition[] = content.demo.fixtures;

export function initialDemoState(): DemoState {
  return {
    mode: "idle",
    queryKey: null,
    queryText: "",
    view: "none",
    queryError: null,
  };
}

export function queryDefinition(key: DemoQueryKey): DemoQueryDefinition {
  const query = demoQueries.find((candidate) => candidate.key === key);
  if (!query) {
    throw new Error(`Unknown demo query: ${key}`);
  }
  return query;
}

export function fixtureDefinition(key: DemoFixtureKey): DemoFixtureDefinition {
  const fixture = demoFixtures.find((candidate) => candidate.key === key);
  if (!fixture) {
    throw new Error(`Unknown demo fixture: ${key}`);
  }
  return fixture;
}

export function inferDemoQuery(value: string): DemoQueryKey | null {
  const normalized = value.trim().replace(/\s+/g, " ").toLowerCase();
  if (!normalized) {
    return null;
  }
  const query = demoQueries.find((candidate) => candidate.text.trim().replace(/\s+/g, " ").toLowerCase() === normalized);
  return query?.key ?? null;
}

function isFixtureKey(key: DemoQueryKey | null): key is DemoFixtureKey {
  return key === "terrain" || key === "samples";
}

function ask(state: DemoState, key: DemoQueryKey, text?: string): DemoState {
  const definition = queryDefinition(key);
  const trimmed = text?.trim() ?? "";
  if (text !== undefined && !trimmed) {
    return invalid(text);
  }
  return {
    ...state,
    mode: key === "absent" ? "absent" : "answered",
    queryKey: key,
    queryText: trimmed || definition.text,
    view: key === "absent" ? "absent" : "answer",
    queryError: null,
  };
}

function edit(text: string): DemoState {
  return {
    ...initialDemoState(),
    queryText: text,
  };
}

function invalid(text: string): DemoState {
  return {
    ...initialDemoState(),
    queryText: text,
    queryError: content.demo.validation.emptyQuery,
  };
}

function unsupported(text: string): DemoState {
  return {
    ...initialDemoState(),
    queryText: text,
    queryError: content.demo.validation.unsupportedQuery,
  };
}

function idle(): DemoState {
  return {
    ...initialDemoState(),
  };
}

function context(state: DemoState): DemoState {
  if (!canShowContext(state) || !isFixtureKey(state.queryKey)) {
    return state;
  }
  return {
    ...state,
    mode: "context",
    view: "context",
  };
}

function replay(state: DemoState): DemoState {
  if (!isAnsweredState(state)) {
    return state;
  }
  return {
    ...state,
    mode: "replay",
  };
}

function reset(): DemoState {
  return {
    ...initialDemoState(),
    mode: "reset",
  };
}

export function transitionDemoState(state: DemoState, action: DemoAction): DemoState {
  switch (action.type) {
    case "ask":
      return ask(state, action.key, action.text);
    case "edit":
      return edit(action.text);
    case "invalid":
      return invalid(action.text);
    case "unsupported":
      return unsupported(action.text);
    case "idle":
      return idle();
    case "context":
      return context(state);
    case "replay":
      return replay(state);
    case "reset":
      return reset();
  }
}

export function statusForDemoState(state: DemoState): string {
  if (state.queryError) {
    return state.queryError === content.demo.validation.unsupportedQuery
      ? content.demo.status.unsupported
      : content.demo.status.validation;
  }
  if (state.mode === "idle") {
    return content.demo.status.idle;
  }
  if (state.mode === "reset") {
    return content.demo.status.reset;
  }
  if (state.view === "absent") {
    return state.mode === "replay" ? content.demo.status.replayAbsent : content.demo.status.absent;
  }
  const definition = state.queryKey ? queryDefinition(state.queryKey) : null;
  const fixture = definition?.fixture ? fixtureDefinition(definition.fixture) : null;
  const passage = fixture ? ` ${fixture.passageNumber}` : "";
  if (state.mode === "context") {
    return `${content.demo.status.context}${passage}${content.demo.status.relatedPassage}`;
  }
  if (state.mode === "replay") {
    return `${state.view === "context" ? content.demo.status.replayContext : content.demo.status.replayAnswer}${passage}`;
  }
  return `${content.demo.status.answered}${passage}`;
}

export function visibleFixture(state: DemoState): DemoFixtureKey | null {
  if (state.view === "answer" || state.view === "context") {
    return isFixtureKey(state.queryKey) ? state.queryKey : null;
  }
  return null;
}

export function showsContext(state: DemoState): boolean {
  return state.view === "context";
}

export function isAnsweredState(state: DemoState): boolean {
  return state.view === "answer" || state.view === "context";
}

export function canShowContext(state: DemoState): boolean {
  return isAnsweredState(state) && state.view !== "context";
}

export function canReplay(state: DemoState): boolean {
  return isAnsweredState(state);
}
