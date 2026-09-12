/**
 * スクリプトの動作と条件を、画面に表示する説明文にする
 */

import {
  SELF_TARGET,
  type ScriptCond,
  type ScriptOp,
  type ScriptStep,
  type SiteDoc,
} from "./types";
import { tr } from "./i18n";

/* ---------- 表示用の文 ---------- */

function targetText(t: string): string {
  return t === SELF_TARGET ? tr("this element") : t ? `#${t}` : tr("(not selected)");
}

/** 「〜が「値」と同じ」などの比較の文 */
function opText(subject: string, op: ScriptOp | undefined, value: string): string {
  const v = tr("\"{value}\"", { value });
  switch (op) {
    case "contains":
      return tr("{subject} contains {v}", { subject, v });
    case "contains-any":
      return tr("{subject} contains any of {v}", { subject, v });
    case "starts-with":
      return tr("{subject} starts with {v}", { subject, v });
    case "ends-with":
      return tr("{subject} ends with {v}", { subject, v });
    case "gt":
      return tr("{subject} is greater than {v}", { subject, v });
    case "gte":
      return tr("{subject} is at least {v}", { subject, v });
    case "lt":
      return tr("{subject} is less than {v}", { subject, v });
    case "lte":
      return tr("{subject} is at most {v}", { subject, v });
    case "empty":
      return tr("{subject} is empty", { subject });
    case "has-key":
      return tr("{subject} has key {v}", { subject, v });
    default:
      return tr("{subject} equals {v}", { subject, v });
  }
}

export function condText(c: ScriptCond): string {
  const t = targetText(c.target);
  const negate = (phrase: string) => c.not ? tr("Not ({phrase})", { phrase }) : phrase;
  switch (c.subject) {
    case "var":
      return negate(opText(tr("\"{value}\"", { value: c.left ?? "" }), c.op, c.value ?? ""));
    case "value":
      return negate(opText(tr("value of {t}", { t }), c.op, c.value ?? ""));
    case "checked":
      return c.not ? tr("{t} is not checked", { t }) : tr("{t} is checked", { t });
    case "visible":
      return c.not ? tr("{t} is hidden", { t }) : tr("{t} is visible", { t });
    case "hovered":
      return c.not ? tr("{t} is not hovered", { t }) : tr("{t} is hovered", { t });
  }
}

export function stepText(st: ScriptStep, doc: SiteDoc): string {
  switch (st.kind) {
    case "show":
      return tr("Show {p1}", { p1: targetText(st.target) });
    case "hide":
      return tr("Hide {p1}", { p1: targetText(st.target) });
    case "toggle":
      return tr("Toggle visibility of {p1}", { p1: targetText(st.target) });
    case "open-page":
      return tr("Open page \"{p1}\"", { p1: doc.pages[st.pageId]?.name ?? tr("not selected") });
    case "open-url":
      return tr("Open {p1}", { p1: st.url || tr("no URL") });
    case "set-state":
      return tr("Set {target} to state {state}", {
        target: targetText(st.target), state: st.state || tr("Default"),
      });
    case "scroll-to":
      return tr("Scroll to {p1}", { p1: targetText(st.target) });
    case "set-value":
      return tr("Set {p1} to \"{value}\"", { p1: targetText(st.target), value: st.value });
    case "set-enabled":
      return st.op === "disable"
        ? tr("Disable {p1}", { p1: targetText(st.target) })
        : st.op === "toggle"
          ? tr("Toggle whether {p1} is enabled", { p1: targetText(st.target) })
          : tr("Enable {p1}", { p1: targetText(st.target) });
    case "list-display": {
      if (st.mode === "clear") return st.no !== undefined
        ? tr("Clear filter {no} on list {p1}", { p1: arrayText(st.array), no: st.no })
        : tr("Clear all filters on list {p1}", { p1: arrayText(st.array) });
      if (st.mode === "sort") return st.dir === "desc"
        ? tr("Sort list {array} by {field}, descending", { array: arrayText(st.array), field: st.field || tr("(no field)") })
        : tr("Sort list {array} by {field}, ascending", { array: arrayText(st.array), field: st.field || tr("(no field)") });
      const conds = [{ field: st.field, op: st.op, value: st.value, not: st.not }, ...(st.or ?? [])]
        .map((c, i) => {
          const detail = opText(c.field || tr("(no field)"), c.op, c.value);
          return `${i ? ("and" in c && c.and ? tr(" and ") : tr(" or ")) : ""}${c.not ? tr("Not ({phrase})", { phrase: detail }) : detail}`;
        })
        .join("");
      const head = `${st.no !== undefined ? tr("Filter {no}: ", { no: st.no }) : ""}${st.join === "or" ? tr("(OR with other filters) ") : ""}`;
      return tr("{head}Filter list {p2} to items where {conds}", { head, p2: arrayText(st.array), conds });
    }
    case "store-save":
      return st.shared
        ? tr("Save \"{value}\" to shared storage key \"{key}\"", { key: st.key || tr("no key"), value: st.value })
        : tr("Save \"{value}\" to storage key \"{key}\"", { key: st.key || tr("no key"), value: st.value });
    case "store-load":
      return st.shared
        ? tr("Load shared storage key \"{key}\" into variable {{into}}", { key: st.key || tr("no key"), into: st.into || "?" })
        : tr("Load storage key \"{key}\" into variable {{into}}", { key: st.key || tr("no key"), into: st.into || "?" });
    case "copy":
      return tr("Copy \"{value}\"", { value: st.value });
    case "set-var":
      return tr("Set variable {{p2}} to \"{value}\"", { value: st.value, p2: st.into || "?" });
    case "set-list-item":
      return tr("Set {value} at key {key} of list {list}", {
        list: arrayText(st.list), key: st.key || tr("End"), value: st.value,
      });
    case "remove-list-item":
      return st.mode === "key"
        ? tr("Remove item at position/key {value} from list {list}", {
          list: arrayText(st.list), value: st.value,
        })
        : tr("Remove items matching {value} from list {list}", {
          list: arrayText(st.list), value: st.value,
        });
    case "break-loop":
      return tr("Break out of loop");
    case "transform":
      return tr("Transform variable {source} and save into {into}", {
        source: st.source || tr("(not selected)"), into: st.into || "?",
      });
    case "repeat":
      return st.times === 0 ? tr("Repeat forever…") : tr("Repeat {times} times…", { times: st.times });
    case "for-each":
      return tr("For each item in list {p1}…", { p1: arrayText(st.array) });
    case "wait":
      return tr("Wait {seconds} seconds", { seconds: st.seconds });
    case "fetch":
      return tr("Fetch data from {p1} as \"{p2}\"", { p1: st.url || tr("no URL"), p2: st.as || "?" });
    case "if": {
      const clauses = [st.cond, ...(st.conditions ?? [])];
      const condition = clauses.map((clause, index) =>
        (index === 0 ? "" : "and" in clause && clause.and ? tr(" and ") : tr(" or ")) +
        condText(clause)).join("");
      return tr("If {p1}…", { p1: condition });
    }
  }
}

function arrayText(name: string): string {
  return name ? tr("［{name}］", { name }) : tr("(not selected)");
}
