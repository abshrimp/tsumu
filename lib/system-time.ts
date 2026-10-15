/**
 * Read-only built-in variables. Dates use the executing environment's local
 * timezone, while system.iso is UTC. Every reference is evaluated on demand.
 * No system values are saved into the editable document.
 */
export function systemTimeValues(now: Date = new Date()) {
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const day = now.getDate();
  const hour = now.getHours();
  const minute = now.getMinutes();
  const second = now.getSeconds();
  const date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const time = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}`;
  return {
    now: `${date} ${time}`,
    date, time,
    iso: now.toISOString(),
    timestamp: now.getTime(),
    unix: Math.floor(now.getTime() / 1000),
    year, month, day, hour, minute, second,
    weekday: now.getDay(),
  };
}

/** Values that can be used in text and in script blocks, not stored fields. */
export function systemVariable(name: string, at?: Date): unknown {
  if (name !== "system" && !name.startsWith("system.")) return undefined;
  switch (name) {
    case "system.random": return Math.random();
    case "system.randomInt": return Math.floor(Math.random() * 100) + 1;
    case "system.randomBoolean": return Math.random() < 0.5;
    case "system.uuid":
      return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID() : undefined;
    case "system.page.url": return typeof location === "undefined" ? undefined : location.href;
    case "system.page.path": return typeof location === "undefined" ? undefined : location.pathname;
    case "system.page.query": return typeof location === "undefined" ? undefined : location.search.slice(1);
    case "system.page.hash": return typeof location === "undefined" ? undefined : location.hash;
    case "system.page.title": return typeof document === "undefined" ? undefined : document.title;
    case "system.browser.language": return typeof navigator === "undefined" ? undefined : navigator.language;
    case "system.browser.timeZone": return Intl.DateTimeFormat().resolvedOptions().timeZone;
    case "system.browser.online": return typeof navigator === "undefined" ? undefined : navigator.onLine;
    case "system.viewport.width": return typeof window === "undefined" ? undefined : window.innerWidth;
    case "system.viewport.height": return typeof window === "undefined" ? undefined : window.innerHeight;
    case "system.viewport.pixelRatio": return typeof window === "undefined" ? undefined : window.devicePixelRatio;
    case "system.page.scrollX": return typeof window === "undefined" ? undefined : window.scrollX;
    case "system.page.scrollY": return typeof window === "undefined" ? undefined : window.scrollY;
  }
  const values = systemTimeValues(at);
  if (name === "system") return values;
  const key = name.slice("system.".length);
  return Object.prototype.hasOwnProperty.call(values, key)
    ? values[key as keyof typeof values] : undefined;
}

export const SYSTEM_TIME_VARIABLE_NAMES = [
  "system.now", "system.date", "system.time", "system.iso",
  "system.timestamp", "system.unix",
  "system.year", "system.month", "system.day",
  "system.hour", "system.minute", "system.second", "system.weekday",
] as const;

export const SYSTEM_BROWSER_VARIABLE_NAMES = [
  "system.page.url", "system.page.path", "system.page.query",
  "system.page.hash", "system.page.title", "system.page.scrollX", "system.page.scrollY",
  "system.browser.language", "system.browser.timeZone", "system.browser.online",
  "system.viewport.width", "system.viewport.height", "system.viewport.pixelRatio",
] as const;

export const SYSTEM_RANDOM_VARIABLE_NAMES = [
  "system.random", "system.randomInt", "system.randomBoolean", "system.uuid",
] as const;
