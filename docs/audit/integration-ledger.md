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
| Other | [#33](https://github.com/abshrimp/tsumu/pull/33) | yes | `5d40066818f5cf534d2ca12c4f90fc34eba32d1f` | 9 | — |

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
