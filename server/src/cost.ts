/**
 * Cost accounting.
 *
 * From the models page: Jev 1.13 is charged at $42 per billion input tokens, which is
 * $0.042 per million, and output tokens are free. Kept in one place so the popup's cost
 * figure and any future budget guard agree.
 */

/** USD per million input tokens. Output tokens are not billed. */
export const USD_PER_MTOK_INPUT = 0.042;

export function costOf(inputTokens: number, _outputTokens: number): number {
  return (inputTokens / 1_000_000) * USD_PER_MTOK_INPUT;
}

/** Format a cost for the popup. Micro-spend needs more decimals than a dollar figure. */
export function formatCost(usd: number): string {
  if (usd === 0) return "$0.00";
  if (usd < 0.01) return `$${usd.toFixed(5)}`;
  return `$${usd.toFixed(2)}`;
}
