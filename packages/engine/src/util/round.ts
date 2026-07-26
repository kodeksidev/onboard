/**
 * @onboard/engine — fixed-precision rounding (Section 8.3: `roundFixed(x, d)`).
 *
 * Used everywhere a floating-point value crosses into the frozen contract
 * (`pageRank`, `importance`, search `score`) so the exact decimal precision
 * the schema documents is guaranteed regardless of accumulated float error.
 */
export function roundFixed(value: number, digits: number): number {
  return Number(value.toFixed(digits));
}
