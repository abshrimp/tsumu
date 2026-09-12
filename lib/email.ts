// 信頼できない入力の長さを制限し、固定長の部分ごとに検証する（繰り返しのある正規表現のグループは使わない）。
export function isValidEmail(email: unknown): email is string {
  if (typeof email !== "string" || email.length < 3 || email.length > 254) return false;
  const at = email.indexOf("@");
  if (at < 1 || at > 64 || at !== email.lastIndexOf("@")) return false;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (/\s/.test(local) || domain.length > 253 || !domain.includes(".")) return false;
  return domain.split(".").every((label) => label.length > 0 && label.length <= 63 && /^[a-z0-9-]+$/i.test(label));
}
