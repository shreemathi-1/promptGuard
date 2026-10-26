/** 0.9123 → "91.2%" */
export function pct(value, digits = 1) {
  return `${(value * 100).toFixed(digits)}%`;
}
