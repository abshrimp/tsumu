# M integration ledger: point-in-time snapshot

**Observed (UTC):** 2026-11-09T02:12:50.852Z  
**Main SHA:** `4cd04c23137e11afce7d7c43f0e06a52815de38e`  
**Plan SHA:** `1ba32974d4b5ecf441e36428e765d0542207c421`  
**Open PRs:** 11; **exact/case-normalized path overlaps at observation:** 0.

Already-merged historical PRs are outside the active overlap set. This table represents reported paths, not evidence that any audit is finished or safe to merge.

| Area | PR | Draft | HEAD | Files | Shared/critical touchpoints |
| --- | --- | --- | --- | ---: | --- |
| B | [#31](https://github.com/abshrimp/tsumu/pull/31) | yes | `b33cf073fe4a6bf8f73005e52a9d17324554bd1e` | 7 | — |
| C | [#23](https://github.com/abshrimp/tsumu/pull/23) | yes | `64428c9f532763243264ca5177320dfd0ac2be31` | 7 | — |
| D | [#24](https://github.com/abshrimp/tsumu/pull/24) | yes | `06c8e4b431fb4ec09a3dd0fe99016b4ce3c9c2bf` | 9 | `components/Editor.tsx` |
| E | [#26](https://github.com/abshrimp/tsumu/pull/26) | yes | `a2032b897cdfb81c0e4d4114472fc61732d006f7` | 12 | — |
| F | [#30](https://github.com/abshrimp/tsumu/pull/30) | yes | `dc5d1661623f558bd49161c75c706d4d36054e5b` | 5 | — |
| G | [#29](https://github.com/abshrimp/tsumu/pull/29) | yes | `dc103886a391f7c32c89d867377339ada9e3f8f1` | 9 | `app/api/publish/route.ts` |
| H | [#27](https://github.com/abshrimp/tsumu/pull/27) | yes | `7781b01dc7fd2f96a45f0600826dede1d5822cd6` | 13 | `lib/generator/safe-fetch-source.ts` |
| I | [#25](https://github.com/abshrimp/tsumu/pull/25) | yes | `fd9e719b6132b7c25ee889497fee1ede4bb04464` | 15 | `.github/dependabot.yml`, `.github/workflows/ci.yml`, `package.json` |
| J | [#28](https://github.com/abshrimp/tsumu/pull/28) | yes | `a3ea4e19f14a7a77979dd9bcef7d6810901beb5a` | 4 | — |
| M | [#32](https://github.com/abshrimp/tsumu/pull/32) | yes | `16716e7a7620a9dda6f00725caa8cd197df25b6b` | 5 | — |
| A | [#33](https://github.com/abshrimp/tsumu/pull/33) | yes | `5d40066818f5cf534d2ca12c4f90fc34eba32d1f` | 9 | — |

## Synchronized-change risks requiring separate review

- **C ↔ F ↔ H:** script-runtime semantics and safe external-fetch behavior must remain consistent in exported generated projects.
- **E ↔ B ↔ F:** imported document validation, asset references and serialization must survive persistence and generated output.
- **B ↔ G:** concurrent document revisions, history restoration and GitHub publish preconditions must not resurrect deleted data or publish stale contents.
- **I ↔ all areas:** CI/workflow or package updates can invalidate prior green runs; require checks on each latest PR head and integrated main.
- **J ↔ each implementation:** independent tests and review, including cross-boundary attack paths, are still required.

## Same-path collision report

No exact or case-normalized path overlap among these open PR heads **at observation time**.

## Merge decision state

**Not authorized.** This snapshot does not include a complete, authoritative required-check list; CodeQL and dependency alerts are not verified; all heads and draft status must be re-fetched immediately before review. Every integration needs an independent reviewer and regression evidence on the exact merged SHA. Changes after 2026-11-09T02:12:50.852Z invalidate the corresponding row.

## M checkpoint: 2026-11-09 02:56 UTC (live GitHub evidence)

Main remained `4cd04c23137e11afce7d7c43f0e06a52815de38e` when re-read. This is a **point-in-time integration gate**, not proof of safety. The 11 PRs are still open and mergeable, but only A/G/F are non-draft at this checkpoint; no GitHub review submissions have been recorded for any of the 11 PRs. Path overlap inspection found no identical/case-normalized modified path across the observed PR file lists; semantic contracts remain unreviewed. All observed check statuses belong to **individual branch HEADs**, not a combined integration commit.

| Area | PR | Latest observed head | CI result at checkpoint | Independent review |
| --- | --- | --- | --- | --- |
| A | #33 | `a00a7c6280683146199309f19943ebb1411e4f03` | 14/14 successful | none recorded |
| B | #31 | `3868cc89d2a48b2ecbd08bc1239625b2d076b24b` | 14/14 successful | none recorded |
| C | #23 | `136b1a442b23a25ae87f6374a6389932c316285a` | 11 successful, 3 E2E in progress at last fetch | none recorded |
| D | #24 | `4a5ceec678ffa78b6dd35c90366aa77d828d831e` | 14/14 successful | none recorded |
| E | #26 | `079e83a877912ac76ad1d6b8b8bf205329202790` | new HEAD; checks in progress; **previous head failed 2 Node tests** | none recorded |
| F | #30 | `a3f59f230512a1767a5c9773257f8d28674aae57` | 14/14 successful | none recorded |
| G | #29 | `ece4bb9a408ec6d38dc11e0da2db29284e61d5da` | 14/14 successful | none recorded |
| H | #27 | `fd6958103283cfb045bed1aebfe2d6f99d98be8c` | 14/14 successful | none recorded |
| I | #25 | `3d02386cbc4640ca269d33e0915dc782c105352a` | 14/14 successful | none recorded |
| J | #28 | `a3ea4e19f14a7a77979dd9bcef7d6810901beb5a` | 14/14 successful; **J-4 review outstanding** | none recorded |
| M | #32 | `9b9e5478095038e64d735d0afe632bda3b68d7f8` | 14/14 successful **before this ledger edit** | none recorded |

### Immediate blockers and hand-offs

1. **E / #26 — blocking CI failure:** `check` at prior head `16c4574f3cfb09beaecdb9aba1ab78281d0405c3` failed in `tests/site-copy-concurrency.test.mts` (valid import returned 400 instead of 200) and `tests/site-import.test.mts` (Node-side SVG import sanitizer threw). Details and required security-preserving fixes are in [the M comment](https://github.com/abshrimp/tsumu/pull/26#issuecomment-6731118021). A newer head has been pushed; the earlier failure must not be attributed to the new head without rerunning tests.
2. **F / #30 — unresolved generated-code secret boundary:** F reports that a Next.js server-side data fetch can embed literal authentication headers in generated source. A publicly pushed export may expose secrets. This needs an explicit security/design decision and regression proof; passing CI on #30 does **not** close the risk. Preserve useful server-side features and avoid an undocumented silent removal.
3. **Cross-area contract review:** E's `validateImportedDoc` vs B's `validSiteDoc` (and G's restore), C's `setVarPath` vs generator page-data runtime, H's `safe-fetch` vs embedded F runtime, D's CSS safety vs F's generated CSS. Require integration tests on one merged tree; zero shared paths does not rule out these incompatibilities.
4. **Review and CodeQL backlog:** All 11 PRs lack formal submitted independent review at this checkpoint. The Actions / CodeQL checks are reported successful for the listed green heads, but the repository's open code-scanning/Dependabot alert backlog was **not readable in the current integration context** and remains an explicit unknown. Do not treat a green CodeQL *workflow* as proof of zero alerts.
5. **Production safety:** No destructive tests on real D1/KV data or live GitHub publish repositories. Cloudflare / Docker / external-provider real-world behavior remains separately unverified.

### Proposed integration sequencing (conditional, not authorization)

- Finish E's CI repair, verify C's moving head and request J's independent reviews before any product change merge.
- Land reviewable foundational checks from J and I only after their own gates, then validate A/H API/communication changes together.
- Review B before E and G; review C and H before F; independently verify D/F CSS parity. The actual merge order must be recalculated after every main change, and only the existing PRs should be used rather than generating duplicate PRs.
- Re-run typecheck, i18n, all Node tests, Workers build, all E2E shards, five generated-format builds, CodeQL, and cross-boundary J cases on the **integrated** SHA. Keep M #32 draft while final evidence and risks remain open.

Record the next update in a new timestamped checkpoint. Do not replace this historical evidence with a mutable “current green” assertion.
