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


## Current required-CI and review evidence (M extension)

The live reporter now obtains active default-branch Rulesets and evaluates each
PR's *required* check context against the exact application/integration ID. It
does not infer merge readiness from the presence of unrelated green jobs. The
new pure helpers live in `scripts/audit/merge-gates.mjs`, with
regression cases in `tests/audit-merge-gates.test.mts`.
Its data is read-only and may become obsolete as soon as a PR head moves.

- A missing Ruleset, unavailable review API, truncated check-run page, absent
  required context, pending run, or failed job blocks a "verified" designation.
- A review of an older commit, an approval from the PR author, or a comment
  without approval is not exact-head independent review evidence.
- GitHub's `required_approving_review_count=0` setting on the
  Tsumu main Ruleset does **not** waive the audit plan's independent verification.
  Reviewers using the PR author's same GitHub login cannot supply an
  independent GitHub approval, even when different agents conducted the work;
  record their separate technical verification and any unverified reviewer
  requirement explicitly rather than inventing an approval.
- CodeQL and workflow success cannot demonstrate that the complete open
  alert backlog is empty. The API for the actual open security/dependency alerts
  must be independently checked before final clearance.

### Non-audit PRs

Review *all* open PRs, not just A–J/M. On 2026-11-09 an additional
performance PR #34 began changing `components/script-editor/useScriptDrag.ts`,
which was already modified by audit-C PR #23. This is a real same-path overlap
despite all 11 audit PRs being overlap-free at the earlier snapshot.
Integrate C's correctness and cancellation fixes first, then have #34 follow
the resulting main and rerun drag/selection/performance regression tests.
Never treat the GitHub `mergeable` field as validation of
compatibility between two *unmerged* PRs.
