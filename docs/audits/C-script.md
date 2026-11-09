# C: Script editor and runtime audit

- Repository: `abshrimp/tsumu`
- Baseline: `1ba32974d4b5ecf441e36428e765d0542207c421` (2026-11-09)
- Dedicated branch: `audit/C-script`
- Status: in progress; **no completion or security guarantee is claimed**.

## Scope and ownership

- Script editor UI: `components/ScriptEditor.tsx`, `components/script-editor/`
- Script model and compiler: `lib/script.ts`, `lib/script-model/`
- Runtime and shared value rules: `lib/script-runtime.ts`, `lib/value-semantics.ts`, `lib/vars.ts`
- Targeted tests: `tests/script-*.test.mts`, `tests/value-*.test.mts` and relevant E2E specs.

All findings use `AUD-C-NNN`. Changes to unrelated API, data persistence, import, export, configuration and CI files are out of scope and will be handed to their respective owners. The only open PRs at baseline (#19 import, #22 style/account) do not directly edit the core script files.

## Review matrix

| Area | Review targets | Evidence / status |
| --- | --- | --- |
| C-1 Blocks | all present step kinds, typed values, empty/missing values, nesting, errors | In progress |
| C-2 Predicates | typed comparison, AND/OR grouping, short-circuiting, null/NaN/Infinity, containment, keys | In progress |
| C-3 Lists and loops | list editing, filtering/sorting, scope, break, mutation, budgets | In progress |
| C-4 Async/lifecycle | delay, cancellation, reentry, page changes, detached targets, fetch-related hand-off | In progress |
| C-5 UI/runtime/export parity | round trips, edit ordering, variable picker scope, compiled script, generated runtime | In progress |

## Work log

- Established an isolated baseline branch. Enumerated `lib/script-runtime.ts`, `lib/script.ts`, `lib/script-model/recipe-runtime.ts`, `lib/value-semantics.ts`, and their existing runtime tests.
- Open PR #19 changes import/asset paths; #22 changes style/account UI. Maintain file ownership boundaries.
- Runtime and exported scripts share `SCRIPT_RUNTIME`. Generated output removes features by feature markers, so every runtime fix must also be checked in compact exported scripts.
- **Validation pending:** no test or CI success is asserted in this initial checkpoint.

## Findings

Pending reproduction and regression tests.
