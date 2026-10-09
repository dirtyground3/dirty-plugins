/** Untrusted JSON from Stash and plugin operations is narrowed at this boundary. */
export function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return value; }
}
export function asObject(value: unknown): Record<string, unknown> {
  const parsed = parseMaybeJson(value);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed as Record<string, unknown> : {};
}
export function pluginResult(value: unknown): unknown {
  const result = parseMaybeJson(value);
  if (result && typeof result === "object") {
    const record = result as Record<string, unknown>;
    if (record.error) throw new Error(String(record.error));
    if (Object.prototype.hasOwnProperty.call(record, "output")) return parseMaybeJson(record.output);
  }
  return result;
}
export function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
  const next = Number(value);
  if (!Number.isFinite(next)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(next)));
}
export function coerceBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  return fallback;
}
/** Append an optional caller class to a component's own classes. */
export function withClass(base: string, extra?: string) {
  return extra ? base + " " + extra : base;
}
