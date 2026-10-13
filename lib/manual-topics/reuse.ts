import type { Topic } from "../manual";
import { tr } from "../i18n";

export const reuseTopics: Topic[] = [  /* ================= 部品の使い回し ================= */
  {
    id: "reuse-component",
    cat: "reuse",
    level: 2,
    q: tr("How do I reuse a header or footer on every page (components)?"),
    a: tr("Right-click the header box and choose \"Create component\". You can place it on other pages from the component list in the Add tab. **Edit it once and every page updates**."),
    keys: [tr("Components"), tr("shared"), tr("reuse"), tr("Header"), tr("Footer"), tr("element"), tr("instance")],
    ctx: ["box", "instance", "component"],
    body: [
      { fig: "component-sync" },
      { p: tr("Double-click a placed copy (instance) to edit the original (main component). Click Done at the top when finished.") },
      { rule: tr("Once you've built the same thing twice, consider making it a component. With copies, you have to hunt down every one when something needs to change."), title: tr("Make it a component the second time") },
      { warn: tr("Deleting a component removes every copy placed on pages.") },
    ],
    guide: [
      { target: "settings-make", text: tr("Select the box to reuse and click \"Create component\"."), needs: "container", prepare: { right: "settings" } },
      { target: "add-components", text: tr("Your components are at the bottom of the Add tab. Click one to place it at the insert target."), prepare: { left: "add" } },
    ],
    see: ["reuse-detach", "d-consistency"],
  },
  {
    id: "reuse-detach",
    cat: "reuse",
    level: 3,
    q: tr("How do I make one copy of a component different?"),
    a: tr("Select that instance and click \"Detach instance\" in the right panel. It becomes a regular element you can edit independently."),
    keys: [tr("detach instance"), tr("unlink"), tr("detach"), tr("just one")],
    ctx: ["instance"],
    body: [
      { p: tr("Detached elements no longer change when the main component is edited.") },
      { note: tr("Small differences (like highlighting the current page's menu item) can sometimes be done with scripts or visibility instead of detaching.") },
    ],
    guide: [{ target: "settings-component", text: tr("Click \"Detach instance\".") }],
    see: ["reuse-component"],
  },


];
