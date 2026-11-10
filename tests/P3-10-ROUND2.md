# P3-10 — round 2, investigation 1: architecture

Date: 2026-11-10. Priority: P2. Scope: keyboard accessibility in components,
with regression coverage in tests/ and e2e/.

## Baseline and overlap

- Worktree HEAD and local origin/main were `d6f17ae54ae41aafb80ba5a969cbac35b73447f2`.
  Git CLI networking failed with `Could not resolve host: github.com`.
- Read current main through the GitHub connector: initially
  `ced4645fdf248c00a1617b1fcf794e0a90ca7d20`, then
  `bc5ff410e9f0f8ccf260486ed4b2cfbafd6035a3`. Compared both against the checkout.
  The five intervening commits change import/export, safe fetch, worker,
  cloning and save-recovery code; none changes DialogHost, lib/dialog,
  lib/keys, localization or the dialog's direct UI dependencies.
- Fetched current main's DialogHost independently. Its Git blob is
  `4abbfd27a5e93edb5604151d2dfd8793fde2aaa8`, identical to this checkout before
  the fix. The regression exercises that current implementation. Wider tests
  and the build ran on the local baseline, not a fully updated main checkout.
- No open PRs were returned at the initial and pre-completion checks. Examined
  other worktrees' changed paths: no competing DialogHost edit. Reviewed the
  merged #110 dialog IME change and existing native-select, script Escape and
  committed-field regressions; those fixes are retained, not resubmitted.
- No applicable AGENTS.md or tasks.json exists in this worktree. Both discovered
  supervisor-package copies at `/Users/riku/Downloads/tsumu-codex-agent-fixed/tasks.json`
  and `/Users/riku/Downloads/tsumu-codex-agent-fixed 3/tasks.json` define P3-10
  exactly as assigned. No execution-queue changes were made.
- This is not an approved release baseline: initial remote CI was running;
  the later main CI run was cancelled and CodeQL was still running.

## Entry points, state and consumers

| Entry / consumer | Contract and transitions traced |
| --- | --- |
| Home site deletion, Header reset/export errors | Call showPrompt/showAlert; await a result before mutating data or reporting completion. Home and Editor each mount a DialogHost. |
| PagesTab, PagePanel, SitePanel, AssetsTab, AllowedAccounts | Call showConfirm for destructive or replacement actions. Existing lifecycle guards remain responsible for stale targets and pending operations. |
| lib/dialog.ts | Push requests with monotonic IDs into a Zustand queue; only queue[0] is rendered. closeDialog removes the matching ID; finish resolves the original promise. |
| DialogHost / Dialog | Portal to document.body, keyed by request ID. Prompt text is local React state; expect controls the native OK button's disabled state. Initial focus is input, dangerous-confirm Cancel, or OK. |
| Keyboard dispatch | Window capture handles Escape; document bubbling stops editor shortcuts after React input/button handlers. isEnterKey excludes composition and keyCode 229. Script-editor capture and bubbling handlers also account for dialog ownership. |
| Editor and script editor | Global shortcuts mutate selection/history; native form fields own their editing keys. Modal presence prevents underlying element operations. Preventing event propagation alone does not prevent the browser's default Tab movement. |
| Translation | loadLocale selects dictionaries before UI rendering; dialog title and Cancel use tr. Accessible names must remain linked to the translated title while the user types. |
| Neighboring canvas/controls | Reviewed contenteditable composition guards, committed fields, native selects, script Escape routing and gesture cancellation tests. Saved SiteDoc, IDs, schemaVersion and persistence do not participate in this fix. |

Expected focus lifecycle: trigger → modal's initial control → enabled controls
within the modal → surviving trigger on close. For a queued request, old-dialog
cleanup restores the trigger before the next dialog captures it and takes focus.

## Confirmed P2: modal keyboard focus escapes and is lost after dismissal

Reproduction: open an alert or confirmation using the keyboard, focus its last
button, then press Tab. Before the fix, native Tab leaves the portal and reaches
the background page. Shift+Tab from the first control also escapes. A prompt
whose required confirmation text is missing has only input and Cancel enabled;
Tab from Cancel likewise escapes. Closing with OK, Cancel or Escape removes the
focused DOM node without returning focus to the invoking control.

