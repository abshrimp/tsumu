# Tsumu parallel audit: M coordination policy

This document implements the coordination role (M) of the comprehensive audit plan. It does not certify the repository as bug-free or replace independent verification.

## Pinned starting point and moving main

- Initial plan baseline: `1ba32974d4b5ecf441e36428e765d0542207c421`.
- M branch starting point: `4d220d415f7db612fdf5a86cd048f7e3f8d40fc4`.
- Every finding records the commit on which it was reproduced, and every final verification records the **exact** post-integration commit. Changes to `main` after the baseline require a separate delta review.
- A green check on an older head is **not** evidence that the current head passed.

## Ownership and hand-off

| Owner | Primary area |
| --- | --- |
| A | Authentication, authorization, API and CSRF |
| B | SiteDoc, persistence, conflict resolution and collaboration |
| C | Script editor, runtime and value semantics |
| D | Canvas, UI, styles and animations |
| E | Importers, archives, HTML/CSS ingestion and assets |
| F | Exporters, generated projects and generated-code security |
| G | GitHub publishing, history and restoration |
| H | AI endpoints and external communication |
| I | Dependencies, CI/CD, deployment configuration and obsolete infrastructure code |
| J | Independent cross-boundary security and integration verification |
| M | Scope/ownership conflicts, review gates, merge coordination and final audit evidence |

Area ownership is not a blanket lock: the exact modified paths in open PRs must be checked before making another change. M resolves disputes over shared paths and coordinates `package.json`, CI workflows and shared configuration with I. Already-merged historical PRs are not tracked as active overlaps; their effects are part of the current main baseline. Tests added at new paths do not grant permission to modify another owner's implementation.

## Change and PR protocol

1. Before editing, fetch live `main`, open PRs, their changed-file lists and affected HEADs. Reserve overlapping paths with the relevant owner; do not blindly cherry-pick or overwrite another patch.
2. Record each finding as `AUD-<owner>-NNN` with classification, severity, affected SHA, minimal reproduction, expected/actual behavior, impact, root cause, regression, owner, PR and independent verifier. Do not expose exploitable unpatched details in public Issues.
3. Commit and push meaningful units to the dedicated owner branch. Never push an audit fix directly to `main`.
4. Avoid new compatibility layers and unrelated behavior changes. A fix requires a regression test and review by someone other than its author.
5. If two PRs overlap, first confirm whether the *behavior* conflicts. Pick one owner or make an explicit ordering plan; do not create duplicate independent fixes.
6. Review common data contracts (SiteDoc and types), script-to-generated-code parity, persistence-to-publish transitions, and input-to-output trust boundaries after combining patches.
7. Use a single M PR for coordinator tooling and evidence. Other owners retain their own reviewable fixes; M does not silently copy their work into this branch.

## Merge gate (per exact commit)

Do not merge merely because an earlier revision passed CI. Verify: review completion; no unresolved important comments; no unexplained Critical/High findings or CodeQL alerts; no merge conflicts; required CI, E2E, build, i18n and relevant generated-site tests on the current head; independent reproduction/regression review; no duplicate patches. Apply the repository's squash-merge policy. If a gate is unavailable or unverified, record it as **unknown**, not passed.

After each merge, capture the new `main` SHA, affected file paths, regression results and cross-team impact. Re-run relevant checks on the integrated commit. Final completion additionally requires an independent cross-domain audit, no unexplained Critical/High, an explicit residual-risk register and evidence for every check in the plan.

## Non-destructive practice

Never run destructive security tests on real user data or production. Use mock services, synthetic SiteDocs and isolated environments. Do not auto-merge unrelated PRs or force-push shared refs during orchestration.
