import assert from "node:assert/strict";
import { test } from "node:test";
import { commentTargetResolver, isDeletedCommentTarget } from "../lib/comment-targets";
import { applyCommentAction } from "../lib/comments";
import { useComments } from "../lib/comment-store";
import { useEditor } from "../lib/store";
import { commentTargetDoc } from "./helpers/comment-targets";

const anchor = { pageId: "p", nodeId: "target" };
const state = () => useEditor.getState();
function setup() {
  state().replaceDoc(commentTargetDoc()); state().setActivePage("p");
  const threads = applyCommentAction([], { action: "create", id: "thread", ...anchor, x: .5, y: .5, bp: "base", body: "Keep this discussion" }, null, 1);
  useComments.setState({ threads, active: true, openId: "thread", draft: null, store: "local", error: null, loading: false, showResolved: false });
  return threads;
}

test("element and subtree deletion retain comments, and undo/redo reconnect exact ids", () => {
  const before = setup();
  state().deleteNode("parent");
  assert.equal(commentTargetResolver(state().doc, "base")(anchor).kind, "deleted-node");
  assert.deepEqual(useComments.getState().threads, before);
  state().undo();
  assert.equal(commentTargetResolver(state().doc, "base")(anchor).kind, "node");
  state().redo();
  assert.equal(commentTargetResolver(state().doc, "base")(anchor).kind, "deleted-node");
  assert.deepEqual(useComments.getState().threads, before);
});

test("deleted page retains its open thread after the active page changes", () => {
  setup(); state().deletePage("p");
  assert.equal(state().activePageId, "q");
  assert.equal(commentTargetResolver(state().doc, "base")(anchor).kind, "deleted-page");
  assert.equal(useComments.getState().openId, "thread");
  state().undo();
  assert.equal(commentTargetResolver(state().doc, "base")(anchor).kind, "node");
});

test("responsive and ancestor-hidden targets are present, not deleted", () => {
  const doc = commentTargetDoc(); doc.nodes.parent.hiddenOn = ["sm"];
  assert.deepEqual(commentTargetResolver(doc, "sm")(anchor), { kind: "node", pageId: "p", hidden: true });
  assert.equal(commentTargetResolver(doc, "base")(anchor).hidden, false);
  doc.nodes.parent.hiddenOn = []; doc.nodes.target.styles.sm = { default: { display: "none" } };
  assert.equal(commentTargetResolver(doc, "sm")(anchor).hidden, true);
  assert.equal(isDeletedCommentTarget(commentTargetResolver(doc, "sm")(anchor)), false);
});

test("an existing unrendered node is not deleted, and a moved node follows its current page", () => {
  const doc = commentTargetDoc(); doc.nodes.parent.children = [];
  assert.equal(commentTargetResolver(doc, "base")(anchor).kind, "node");
  doc.pages.q.children.push("target"); delete doc.pages.p;
  assert.deepEqual(commentTargetResolver(doc, "base")(anchor), { kind: "node", pageId: "q", hidden: false });
});

test("page comments distinguish present and deleted pages without a node id", () => {
  const doc = commentTargetDoc(); const thread = { pageId: "p", nodeId: null };
  assert.equal(commentTargetResolver(doc, "base")(thread).kind, "page");
  delete doc.pages.p;
  assert.equal(commentTargetResolver(doc, "base")(thread).kind, "deleted-page");
});

test("remote deletion and unrelated undo do not resurrect a target or change its discussion", () => {
  const before = setup(); state().updateNode("target", { name: "Local edit" });
  const remote = structuredClone(state().doc); delete remote.nodes.target; remote.nodes.parent.children = [];
  state().applyRemoteDoc(remote); state().undo();
  assert.equal(state().doc.nodes.target, undefined);
  assert.deepEqual(useComments.getState().threads, before);
  assert.equal(useComments.getState().openId, "thread");
});

test("new comment draft retains its original target after the page disappears", () => {
  setup(); useComments.getState().setDraft({ ...anchor, x: .5, y: .5, bp: "base" });
  state().deletePage("p");
  assert.deepEqual(useComments.getState().draft, { ...anchor, x: .5, y: .5, bp: "base" });
});
