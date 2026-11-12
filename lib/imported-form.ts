import type { DocNode } from "./types";
import { safeNavigationUrl } from "./url-policy";
import { archiveFileUrl } from "./zip-references";

type Attributes = Record<string, string>;
const methods = new Set(["get", "post", "dialog"]);
const defaultEncoding = "application/x-www-form-urlencoded";
const encodings = new Set([defaultEncoding, "multipart/form-data", "text/plain"]);
const buttonTypes = new Set(["button", "reset", "submit"]);

function safeAction(action: string): string {
  if (!action.trim()) return "";
  const url = safeNavigationUrl(action);
  return /^(?:mailto|tel):/i.test(url) ? "#" : url;
}

/** index.html が別のルートに移っても、相対的な送信先はサイトを置いたディレクトリから解決する。 */
export function importedFormAction(action: string, url: URL, baseHref: string | null | undefined, slug: string): string {
  if (url.protocol !== "file:") return url.href;
  const path = url.href.slice("file:///".length);
  if (action.startsWith("/") || baseHref?.trim().startsWith("/")) return safeNavigationUrl("/" + path);
  if (new URL(action, archiveFileUrl(slug)).href === url.href) return action;
  const depth = slug.split("/").length - 1;
  return "../".repeat(depth) + "./" + path;
}

/** DOM から読み取った属性も保存済みの属性も、実際のタグで使えるものだけを書き出す。 */
export function submissionAttributes(
  input: Record<string, unknown> | undefined, tag: string, resolveAction?: (action: string) => string, submitInput = false,
): Attributes {
  const out: Attributes = {};
  if (!input || typeof input !== "object" || Array.isArray(input)) return out;
  const read = (key: string) => {
    const value = Object.hasOwn(input, key) ? input[key] : undefined;
    return typeof value === "string" ? value : undefined;
  };
  const form = tag === "form";
  if (!form) {
    if (!["button", "input", "select", "textarea"].includes(tag)) return out;
    const owner = read("form");
    if (owner !== undefined) out.form = owner;
    if (tag !== "button" && !(tag === "input" && submitInput)) return out;
  }
  const prefix = form ? "" : "form";
  const method = read(prefix + "method")?.toLowerCase();
  if (method !== undefined) out[prefix + "method"] = methods.has(method) ? method : "get";
  const action = read(prefix + "action");
  if (action !== undefined) {
    // 空の formaction は所有フォームの action を上書きし、この文書へ送信する。
    const safe = safeAction(action);
    const resolve = resolveAction && safe && (safe !== "#" || action.trim() === "#");
    out[prefix + "action"] = resolve ? safeAction(resolveAction(safe)) : safe;
  }
  const encoding = read(prefix + "enctype")?.toLowerCase();
  if (encoding !== undefined) out[prefix + "enctype"] = encodings.has(encoding) ? encoding : defaultEncoding;
  const target = read(prefix + "target");
  if (target !== undefined) out[prefix + "target"] = target;
  if (read(prefix + "novalidate") !== undefined) out[prefix + "novalidate"] = "";
  if (tag === "button") {
    const type = read("type")?.toLowerCase();
    if (type !== undefined) out.type = buttonTypes.has(type) ? type : "submit";
    for (const key of ["name", "value"]) {
      const value = read(key);
      if (value !== undefined) out[key] = value;
    }
    if (read("disabled") !== undefined) out.disabled = "";
  }
  return out;
}

export function fieldSubmissionAttributes(node: DocNode, resolveAction?: (action: string) => string): Attributes {
  const kind = node.field?.kind;
  const tag = kind === "select" || kind === "textarea" ? kind : "input";
  return submissionAttributes(node.htmlAttrs, tag, resolveAction, kind === "submit");
}

const reactFormProps: Record<string, string> = {
  action: "action", method: "method", form: "form", target: "target", enctype: "encType", novalidate: "noValidate",
  formaction: "formAction", formmethod: "formMethod", formenctype: "formEncType", formtarget: "formTarget",
  formnovalidate: "formNoValidate", type: "type", name: "name", value: "value", disabled: "disabled",
};

export function submissionProps(attrs: Attributes): Record<string, string | boolean> {
  const props: Record<string, string | boolean> = {};
  for (const [key, value] of Object.entries(attrs)) {
    if (!Object.hasOwn(reactFormProps, key) || typeof value !== "string") continue;
    props[reactFormProps[key]] = key === "disabled" || key === "novalidate" || key === "formnovalidate" ? true : value;
  }
  return props;
}
