import { createInitialDoc, makeBox, makeText } from "../../lib/presets";

export function commentTargetDoc() {
  const doc = createInitialDoc();
  doc.nodes = {
    parent: { ...makeBox(), id: "parent", name: "Comment parent", children: ["target"], styles: { base: { default: { width: "400px", height: "200px" } } } },
    target: { ...makeText("Comment target"), id: "target", name: "Comment target" },
    other: { ...makeText("Other page"), id: "other", name: "Other page" },
  };
  doc.pages = {
    p: { id: "p", name: "First page", slug: "", title: "First", description: "", children: ["parent"] },
    q: { id: "q", name: "Second page", slug: "second", title: "Second", description: "", children: ["other"] },
  };
  doc.pageOrder = ["p", "q"];
  doc.components = {};
  return doc;
}
