/** Find a useful z-index relative to sibling layers without modifying any other node. */
export type StackAction = "front" | "forward" | "backward" | "back";
const LIMIT = 2147483647;
function level(raw: string | undefined): number {
  if (!raw || !/^-?\d+$/.test(raw.trim())) return 0;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? Math.max(-LIMIT, Math.min(LIMIT, value)) : 0;
}
export function nextStackLevel(
  raw: string | undefined,
  others: readonly (string | undefined)[],
  action: StackAction,
): number | null {
  if (!others.length) return null;
  const current = level(raw);
  const peers = others.map(level);
  const up = peers.filter(value => value >= current);
  const down = peers.filter(value => value <= current);
  if ((action === "front" || action === "forward") && current > Math.max(...peers)) return null;
  if ((action === "back" || action === "backward") && current < Math.min(...peers)) return null;
  let next: number | null = null;
  if (action === "front") next = Math.max(...peers) + 1;
  else if (action === "back") next = Math.min(...peers) - 1;
  else if (action === "forward" && up.length) next = Math.min(...up) + 1;
  else if (action === "backward" && down.length) next = Math.max(...down) - 1;
  if (next === null || next === current || next > LIMIT || next < -LIMIT) return null;
  return next;
}
