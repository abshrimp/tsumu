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

## M checkpoint: 2026-11-09T03:21:19.773Z (new cross-PR collision and evidence gates)

Repository main: `4cd04c23137e11afce7d7c43f0e06a52815de38e` at the last confirmed read; **no audit PR has been merged by M**.
Open PRs now include non-audit performance #34, so the active set is **12** (not 11). `components/script-editor/useScriptDrag.ts` is modified by both #23 and #34. M sent ordering notices to both branches: complete C correctness review first, then update/retest performance #34 against the resulting main. These are not duplicate audit PRs, but they overlap in code and should not be independently merged on the old base.

### Open heads at this snapshot

| PR | HEAD | State |
| --- | --- | --- |
| #23 | `c61acc91972192ca17beeee0076ac3c730c4b406` | Draft |
| #24 | `4a5ceec678ffa78b6dd35c90366aa77d828d831e` | Draft |
| #25 | `f1b36626411783cd8b93e085dedc50d315affa72` | Draft |
| #26 | `fb6fae2d861ebb85ab28132ce87dc5b125df8ad4` | Draft |
| #27 | `fd6958103283cfb045bed1aebfe2d6f99d98be8c` | Draft |
| #28 | `4995975497ff48a66fd4cd902397108172e44bee` | Draft |
| #29 | `11973f8846c7e36922ee25992c85b867abf2a9fe` | Open |
| #30 | `5f1298aa4ae8a1119c20696dfbcc35b1b7450551` | Open |
| #31 | `7aae88e6e3dd2c15d02ddad5a221d46f89ddf96a` | Draft |
| #32 | `4e1a333c6c0527f55d263d54fbd44bb4a1b5010c` | Draft |
| #33 | `4f676abcfbc82d37a83bccb43ca497d539c0f9ed` | Open |
| #34 | `7c9f74cbd8b5d692ca8b0283dd07047e2cc7a3c6` | Open |

### Additional review evidence

- J's `AUD-J-014`/`015` report identifies incompatible SiteDoc validation between #26 import and #31 persistence. E and B own their individual fixes; neither has been merged. Final integrated import→save→reopen and malicious PUT/PATCH rejection are still unverified.
- J `AUD-J-016` initially failed because its positive control assumed an unallowlisted public IP would be allowed in a generated SvelteKit SSR request. The generated runtime intentionally enforces an explicit origin allowlist. J updated its test to expect rejection and verify an allowed same-origin relative request; the newest J HEAD must still pass required CI before acceptance.
- M's original live reporter checked observed job counts but not exact branch Rulesets. `scripts/audit/merge-gates.mjs` and new tests now validate required contexts by GitHub Actions integration ID and exact-head independent review, and `scripts/audit/coordination.mjs` includes the results in its read-only report. All API failures, incomplete check pages and missing reviewers are fail-closed. The current Ruleset requires 10 checks; **the audit plan's independent review remains a separate gate even though GitHub's required approval count is zero**.
- The generated Next.js server-side auth-header/API-key exposure called out in #30 remains an unresolved design/security question. No change to secret-bearing server fetch semantics was authorized by M. The CodeQL/Dependabot open-alert backlog remains unverified and cannot be inferred from successful workflow runs.
- All PR authors use the same GitHub account; no formal independent review submissions were observed in the latest PR reviews. A review by a distinct agent using the same GitHub login cannot be represented as another GitHub user's approval. Require separately recorded substantive validation or an external reviewer rather than making up evidence.

**Merge verdict at this checkpoint: blocked for full integration.** Moving heads, the #23/#34 overlap, pending/failed historical checks, missing independent reviews, B/E validator mismatch and unresolved generated secrets require resolution. Retest all required checks and integrated-main behaviors on the exact resulting SHA.

## M integration checkpoint: 2026-11-09 (post-merge coordination)

This is a later checkpoint. Earlier rows above remain historical snapshots; they do not describe current open PRs.

