import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  PLAN_BASELINE,
  ownerFor,
  findOverlaps,
  summarizeChecks,
  summarizePr,
  snapshot,
  toMarkdown,
  createApi,
} from '../scripts/audit/coordination.mjs';

const MAIN = 'f'.repeat(40);

test('M ownership table routes critical boundaries and shared configuration', () => {
  const cases: Array<[string, string, boolean]> = [
    ['app/api/auth/[...nextauth]/route.ts', 'A', false],
    ['app/api/doc/route.ts', 'B', false],
    ['lib/script-runtime.ts', 'C', false],
    ['components/canvas/NodeView.tsx', 'D', false],
    ['lib/html-zip-guard.ts', 'E', false],
    ['lib/generator/react-export.ts', 'F', false],
    ['app/api/publish/route.ts', 'G', false],
    ['lib/safe-fetch.ts', 'H', false],
    ['.github/workflows/ci.yml', 'I', true],
    ['package.json', 'I', true],
    ['lib/types.ts', 'B', true],
    ['scripts/audit/coordination.mjs', 'M', false],
    ['tests/audit-coordination.test.mts', 'M', false],
    ['e2e/import-site.spec.ts', 'E', false],
  ];
  for (const [path, owner, shared] of cases) {
    assert.deepEqual(ownerFor(path), { owner, shared }, path);
  }
  assert.throws(() => ownerFor(''), TypeError);
});

test('M finds exact, case-insensitive and Unicode-normalized overlaps', () => {
  const overlap = findOverlaps([
    { number: 1, files: ['lib/merge.ts', 'lib/Café.ts', 'app/a.ts'] },
    { number: 2, files: ['LIB/MERGE.TS', 'lib/Cafe\u0301.ts', 'app/b.ts'] },
    { number: 3, files: ['app/c.ts', 'app/c.ts'] },
  ]);
  assert.deepEqual(overlap.map((o) => [o.prs, o.pathSpellingDiffers]), [
    [[1, 2], true],
    [[1, 2], true],
  ]);
  assert.equal(findOverlaps([{ number: 4, files: ['x', 'x'] }]).length, 0);
  assert.equal(findOverlaps([]).length, 0);
});

test('M check evidence is fail closed for pending, missing and failed runs', () => {
  assert.deepEqual(summarizeChecks(), { state: 'unknown', observed: 0, outstanding: [] });
  assert.equal(summarizeChecks([{ name: 'test', status: 'completed', conclusion: 'success' }]).state,
    'observed-complete');
  assert.equal(summarizeChecks([{ name: 'test', status: 'completed', conclusion: 'skipped' }]).state,
    'not-passed');
  assert.equal(summarizeChecks([{ name: 'test', status: 'in_progress', conclusion: null }]).state,
    'not-passed');
  assert.equal(summarizeChecks([{ name: 'test', status: 'completed', conclusion: 'failure' }]).state,
    'not-passed');
});

test('M finds baseline conflicts and flags a shared file without implying PR failure', () => {
  const s = summarizePr({
    files: ['lib/types.ts', 'lib/merge.ts', 'tests/merge-cases.test.mts', 'components/StylePanel.tsx'],
  }, ['LIB/TYPES.TS']);
  assert.deepEqual(s.baselineDrift, ['lib/types.ts']);
  assert.deepEqual(s.shared, ['lib/types.ts']);
  assert.ok(s.crossArea);
});

function fixtureApi({ move = false, withChecks = true } = {}) {
  let mainReads = 0;
  const prs = [
    { number: 101, title: 'test-A', html_url: 'https://github.com/x/y/pull/101',
      draft: true, head: { sha: 'a'.repeat(40) }, base: { sha: MAIN } },
    { number: 102, title: 'test-B', html_url: 'https://github.com/x/y/pull/102',
      draft: false, head: { sha: 'b'.repeat(40) }, base: { sha: MAIN } },
  ];
  return {
    async pages(_repo: string, suffix: string) {
      if (suffix === '/pulls?state=open') return prs;
      if (suffix === '/issues?state=open')
        return [{ number: 101, pull_request: {} },
          { number: 3, title: 'bug', html_url: 'https://github.com/x/y/issues/3' }];
      if (suffix === '/pulls/101/files')
        return [{ filename: 'lib/types.ts' }, { filename: 'lib/old.ts', previous_filename: 'lib/renamed.ts' }];
      if (suffix === '/pulls/102/files')
        return [{ filename: 'LIB/TYPES.TS' }, { filename: 'lib/renamed.ts' }];
      throw new Error('Unexpected collection ' + suffix);
    },
    async request(_repo: string, suffix: string) {
      if (suffix === '/git/ref/heads/main') {
        mainReads++;
        return { object: { sha: move && mainReads === 2 ? 'e'.repeat(40) : MAIN } };
      }
      if (suffix.startsWith('/compare/'))
        return { files: [{ filename: 'lib/types.ts' }] };
      if (suffix.startsWith('/commits/'))
        return { total_count: 1, check_runs: withChecks ? [
          { name: 'CI', status: 'completed', conclusion: 'success' },
        ] : [] };
      throw new Error('Unexpected request ' + suffix);
    },
  };
}

test('M snapshot separates issues from PRs and tracks renamed and shared paths', async () => {
  const data = await snapshot({ repo: 'x/y', baseline: PLAN_BASELINE, api: fixtureApi() });
  assert.equal(data.head, MAIN);
  assert.equal(data.stale, false);
  assert.equal(data.issues.length, 1);
  assert.equal(data.prs.length, 2);
  assert.deepEqual(data.overlaps.map((o) => o.prs), [[101, 102], [101, 102]]);
  assert.equal(data.prs[0].baselineDrift[0], 'lib/types.ts');
  assert.equal(data.prs[0].checks.state, 'observed-complete');
  assert.match(data.security, /not verified/);
  assert.match(toMarkdown(data), /not merge authorization/i);
});

test('M marks in-flight main changes and absent checks as not verified', async () => {
  const data = await snapshot({ repo: 'x/y', api: fixtureApi({ move: true, withChecks: false }) });
  assert.equal(data.stale, true);
  assert.equal(data.prs[0].checks.state, 'unknown');
  assert.match(toMarkdown(data), /rerun required/);
});

test('M refuses invalid repository IDs and incomplete baseline SHAs', async () => {
  await assert.rejects(() => snapshot({ repo: 'x', api: fixtureApi() }), /owner\/name/);
  await assert.rejects(() => snapshot({ repo: 'x/y', baseline: 'abc', api: fixtureApi() }),
    /full 40-hex SHA/);
});

test('M API client rejects server errors and impossible pagination response types', async () => {
  const bad = createApi(async () => ({ ok: false, status: 403 }), '');
  await assert.rejects(() => bad.request('x/y', '/issues'), /403/);
  const malformed = createApi(async () => ({ ok: true, json: async () => ({}) }), '');
  await assert.rejects(() => malformed.pages('x/y', '/issues'), /Expected an array/);
});
