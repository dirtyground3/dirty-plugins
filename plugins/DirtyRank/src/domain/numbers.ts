export function number(value: unknown, fallback: number, minimum: number, maximum: number) {
  const result = Number(value);
  return Number.isFinite(result) ? Math.min(maximum, Math.max(minimum, result)) : fallback;
}
export function integer(value: unknown, fallback: number, minimum: number, maximum: number) {
  return Math.floor(number(value, fallback, minimum, maximum));
}
