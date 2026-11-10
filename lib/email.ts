// Bound untrusted input and validate fixed-size components (no repeated regex groups).
export function isValidEmail(email: unknown): email is string {
  if (typeof email !== "string" || email.length < 3 || email.length > 254) return false;
  const at = email.indexOf("@");
  if (at < 1 || at > 64 || at !== email.lastIndexOf("@")) return false;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (/\s/.test(local) || domain.length > 253 || !domain.includes(".")) return false;
  return domain.split(".").every((label) => label.length > 0 && label.length <= 63 && /^[a-z0-9-]+$/i.test(label));
}