Cause: DialogHost sets initial focus and blocks shortcut propagation, but neither
contains default focus traversal nor registers focus cleanup. aria-modal alone
does not implement keyboard modality. Background controls remain reachable while
the confirmation is unresolved.

Fix: wrap only Tab boundaries, using current refs and live disabled states;
recover Tab traversal if focus was moved outside; restore the connected previous
HTMLElement during cleanup. Interior Tab movement stays native. Retain the IME
guard and existing dialog results. No change to confirmation authorization,
saved data, queue schema or caller mutation logic.

Required acceptance tests: all three dialog kinds, danger initial focus,
forward/backward Tab, disabled-to-enabled OK transitions, all dismissal paths,
queue transitions, Strict Mode effect replay and a removed invoking element.
The executable component tests cover these paths; native browser certification
remains outstanding as noted below.

## Confirmed P3: prompt lacks a stable accessible input name

Reproduction: showPrompt with a title/message and no placeholder. Its text input
has neither a label nor aria-label/aria-labelledby. The surrounding dialog's
name and description do not label the input itself.

Fix: associate the input with the existing translated title and instruction IDs.
Regression verifies both ID references and their text. Browser cases query the
textbox by its Japanese/English accessible name and check its description.

## Other hypotheses and results

- Composition Escape cancelling the dialog: existing guards pass the executed
  isComposing/keyCode-229 tests; no competing IME fix was made.
- Focused native selects deleting selected script blocks or consuming Undo:
  existing scope tests pass. Ordinary script deletion/history tests also pass.
- Remote updates overwriting untouched committed fields and stale confirmation
  consumers: focused committed-field, asset, page-kind and text-style tests pass.
- Touch activation or locale-specific native focus behavior: seven browser cases
  were added and discovered, but were not executed successfully. These remain
  unverified, not confirmed defects. Physical IME and screen-reader speech are
  also unverified; synthetic composition and ARIA assertions cannot certify them.

## Verification

Used Node 26.12.1/npm 12.2.1 with an existing dependency installation temporarily
symlinked from the r2-test-baseline worktree. No clean npm ci or dependency audit
was performed. The symlink was removed after checks.

1. Before the production edit:
   `node --import tsx --test tests/dialog-focus.test.mts`
   — **10 failed, 2 passed**. Failures show focus escaping to opener/background,
   missing focus restoration and the unnamed prompt. Log:
   `/private/tmp/tsumu-p3-10-red.log`.
2. After the fix, the same command — **12 passed**.
3. `node --import tsx --test tests/dialog-focus.test.mts tests/script-keyboard-scope.test.mts tests/script-escape-routing.test.mts tests/commit-fields.test.mts tests/comment-composer.test.mts tests/asset-confirmation.test.mts tests/page-kind-confirmation.test.mts tests/text-style-confirmation.test.mts`
   — **215 passed**, no skips. Log: `/private/tmp/tsumu-p3-10-focused.log`.
4. `npm run typecheck` — passed. `npm run i18n:check` — passed.
5. `npm run build -- --webpack` — passed, including TypeScript and page generation.
   Existing middleware deprecation and jose Edge Runtime warnings remain.
   Log: `/private/tmp/tsumu-p3-10-build.log`. Default Turbopack was not run.
6. `npx --no-install playwright test e2e/dialog-focus.spec.ts --project=chromium --list`
   — seven tests discovered. dialogFocusBundle also bundled successfully.
7. Browser execution prerequisite failed: Playwright expects headless Chromium
   revision 1254, which is absent; explicit launch of installed revision 1248
   failed with `bootstrap_check_in ... Permission denied (1100)` in the sandbox.
   No browser test pass is claimed. The unit harness executes the production
   component/effects and real queue with modeled DOM focus/Tab defaults.
8. `git diff --check` — passed.

No full unit suite, full browser E2E, Firefox/WebKit, physical touch/IME,
assistive-technology session, Workers build, Docker or live deployment was run.
No commits, pushes, PRs, merges, CI edits or live configuration changes were made.
