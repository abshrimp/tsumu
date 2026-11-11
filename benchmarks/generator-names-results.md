# Generator naming benchmark — 2026-11-11

Baseline: `c57335997034275f3d639f567ea4809246bac3d7`. Fixed source: `lib/generator/names.ts` with cached suffix allocation.

Environment: Node v26.12.1, linux x64, INTEL(R) XEON(R) PLATINUM 8573C.

Both runs used the same harness and machine, sequentially after the baseline full test suite and production build completed. One warmup and five measured samples per size; the full suite/build were paused during measurement. Other agents could run focused checks, so these timings are observations, not a general browser performance guarantee.

The fixture assigns the default `ボックス` label to every node. The timer covers `buildClassNames` only, with document construction and result assertions outside the timer. It does not measure whole-project export, rendering, saving, or collaboration.

| Nodes | Before median (ms) | After median (ms) | Ratio |
| ---: | ---: | ---: | ---: |
| 1,000 | 70.974 | 3.502 | 20.3× |
| 5,000 | 1486.985 | 5.584 | 266.3× |
| 10,000 | 7067.562 | 15.214 | 464.5× |

The allocation algorithm previously restarted suffix search at 2 for every repeated name. It now resumes each normalized base/extension from its next candidate. Collision checks still account for names already supplied with numeric suffixes. Asset and component allocation use the same helper; the timing above measures class names only.

## Reproduction

Run on an otherwise idle machine with the repository Node/npm toolchain and dependencies:

```sh
node --import tsx benchmarks/generator-names.mts /path/to/baseline-checkout
node --import tsx benchmarks/generator-names.mts /path/to/fixed-checkout
```

## Raw samples (ms)

```json
{
  "before": {
    "node": "v26.12.1",
    "platform": "linux",
    "arch": "x64",
    "cpu": "INTEL(R) XEON(R) PLATINUM 8573C",
    "warmups": 1,
    "measuredSamples": 5,
    "results": [
      {
        "count": 1000,
        "medianMs": 70.973656,
        "samples": [
          81.93134500000008,
          75.65935200000001,
          53.99243899999999,
          70.973656,
          58.77479400000004
        ]
      },
      {
        "count": 5000,
        "medianMs": 1486.9850770000012,
        "samples": [
          1601.958713,
          1392.4225180000003,
          1636.613711,
          1486.9850770000012,
          1418.1705660000007
        ]
      },
      {
        "count": 10000,
        "medianMs": 7067.561860999998,
        "samples": [
          6784.792776000002,
          7067.561860999998,
          6861.6624139999985,
          7312.967095,
          9023.671534000001
        ]
      }
    ]
  },
  "after": {
    "node": "v26.12.1",
    "platform": "linux",
    "arch": "x64",
    "cpu": "INTEL(R) XEON(R) PLATINUM 8573C",
    "warmups": 1,
    "measuredSamples": 5,
    "results": [
      {
        "count": 1000,
        "medianMs": 3.5023359999999855,
        "samples": [
          3.628805,
          1.4143960000000106,
          2.1341189999999983,
          3.5023359999999855,
          3.789736000000005
        ]
      },
      {
        "count": 5000,
        "medianMs": 5.58419600000002,
        "samples": [
          6.769719000000009,
          5.58419600000002,
          5.144498000000027,
          4.523426000000029,
          8.203963999999985
        ]
      },
      {
        "count": 10000,
        "medianMs": 15.214318000000048,
        "samples": [
          18.296334,
          16.678128000000015,
          11.606845999999962,
          15.214318000000048,
          10.41616700000003
        ]
      }
    ]
  }
}
```

## Correctness

- 31 focused tests passed, including 25,000 repeated class names, asset/component uniqueness, case collisions, reserved identifiers, and authored numeric suffix precedence.
- A separate deterministic parity probe compared all three allocators against the baseline on 40 mixed-label fixtures of 200 entries; every output matched.
- Long component labels are capped at 120 ASCII characters before uniqueness suffixes; Next.js and React exports retain matching imports and filenames while leaving authored labels unchanged.