| Area | Audit PR | Integration state | Main squash SHA / remaining gate |
| --- | --- | --- | --- |
| C | [#23](https://github.com/abshrimp/tsumu/pull/23) | Already merged before this checkpoint | Recheck the script runtime against generated-site behavior |
| J | [#28](https://github.com/abshrimp/tsumu/pull/28) | Merged after 14 green checks | `408c967b2c51d729e5a49d73bad15e9a8e03549b` |
| I | [#25](https://github.com/abshrimp/tsumu/pull/25) | Merged after 14 green checks | `95d9d3753e6f4fee4bb20b2c143c4718a820f22b` |
| H | [#27](https://github.com/abshrimp/tsumu/pull/27) | Merged after 14 green checks | `b68ac78a21f6150f172fc1bb5cae6a9342b5de04` |
| D | [#24](https://github.com/abshrimp/tsumu/pull/24) | Merged after 14 green checks | `103501e9683559c85c4a478bf9068b47b2a74484` |
| B | [#31](https://github.com/abshrimp/tsumu/pull/31) | Test fixture corrected; merged after 14 green checks | `cf60ab303b41754f84462b752bfc6f0edadbb92d` |
| E | [#26](https://github.com/abshrimp/tsumu/pull/26) | Corrected and rerunning CI | Shared B validator, dangling asset references, folder references, J merge-fixture repair |
| A | [#33](https://github.com/abshrimp/tsumu/pull/33) | Corrected and rerunning CI | Published hover E2E actionability regression |
| F | [#30](https://github.com/abshrimp/tsumu/pull/30) | Blocked | Published hover E2E and generated-code credential handling design/risk decision |
| G | [#29](https://github.com/abshrimp/tsumu/pull/29) | CI-green, higher-risk publish/rollback verification outstanding | Disposable repository smoke and independent review |
| M | [#32](https://github.com/abshrimp/tsumu/pull/32) | This coordination PR remains draft | Re-run combined gates and finalize residual-risk/evidence ledger |

**Unverified gates:** The default branch's integrated SHA must undergo another full CI and cross-boundary review. An Actions CodeQL success does not establish a clean open-alert backlog; inaccessible scanning and dependency-alert endpoints are recorded as unknown. No real production data or publishing repository was modified for a destructive test. There is no assertion that the entire audit has completed.


## M merge checkpoint: authentication and import/export follow-up (2026-11-09)

- Audit A [#33](https://github.com/abshrimp/tsumu/pull/33): squash-merged as `ae20d9c4f8ab7233bc4c0ca9d39a3c3c96041427`. All 14 HEAD checks passed after correcting an E2E-only sibling hover actionability race.
- Audit E [#26](https://github.com/abshrimp/tsumu/pull/26): updated with the common B SiteDoc validator and dangling asset/page-folder rejection. Merged current main into the E branch without overriding B-owned `lib/doc-tree.ts`; repaired J's synthetic merge fixtures to use current valid node/text/page shapes. CI remains a merge prerequisite.
- Audit F [#30](https://github.com/abshrimp/tsumu/pull/30): synced against newer main and included the same browser hover test fix. The independently documented generated-code credentials design issue is **still unresolved**. A green CI would not authorize changing the secret persistence model or merging this PR without the required review.
- Audit G [#29](https://github.com/abshrimp/tsumu/pull/29): HEAD CI green, but a disposable-repository GitHub publish→manual-edit→rollback→restore smoke and production token-permission verification remain unperformed.
- This coordinator branch remains a draft. Neither this checkpoint nor previously green individual PRs establishes completed final-main integration or absence of all security alerts.


## M checkpoint: E successfully integrated (2026-11-09)

- Import and asset audit [#26](https://github.com/abshrimp/tsumu/pull/26) was squash-merged as `63df277bcade99a699b23d5f555232053c932ea1`, after **all 14 latest-HEAD checks succeeded**, including four Playwright E2E shards and Cloudflare Workers Builds. E's final validation reuses the B SiteDoc integrity rules and rejects dangling asset/folder references; its synthetic concurrency fixtures were updated to match the current schema.
- The seven audit PRs merged during this integration pass are J #28, I #25, H #27, D #24, B #31, A #33 and E #26; C #23 was previously merged.
- F [#30](https://github.com/abshrimp/tsumu/pull/30) was verified on 27 green checks, but deliberately converted to draft because generated-code and edit-ZIP credential handling still require a security/design decision.
- G [#29](https://github.com/abshrimp/tsumu/pull/29) remains unmerged despite 14 green checks because an isolated GitHub publishing/restore smoke and independent safety review are outstanding.
- M [#32](https://github.com/abshrimp/tsumu/pull/32) remains draft pending integrated-main CI, final audit coverage and a verified CodeQL/Dependabot alert backlog. The absence of security alerts is not inferred from green workflows.

