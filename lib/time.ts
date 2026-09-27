import { getLang, tr } from "./i18n";

/** 「3分前」「昨日」のような、今からの相対時刻 */
export function relativeTime(ms: number): string {
  const diff = (ms - Date.now()) / 1000;
  const rtf = new Intl.RelativeTimeFormat(getLang(), { numeric: "auto" });
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 31536000],
    ["month", 2592000],
    ["week", 604800],
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
  ];
  for (const [unit, sec] of units) {
    if (Math.abs(diff) >= sec) return rtf.format(Math.round(diff / sec), unit);
  }
  return tr("just now");
}

/**
 * 最後に保存した時刻の表示。24時間以内は時刻で、それより前は「昨日」「3日前」のように日付の差で示す。
 * 日付をまたいだ24時間以内の時刻には「昨日」を添え、今日の時刻と区別できるようにする。
 */
export function savedTimeLabel(at: number, now: number, lang: string = getLang()): string {
  const saved = new Date(at);
  const today = new Date(now);
  const days = Math.round(
    (new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime() -
      new Date(saved.getFullYear(), saved.getMonth(), saved.getDate()).getTime()) / 86_400_000,
  );
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: "auto" });
  if (now - at < 86_400_000) {
    if (days <= 0) return saved.toLocaleTimeString(lang);
    return `${rtf.format(-days, "day")} ${saved.toLocaleTimeString(lang, { hour: "2-digit", minute: "2-digit" })}`;
  }
  if (days < 7) return rtf.format(-days, "day");
  if (days < 30) return rtf.format(-Math.floor(days / 7), "week");
  if (days < 365) return rtf.format(-Math.floor(days / 30), "month");
  return rtf.format(-Math.floor(days / 365), "year");
}
