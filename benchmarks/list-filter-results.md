# List filter preparation

Reproduce from the repository root with the package.json Node version and installed dependencies:

```sh
node --import tsx benchmarks/list-filter.mts
```

This synthetic CPU benchmark compares `filterItems` with its implementation from
main commit `d55de8dea021d22f1aec319d53b45027e91b529f` in the same process.
It asserts identical output before timing, alternates execution order, discards
three warmups and records 15 samples. The harness prints every sample and runtime
metadata. Do not run concurrently with tests or builds.

## Local result

Node 26.12.1, Linux x64, AMD EPYC 9V74. Time is milliseconds per call.

| Fixture | Rows | Calls/sample | Before median | After median | Before p95 | After p95 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| JSON membership and mixed groups | 50,000 | 1 | 202.147 | 154.493 | 245.187 | 195.709 |
| Scalar mixed groups | 50,000 | 1 | 157.439 | 137.794 | 181.342 | 159.392 |
| Small scalar | 10 | 1,000 | 0.01394 | 0.01239 | 0.01452 | 0.01700 |

Large-case medians improved by 23.6% and 12.5%. The small-case median improved,
but its p95 increased by 17.1% (2.48 microseconds). These are one synthetic run,
not an end-to-end browser benchmark or a promise of universal speedup. With 15
samples the nearest-rank p95 is the maximum sample.

The change removes repeated AND/OR grouping and repeated literal parsing from
per-row work. Preparation is scoped to one call. Operands are still parsed only
when reached by short-circuit evaluation. Additional retained scratch space is
O(number of conditions + total parsed literal size); no document cache survives
the call. Heap/RSS were not measured. Published runtime and generated code are
unchanged: the measured path is editor list preview through `applyList`.

Validation: 81 tests passed across list-filter-preparation, list-filter-value-parity,
script-block-composition, script-data-prototype-safety, export-security and
generated-list-order-parity. Full typecheck, full suite, build and browser checks
are separate coordinator validation, not established by this focused run.
