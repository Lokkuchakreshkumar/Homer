export interface LiveSearchInput {
  readonly pageUrl: string;
  readonly query: string;
  readonly blocks: readonly { readonly id: string; readonly text: string }[];
}

export interface LiveSearchResult {
  readonly answerId: string | null;
  readonly contextIds: readonly string[];
}

export interface LiveSearchAdapter {
  search(input: LiveSearchInput): Promise<LiveSearchResult>;
}

export const liveSearchBoundary = {
  mode: "local-only",
  input: "checked-in sample content",
  implementation: "no request path is included",
} as const;
