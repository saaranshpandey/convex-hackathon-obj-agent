/**
 * A sanity ceiling, not a business rule — just enough to reject a corrupted or
 * adversarial value (NaN, Infinity, negative, or an absurd magnitude) before it
 * is ever written onto a listing's price.
 */
export const MAX_REASONABLE_AMOUNT = 1_000_000;

export function isValidAmount(value: number | undefined): value is number {
  return (
    value !== undefined &&
    Number.isFinite(value) &&
    value > 0 &&
    value <= MAX_REASONABLE_AMOUNT
  );
}
