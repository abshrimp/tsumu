# Typed expression foundation (Draft, first part of stage C)

This is a review-only, pure expression module under `lib/script-model/`. Nothing
imports it from production. It does not read or write a `SiteDoc`, add a schema
version, migrate data, adapt old scripts, change the UI, or perform any effect.
The user must review its design before runtime or storage integration.

## Source and scope

The November 6 typed-data proposal, sections 3–7 and stage C, supplies the
invariants: explicit discriminants, finite JSON, missing distinct from null,
immutable operations, explicit item/index scopes, and one evaluator rather than
separate coercion rules per runtime. Relevant existing sources at the fixed base
`73db53080395af7b9fb18d3fde20277fc86699f4` are:

- [`lib/types.ts`](https://github.com/abshrimp/tsumu/blob/73db53080395af7b9fb18d3fde20277fc86699f4/lib/types.ts): existing `ScriptStep` and unversioned `SiteDoc`. Nearby version-1 metadata is not a document schema.
- [`lib/data.ts`](https://github.com/abshrimp/tsumu/blob/73db53080395af7b9fb18d3fde20277fc86699f4/lib/data.ts): dotted paths, primitive wrapping, filtering and coercing comparisons are existing behavior, not implementations to reuse here.
- [`lib/script-runtime.ts`](https://github.com/abshrimp/tsumu/blob/73db53080395af7b9fb18d3fde20277fc86699f4/lib/script-runtime.ts): existing generated/runtime lookup and text conversion remain untouched.

This first slice implements literal, variable/binding ref, path and template;
`formatScalar`, `parseJson`, `stringifyJson`, `equal`, `isMissing`, two defaults;
array length/map/filter/find; and object get/has/set/remove. The operation table
pairs named operand validation with a typed evaluator; the mapped union makes
missing registrations/operand mismatches compile errors. There is no generic
opcode with positional arguments. UI labels and slot presentation are deferred.

Deferred: `ValueType` declarations/inference, parameter and element roots,
arithmetic, text processing, sorting, other collection operators, statements,
views, effects, execution planning, and full schema-2 document validation. This
module must not be mistaken for a complete stage C or a document validator.

## API and semantics

- `validateExpression(unknown, limits?)` returns a detached validated expression
  or a structured error. Every field is required unless its discriminated shape
  says otherwise. Unknown operations/fields, legacy shapes, invalid references
  and cyclic/non-JSON data are rejected, including in unevaluated branches.
- `evaluateExpression(unknown, variables?, limits?)` validates first, then returns
  `value`, `missing` or `error`. Variables are an own-property dictionary keyed
  by symbol ID. A missing entry is uninitialized, not literal null; no symbol
  declaration table is claimed or inferred. Unused context values are validated.
- Templates accept only strings. Formatting numbers/booleans requires an
  explicit `formatScalar`; null/arrays/objects are rejected. JSON conversion is
  explicit and errors do not become null, zero or an empty string.
- Paths distinguish `["meta.name"]` from `["meta", "name"]`. Arrays require safe
  integer number segments, with negative positions counted from the end; objects
  require string segments. Missing keys/indices return missing, while traversing
  a present scalar/null or using the wrong segment type is an error. Empty get
  paths select the whole value; empty has paths are true for a present value.
- Defaults evaluate their fallback only when needed, never catch errors, and
  differ on null. Equality is deep and typed; object key order is irrelevant,
  array order matters, and missing is not a value to compare. Numbers are finite
  IEEE 754 values; negative zero normalizes to zero at JSON boundaries.
- Each lambda ID has one owner in the expression tree. Its binding exists only
  in its body. Nested bodies can explicitly reference outer IDs; no shadowing or
  implicit lookup by display name occurs. Index is zero-based. Map preserves all
  JSON kinds; filter/find require booleans. Find returns the original first item
  and does not execute later predicates. Invalid later *JSON input* still fails
  the initial validation. A missing map result cannot become an array hole.
- Object operations also traverse arrays. Set/remove require a nonempty path.
  Set copies the path and optionally creates missing parents, choosing object
  versus array from the next segment. It never replaces a present scalar/null
  parent implicitly. Array set can replace an existing index or append exactly
  at length, never create a hole; remove compacts arrays. Missing remove paths
  are no-ops. These array/update rules are provisional review choices, not
  inferred legacy semantics.
- Dictionaries use null prototypes. `__proto__`, `constructor`, `prototype`,
  dots, quotes and empty keys are ordinary safe own keys. No inherited property
  lookup or prototype mutation occurs. Every successful result is a detached
  finite JSON tree; neither source inputs nor aliases change. Readonly types
  discourage mutation, but value outputs are not recursively frozen. The shared
  missing result is frozen so callers cannot change future evaluations.
- Errors contain code, an expression JSON Pointer and optional type names, not
  input values, payload keys or native parse messages. Invalid JSON snapshots
  point to the containing expression/input boundary rather than expose data keys.
  A lambda error points to its body;
  iteration indices and script/step IDs await a later integration wrapper.

## Bounds and trust boundary

Inputs are JSON data supplied as plain data objects/arrays, not arbitrary hostile
JavaScript objects. Accessors, `toJSON` functions, custom object prototypes,
symbols, sparse arrays, cycles, undefined and nonfinite numbers are rejected.
Ordinary accessors are inspected without invoking them, including in limits.
JavaScript Proxy traps cannot be safely detected without invoking traps; Proxy
objects are outside this API contract. A future untrusted transport must parse
JSON before calling this module, rather than pass executable objects.

One budget spans snapshots, validation, execution, path copies and detached
output. Hard ceilings are depth 64, 100,000 work steps, 20,000 snapshotted JSON
nodes and 1,000,000 UTF-16 text units including keys. Callers can only lower them.
These are conservative draft values, not production policy. Shared aliases are
expanded and counted; expensive loops/copies consume work steps. Template
parts consume steps even when empty, before iteration; concatenation is charged
before joining. Equality charges string lengths and collection scans, including
early mismatches. Internal immutable records retain their validated key lists,
so repeated comparisons do not re-enumerate keys outside the work budget.
Every parse invocation charges its source text and work before native parsing.
JSON stringify preflights expanded
size/depth before allocating its output. Native JSON parse first allocates a
tree from a text-bounded string, then checks node/depth/finite-value limits; it
is not a streaming parser and does not promise a pre-allocation node limit.
Budgets are deterministic resource guards, not wall-clock deadlines.

## Focused verification

Synthetic tests cover JSON round trips, literal braces, wrong/absent types,
negative indices, explicit conversion, lazy defaults and find, lexical scopes,
immutable updates, dangerous keys, malformed AST/JSON, limits and determinism.
Run only the focused checks while reviewing this isolated foundation:

```sh
node --import tsx --test tests/script-model.test.mts
node node_modules/typescript/bin/tsc --ignoreConfig --noEmit --strict \
  --target ES2020 --module esnext --moduleResolution bundler --skipLibCheck \
  --types node --allowImportingTsExtensions lib/script-model/*.ts tests/script-model.test.mts
```

No production datasets, network requests, migrations, builds, heavyweight suites,
deployments or remote publication are needed for this draft. Later integration
must separately establish preview/server/generated-client parity and the complete
document/storage/migration boundary; this test pass does not establish them.
