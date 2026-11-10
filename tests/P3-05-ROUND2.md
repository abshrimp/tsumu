# P3-05 — round 2 architecture audit

## Scope and baseline

- Assignment: Phase 3 / P2, AI-generated edit validation and coherent single-step Undo.
- No `tasks.json` or applicable `AGENTS.md` was present in this checkout; the supplied P3-05 assignment defines this investigation.
- Checkout HEAD and its local `origin/main`: `d6f17ae54ae41aafb80ba5a969cbac35b73447f2`.
- Remote main verified through the GitHub connector: `ced4645fdf248c00a1617b1fcf794e0a90ca7d20` (2026-11-10). Git fetch cannot write the shared Git metadata in this sandbox; direct GitHub DNS also failed.
- Reconstructed that remote revision in `/tmp/tsumu-p3-05-main` from the checkout's Git archive and GitHub's comparison patches. All 11 changed files matched the remote Git blob SHA. The AI/chat/store source was unchanged between these revisions. Both the failing regression and successful checks below ran against this reconstructed main.
- Checked open PRs and neighboring worktree diffs for overlap. No competing AI/chat/history change was found. Existing gesture isolation, AI clone identity, and ref validation fixes are retained, not resubmitted.

## Entry points and contracts traced

| Boundary | Actual flow and invariant |
| --- | --- |
| UI → request | `components/AiChat.tsx`: suggestions/form submission call `ask`; `busy` prevents parallel requests. It captures the editor snapshot and calls `buildAiContext`, then awaits fetch and NDJSON completion. Stop aborts the request. |
| Context projection | `lib/aiOps.ts`: `buildAiContext` deep-copies the target page/component subtree. Other pages retain metadata but omit children/scripts. Comparing this projection cannot identify a document session or history branch. |
| API → AI operations | `app/api/ai/route.ts` → `parseAiRequest` → `runAi` → `applyAiOps`. The server validates on a partial working document and returns normalized, successful operations, with request-wide limits and stable IDs. It does not commit editor history. |
| Stream → replay | `readAiResponse` requires a complete result. `ask` waits for active gestures, then calls `updateDoc(d => applyAiEdits(...))` once. The client checks the current projection and validates all operation chunks on a draft before publishing. |
| Store → Undo/Redo | `updateDoc` and `commitDoc` publish the document and its checkpoint together. A new edit clears `future`. `undo`, `redo`, `replaceDoc`, `restoreDoc`, and `resetDoc` advance `historyRevision`; ordinary edits and remote rebases do not. |
| Adjacent lifecycle callers | `Editor.tsx` replaces documents during hydration/cloud reconciliation and conflict resolution. `SitePanel.tsx` and `PublishModal.tsx` restore documents. Remote edits use `applyRemoteDoc` and rebase snapshots. Header/editor keyboard handlers invoke store Undo/Redo. |
| UI → Undo | The chat offers Undo only while its `appliedDoc` is the current document reference. A rejected request must not receive that reference or consume any Undo/Redo entries. |
| Documentation | `ARCHITECTURE.md` (AI edits) and `README.md` (Ask AI) promise validated edits applied as one undoable change and rejection of conflicting work. |

## Hypotheses and evidence

| Hypothesis | Result |
| --- | --- |
| History movement or document replacement during network wait escapes the revision guard | **Confirmed, new P2 issue.** Five added regression cases fail on remote main. |
| An active manual gesture gets combined with the AI's Undo | Existing merged protection remains effective: real chat/store tests cover multiple gesture owners, cancellation, target edits, and Undo while waiting. No new failure reproduced. |
| A later invalid operation/chunk partially commits earlier edits or consumes Redo | Existing atomic replay tests pass, including a later chunk with invalid identities and preservation of document/history references. |
| Server/client replay disagrees on clone IDs, aliases, component scope, or hidden identities | Existing identity/clone tests pass, including cross-call/chunk replay and collisions in nodes omitted from the AI context. No new failure reproduced. |
| Interrupted/truncated responses reach replay | Stream/provider tests pass for abort, incomplete streams, malformed data, and tool repair failures. |

## Confirmed issue: stale AI response crosses a history boundary

Priority: **P2**. Target: `components/AiChat.tsx`, request-to-replay lifecycle.

Reproduction:

1. Have pages P and Q. Make an ordinary edit to a node on Q, creating an Undo entry.
2. On P, start an AI request and hold its response pending.
3. Undo the Q edit while the request is pending. P and its AI context are unchanged; the Q edit is now in Redo.
4. Complete the AI response with a valid `set_text` operation on P.
5. Before the fix, the AI edit is committed and the store clears Redo, losing the user's ability to redo the Q edit.

The same missing lifecycle check allows replay after Redo, an Undo→Redo cycle, replacement with equal content, or restoration that only changes an omitted page subtree. The tests explicitly prove the projected context remains equal across every interruption.

Root cause: `ask` captured `beforeWaitRevision` only **after** `readAiResponse` completed. Its existing revision checks protected the subsequent gesture wait, leaving the fetch/stream interval unprotected. Content equality in `applyAiEdits` cannot substitute for history/session identity.

Minimal fix: before waiting for gestures or replaying nonempty operations, compare the current `historyRevision` with the editor snapshot captured when `ask` started. A mismatch uses the existing conflict/error path. No store, schema, ID, saved data, authentication, or provider contract changes are needed. Ordinary unrelated edits still apply with independent Undo; the existing post-response gesture protections remain intact.

Regression/acceptance evidence: all five interruptions preserve the exact document, `past`, and `future` references; no AI Undo is offered; `busy` clears. The Undo case exercises the preserved Redo. Every case then sends a fresh AI request and verifies a single Undo restores its exact pre-apply document.

## Validation

Environment: Node `v26.12.1`, npm `12.2.1`. Reused the existing dependency installation via a temporary symlink; all 350 installed package versions checked against this checkout's lockfile matched. A fresh `npm ci` was not performed.

Commands below ran in the reconstructed remote-main directory with the selected Node bin directory prepended to `PATH`.

```sh
node --import tsx --test tests/ai-chat-history.test.mts
# Before fix: 9 pass, 5 fail (new cases); after fix: 14 pass.

node --import tsx --test tests/ai*.test.mts tests/audit-h-ai-network.test.mts
# 91 pass, 0 fail (the six files were explicitly enumerated during execution).

node --import tsx --test tests/gesture-history-boundary.test.mts tests/audit-j-editor-history.test.mts tests/history-restore-safety.test.mts tests/history-conflicts.test.mts
# 28 pass, 0 fail.

npm run typecheck
# Pass.

npm run build
# Environment failure: Turbopack refuses dependency symlinks outside its root.

npm run build -- --webpack
# Pass: production compilation, TypeScript, all 21 static pages, build traces.

git diff --check
# Pass in the deliverable worktree.
```

Browser validation was attempted at launch preflight: the installed Playwright expects Chromium build 1254, which is absent. The cached build 1248 also cannot launch under this sandbox (`bootstrap_check_in ... Permission denied`). Browser E2E is therefore **unverified**, not passed. The real chat/store browser fixture does bundle successfully in the unit suite.

Full-suite E2E, Workers/Docker builds, live providers, dependency audits, generated-format builds, and performance profiling were not run in this focused investigation. They remain supervisor/integration gates. No approved all-CI baseline or deployment is claimed. No commit, push, PR, or merge was performed.
