/**
 * Money, formatted the way a developer expects to see micro-spend: nothing for nothing,
 * five decimals while it is fractions of a cent, two once it is real money.
 */
export function formatCost(usd: number): string {
  if (!Number.isFinite(usd) || usd <= 0) return "$0.00";
  if (usd < 0.01) return `$${usd.toFixed(5)}`;
  return `$${usd.toFixed(2)}`;
}
