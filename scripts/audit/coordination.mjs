#!/usr/bin/env node
/**
 * Read-only live coordination report for the Tsumu audit.
 * Usage: node scripts/audit/coordination.mjs [--repo owner/name]
 *        [--baseline 40-hex-SHA] [--json] [--strict-overlap]
 *
 * The output is evidence about a point in time, never merge authorization.
 */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const PLAN_BASELINE = '1ba32974d4b5ecf441e36428e765d0542207c421';
export const DEFAULT_REPO = 'abshrimp/tsumu';

const COMMON = new Set([
  'lib/types.ts', 'lib/i18n.ts', 'lib/locales/en.ts',
  'package.json', 'package-lock.json', 'tsconfig.json',
]);

/** Provisional file owner, not a file lock or permission to edit it. */
export function ownerFor(path) {
  if (typeof path !== 'string' || path.length === 0) throw new TypeError('Expected a path');
  const p = path.toLowerCase().normalize('NFC');
  if (/^(docs\/audit\/|scripts\/audit\/|tests\/audit-coordination)/.test(p))
    return { owner: 'M', shared: false };
  const documentOwner = /^docs\/audits\/([a-j])[-.]/.exec(p);
  if (documentOwner) return { owner: documentOwner[1].toUpperCase(), shared: false };
  if (p.startsWith('.github/') || p.startsWith('scripts/') || p === '.dockerignore' ||
      /^(package(-lock)?\.json|tsconfig\.json|dockerfile|wrangler\.jsonc|custom-worker\.ts|open-next\.config\.ts|next\.config\.mjs|\.nvmrc)$/.test(p))
    return { owner: 'I', shared: true };
  if (/^(auth\.ts|middleware\.ts)$/.test(p) ||
      /^lib\/(auth-|allowlist|anonymous|csrf|asset-token)/.test(p) ||
      /^app\/api\/(auth|allowed-users)\//.test(p))
    return { owner: 'A', shared: COMMON.has(p) };
  if (/^app\/api\/(ai|fetch-json)\//.test(p) ||
      /^lib\/(ai\/|aiops|safe-fetch|fetch-request|fetch-preview|read-json-request)/.test(p))
    return { owner: 'H', shared: COMMON.has(p) };
  if (/^app\/api\/publish\//.test(p) ||
      /^lib\/(github|publish-)/.test(p) || p === 'components/publishmodal.tsx')
    return { owner: 'G', shared: COMMON.has(p) };
  if (p.startsWith('lib/generator/') || /^lib\/(generator\.ts|export|url-policy)/.test(p) ||
      p.startsWith('skills/tsumu-site/'))
    return { owner: 'F', shared: COMMON.has(p) };
  if (/^lib\/(html-|import-|imported-|site-import|zip-|css-assets|css-asset|assets|asset-upload|asset-usage|asset-display|asset-window|srcset)/.test(p) ||
      /^app\/api\/assets\//.test(p) ||
      /^components\/(imagepicker|left-panel\/assetstab)/.test(p))
    return { owner: 'E', shared: COMMON.has(p) };
  if (/^lib\/(filter-edit|page-load-steps|page-query)/.test(p))
    return { owner: 'C', shared: COMMON.has(p) };
  if (/^components\/(scripteditor|script-editor\/|varexplorer)/.test(p) ||
      /^lib\/(script|script-model\/|value-semantics|vars|variable-choice)/.test(p))
    return { owner: 'C', shared: COMMON.has(p) };
  if (/^components\/(canvas|editor|stylepanel|style-panel\/|motioneditors|frame|rightpanel|leftpanel|pagepanel)/.test(p) ||
      /^lib\/(canvas-|style|motion|keyframes|breakpoints|easing)/.test(p))
    return { owner: 'D', shared: COMMON.has(p) };
  if (/^app\/api\/(doc|sites|collab|comments|activity)\//.test(p) ||
      /^lib\/(doc-|store|db\.ts|kv\.ts|merge|collab|local-|node-storage|cloud-save|site|sites|types\.ts|portable-doc|comment)/.test(p))
    return { owner: 'B', shared: COMMON.has(p) };
  if (p.startsWith('app/api/')) return { owner: 'A', shared: COMMON.has(p) };
  if (p.startsWith('app/')) return { owner: 'D', shared: false };
  if (/^components\/(aiactivity|aichat)/.test(p)) return { owner: 'H', shared: false };
  if (/^components\/(allowedaccounts|googlesignin|useravatar)/.test(p))
    return { owner: 'A', shared: false };
  if (/^components\/(comments|copytosite|dataview)/.test(p))
    return { owner: 'B', shared: false };
  if (p.startsWith('components/')) return { owner: 'D', shared: false };
  if (/^lib\/(activity|data\.ts|fields|storage-keys)/.test(p))
    return { owner: 'B', shared: COMMON.has(p) };
  if (/^lib\/(resource-integrity)/.test(p)) return { owner: 'E', shared: false };
  if (/^lib\/(env\.ts|errors\.ts|server\.ts|status\.ts|unavailable\.ts)/.test(p))
    return { owner: 'I', shared: false };
  if (p.startsWith('lib/')) return { owner: 'D', shared: COMMON.has(p) };
  if (p.startsWith('tests/') || p.startsWith('e2e/')) {
    if (/(auth|csrf|allowed-user|api-)/.test(p)) return { owner: 'A', shared: false };
    if (/(import|zip|asset|html-to-site)/.test(p)) return { owner: 'E', shared: false };
    if (/(export|generator|generated|ssr)/.test(p)) return { owner: 'F', shared: false };
    if (/(script|runtime|value-semantics|recipe|condition)/.test(p)) return { owner: 'C', shared: false };
    if (/(canvas|style|motion|editor|layout)/.test(p)) return { owner: 'D', shared: false };
    if (/(publish|github)/.test(p)) return { owner: 'G', shared: false };
    if (/(ai-|fetch|network|safe-fetch)/.test(p)) return { owner: 'H', shared: false };
    if (/(collab|store|persist|site|doc-|merge|save)/.test(p)) return { owner: 'B', shared: false };
    return { owner: 'J', shared: false };
  }
  return { owner: 'M-review', shared: COMMON.has(p) };
}

function normalized(path) {
  return path.normalize('NFC').toLowerCase();
}

/** Include renamed-file old paths; a case-folding collision is also an overlap. */
export function findOverlaps(prs) {
  const paths = new Map();
  for (const pr of prs) {
    const seen = new Set();
    for (const path of pr.files || []) {
      const key = normalized(path);
      if (seen.has(key)) continue;
      seen.add(key);
      const entries = paths.get(key) || [];
      entries.push({ number: pr.number, path });
      paths.set(key, entries);
    }
  }
  return [...paths.values()]
    .filter((entries) => new Set(entries.map((x) => x.number)).size > 1)
    .map((entries) => ({
      path: entries[0].path,
      prs: [...new Set(entries.map((x) => x.number))].sort((a, b) => a - b),
      pathSpellingDiffers: new Set(entries.map((x) => x.path)).size > 1,
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

/** Observed checks are not the same thing as branch-protection requirements. */
export function summarizeChecks(runs) {
  if (!Array.isArray(runs) || runs.length === 0)
    return { state: 'unknown', observed: 0, outstanding: [] };
  const outstanding = runs
    .filter((x) => x.status !== 'completed' ||
      !['success', 'neutral', 'skipped'].includes(x.conclusion))
    .map((x) => ({ name: x.name || 'unnamed', status: x.status || 'unknown',
      conclusion: x.conclusion || null }));
  return { state: outstanding.length ? 'not-passed' : 'observed-complete',
    observed: runs.length, outstanding };
}

export function summarizePr(pr, baselinePaths = []) {
  const base = new Set(baselinePaths.map(normalized));
  const files = pr.files || [];
  const areas = [...new Set(files.map((file) => ownerFor(file).owner))].sort();
  return {
    areas,
    shared: files.filter((path) => ownerFor(path).shared),
    baselineDrift: files.filter((path) => base.has(normalized(path))),
    crossArea: areas.length > 1,
  };
}

function parseRepo(repo) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo))
    throw new Error('Repository must be owner/name');
  return repo;
}

export function createApi(get = globalThis.fetch, token = process.env.GITHUB_TOKEN) {
  async function request(repo, suffix) {
    const response = await get('https://api.github.com/repos/' + parseRepo(repo) + suffix, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'tsumu-audit-M',
        ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error('GitHub API ' + response.status + ': ' + suffix);
    return response.json();
  }
  async function pages(repo, suffix) {
    const results = [];
    for (let page = 1; page <= 20; page++) {
      const joiner = suffix.includes('?') ? '&' : '?';
      const batch = await request(repo, suffix + joiner + 'per_page=100&page=' + page);
      if (!Array.isArray(batch)) throw new Error('Expected an array: ' + suffix);
      results.push(...batch);
      if (batch.length < 100) return results;
    }
    throw new Error('Pagination limit reached: incomplete result for ' + suffix);
  }
  return { request, pages };
}

export async function snapshot({ repo = DEFAULT_REPO, baseline = PLAN_BASELINE,
  api = createApi() } = {}) {
  parseRepo(repo);
  if (!/^[0-9a-f]{40}$/i.test(baseline)) throw new Error('Baseline must be full 40-hex SHA');
  const before = await api.request(repo, '/git/ref/heads/main');
  const head = before.object?.sha;
  if (!/^[0-9a-f]{40}$/i.test(head || '')) throw new Error('Could not resolve main SHA');
  const [open, allIssues] = await Promise.all([
    api.pages(repo, '/pulls?state=open'),
    api.pages(repo, '/issues?state=open'),
  ]);
  let changed = [], compareNote = 'same commit';
  if (head !== baseline) {
    try {
      const comparison = await api.request(repo, '/compare/' + baseline + '...' + head);
      changed = (comparison.files || []).flatMap((x) =>
        x.previous_filename ? [x.filename, x.previous_filename] : [x.filename]);
      compareNote = comparison.files?.length >= 300 ?
        'possibly incomplete: GitHub compare caps listed files at 300' : 'delta observed';
    } catch (error) {
      compareNote = 'not verified: ' + error.message;
    }
  }
  const prs = await Promise.all(open.map(async (pr) => {
    const detail = await api.pages(repo, '/pulls/' + pr.number + '/files');
    const files = [...new Set(detail.flatMap((x) =>
      x.previous_filename ? [x.filename, x.previous_filename] : [x.filename]))];
    let checks = summarizeChecks(), checksNote = null;
    try {
      const result = await api.request(repo, '/commits/' + pr.head.sha + '/check-runs?per_page=100');
      checks = summarizeChecks(result.check_runs);
      if (result.total_count > result.check_runs.length)
        checksNote = 'check runs truncated; cannot treat result as complete';
    } catch (error) {
      checksNote = error.message;
    }
    return {
      number: pr.number, title: pr.title, url: pr.html_url, draft: pr.draft,
      head: pr.head.sha, base: pr.base.sha,
      mergeable: typeof pr.mergeable === 'boolean' ? pr.mergeable : 'unknown',
      files, checks, checksNote, ...summarizePr({ files }, changed),
    };
  }));
  // Detect races while querying, but never silently substitute the later SHA.
  const [after, latestOpen] = await Promise.all([
    api.request(repo, '/git/ref/heads/main'),
    api.pages(repo, '/pulls?state=open'),
  ]);
  const liveHeads = new Map(latestOpen.map((pr) => [pr.number, pr.head.sha]));
  const stale = head !== after.object?.sha || prs.length !== latestOpen.length ||
    prs.some((pr) => liveHeads.get(pr.number) !== pr.head);
  return {
    observedAt: new Date().toISOString(), repo, baseline, head, stale,
    changed, compareNote,
    issues: allIssues.filter((issue) => !issue.pull_request).map((issue) =>
      ({ number: issue.number, title: issue.title, url: issue.html_url })),
    prs, overlaps: findOverlaps(prs),
    security: 'not verified: review CodeQL, Dependabot and other scanning separately',
    independence: 'not verified: reviewer must differ from implementer',
  };
}

export function toMarkdown(s) {
  const lines = [
    '# Audit M: live snapshot (read-only)',
    '',
    '- UTC observed: ' + s.observedAt,
    '- Repository: ' + s.repo,
    '- Plan baseline: ' + s.baseline,
    '- Main SHA at start: ' + s.head,
    '- Snapshot stable while fetched: ' + (!s.stale ? 'yes' : 'NO — rerun required'),
    '- Changes since baseline: ' + s.changed.length + ' paths (' + s.compareNote + ')',
    '- Open issues (excluding PRs): ' + s.issues.length,
    '- Security alerts: ' + s.security,
    '- Independent verification: ' + s.independence,
    '',
    '| PR | State | Head check runs | Primary areas | Shared paths | Baseline drift |',
    '| --- | --- | --- | --- | ---: | ---: |',
  ];
  for (const pr of s.prs)
    lines.push('| [#' + pr.number + '](' + pr.url + ') | ' +
      (pr.draft ? 'draft' : 'open') + ', mergeability=' + pr.mergeable +
      ' | ' + pr.checks.state + ' (' + pr.checks.observed + ')' +
      ' | ' + pr.areas.join(', ') + ' | ' + pr.shared.length +
      ' | ' + pr.baselineDrift.length + ' |');
  lines.push('', '## Exact or case-insensitive shared PR paths', '');
  if (!s.overlaps.length) lines.push('None in the currently open PRs.');
  for (const item of s.overlaps)
    lines.push('- ' + item.path + ': ' + item.prs.map((n) => '#' + n).join(', ') +
      (item.pathSpellingDiffers ? ' (spelling/case differs)' : ''));
  lines.push('', '## Manual review flags', '');
  for (const pr of s.prs) {
    const flags = [];
    if (pr.draft) flags.push('draft');
    if (pr.mergeable !== true) flags.push('mergeability not established');
    if (pr.shared.length) flags.push('shared files: ' + pr.shared.join(', '));
    if (pr.crossArea) flags.push('cross-area ownership');
    if (pr.baselineDrift.length) flags.push('main changed the same paths since audit baseline');
    if (pr.checks.state !== 'observed-complete') flags.push('checks incomplete/unknown');
    if (pr.checksNote) flags.push('check data incomplete: ' + pr.checksNote);
    lines.push('- #' + pr.number + ': ' +
      (flags.length ? flags.join('; ') : 'still requires security and independent review'));
  }
  lines.push('', 'This is not merge authorization. Verify required CI and CodeQL for the exact head, independent review, no outstanding severe findings, and integrated-main retesting.');
  return lines.join('\n') + '\n';
}

async function runCli() {
  const args = process.argv.slice(2);
  const flagSet = new Set(['--repo', '--baseline', '--json', '--strict-overlap']);
  if (args.some((x) => x.startsWith('--') && !flagSet.has(x)))
    throw new Error('Unknown flag (supported: --repo, --baseline, --json, --strict-overlap)');
  const argument = (name, fallback) => {
    const index = args.indexOf(name);
    if (index < 0) return fallback;
    if (!args[index + 1] || args[index + 1].startsWith('--'))
      throw new Error('Missing value for ' + name);
    return args[index + 1];
  };
  const data = await snapshot({
    repo: argument('--repo', DEFAULT_REPO),
    baseline: argument('--baseline', PLAN_BASELINE),
  });
  process.stdout.write(args.includes('--json') ?
    JSON.stringify(data, null, 2) + '\n' : toMarkdown(data));
  if (data.stale || data.compareNote.startsWith('not verified') ||
      data.prs.some((pr) => pr.checksNote))
    process.exitCode = 2;
  if (args.includes('--strict-overlap') && data.overlaps.length)
    process.exitCode = 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runCli().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
