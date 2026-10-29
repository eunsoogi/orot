import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  assertMainDispatch,
  classifyExistingVersionPr,
  compareVersions,
  parseVersion,
  planVersionUpdate,
  readAuthoritativeVersion,
  versionPrDetails,
} from '../metadata.mjs';

const projectFile = [
  '\t\t\tCURRENT_PROJECT_VERSION = 1;',
  '\t\t\tMARKETING_VERSION = 0.1.0;',
  '\t\t\tCURRENT_PROJECT_VERSION = 1;',
  '\t\t\tMARKETING_VERSION = 0.1.0;',
].join('\n');

function planFor(version, overrides = {}) {
  return planVersionUpdate({
    version,
    rootManifestSource: JSON.stringify(
      { name: 'orot', version: '0.1.0', dependencies: { react: '19.2.3' } },
      null,
      2,
    ),
    mobileManifestSource: JSON.stringify(
      { name: '@orot/mobile', version: '0.0.1', dependencies: { react: '19.2.3' } },
      null,
      2,
    ),
    workspaceManifests: [
      {
        path: 'packages/zeta/package.json',
        source: JSON.stringify({ name: '@orot/zeta', version: '0.1.0' }, null, 2),
      },
      {
        path: 'packages/domain/package.json',
        source: JSON.stringify({ name: '@orot/domain', version: '0.1.0' }, null, 2),
      },
    ],
    projectFile,
    ...overrides,
  });
}

test('accepts only numeric major.minor.patch inputs and compares large components safely', () => {
  assert.deepEqual(parseVersion('0.1.1'), [0n, 1n, 1n]);
  assert.equal(compareVersions('0.10.0', '0.9.99'), 1);
  assert.equal(compareVersions('999999999999999999999.0.0', '2.0.0'), 1);

  for (const invalid of [
    'v1.2.3',
    '1.2',
    '1.2.3-rc.1',
    '01.2.3',
    '1.02.3',
    '1.2.03',
    '1.2.3;echo bad',
  ]) {
    assert.throws(() => parseVersion(invalid), /numeric major\.minor\.patch/);
  }
});

test('accepts only workflow_dispatch runs selected from main', () => {
  assert.doesNotThrow(() =>
    assertMainDispatch({ eventName: 'workflow_dispatch', ref: 'refs/heads/main' }),
  );
  assert.throws(
    () => assertMainDispatch({ eventName: 'workflow_dispatch', ref: 'refs/heads/feature' }),
    /only be dispatched from main/,
  );
  assert.throws(
    () => assertMainDispatch({ eventName: 'push', ref: 'refs/heads/main' }),
    /only run from workflow_dispatch/,
  );
});

test('requires the root version and both iOS marketing versions to agree', () => {
  assert.equal(
    readAuthoritativeVersion({ rootManifest: { version: '0.1.0' }, projectFile }),
    '0.1.0',
  );
  assert.throws(
    () =>
      readAuthoritativeVersion({
        rootManifest: { version: '0.1.0' },
        projectFile: projectFile.replace('0.1.0', '0.2.0'),
      }),
    /version-source disagreement/,
  );
  assert.throws(
    () =>
      readAuthoritativeVersion({
        rootManifest: { version: '0.1.0' },
        projectFile: 'MARKETING_VERSION = 0.1.0;',
      }),
    /expected exactly two/,
  );
});

test('treats an already-current version as a no-op and rejects stale versions', () => {
  assert.equal(planFor('0.1.0').status, 'current');
  assert.throws(() => planFor('0.0.9'), /is stale/);
});

test('updates only version fields and leaves dependencies, build counters, and lock data out of the plan', () => {
  const plan = planFor('0.1.1');
  assert.equal(plan.status, 'update');
  assert.equal(plan.currentVersion, '0.1.0');
  assert.deepEqual(
    plan.updates.map((update) => update.path),
    [
      'package.json',
      'apps/mobile/package.json',
      'packages/domain/package.json',
      'packages/zeta/package.json',
      'apps/mobile/ios/OrotMobile.xcodeproj/project.pbxproj',
    ],
  );

  const root = JSON.parse(plan.updates[0].content);
  const mobile = JSON.parse(plan.updates[1].content);
  assert.equal(root.version, '0.1.1');
  assert.equal(root.dependencies.react, '19.2.3');
  assert.equal(mobile.version, '0.1.1');
  assert.equal(mobile.dependencies.react, '19.2.3');
  for (const update of plan.updates.slice(2, 4))
    assert.equal(JSON.parse(update.content).version, '0.1.1');
  assert.equal((plan.updates[4].content.match(/MARKETING_VERSION = 0\.1\.1;/g) ?? []).length, 2);
  assert.equal((plan.updates[4].content.match(/CURRENT_PROJECT_VERSION = 1;/g) ?? []).length, 2);
  assert.ok(plan.updates.every((update) => !update.path.includes('pnpm-lock')));
});

test('preserves unrelated manifest formatting while changing its version', () => {
  const rootManifestSource =
    '{\r\n  "name": "orot",\r\n  "version" : "0.1.0",\r\n  "keywords": ["orot", "health"],\r\n  "metadata": {"version":"nested"},\r\n  "dependencies": {"react": "19.2.3"}\r\n}\r\n';
  const plan = planFor('0.1.1', { rootManifestSource });

  assert.equal(
    plan.updates[0].content,
    rootManifestSource.replace('"version" : "0.1.0"', '"version" : "0.1.1"'),
  );
});

test('reuses only the matching open version PR and refuses conflicting refs', () => {
  const details = versionPrDetails('0.1.1');
  const matchingPullRequest = {
    base: { ref: 'main' },
    head: { ref: details.branch, repo: { full_name: 'eunsoogi/orot' } },
    title: details.title,
    state: 'open',
    draft: true,
    body: `Updates Orot version metadata to 0.1.1.\n${details.marker}`,
    html_url: 'https://github.com/eunsoogi/orot/pull/200',
  };

  assert.deepEqual(
    classifyExistingVersionPr({
      pullRequests: [matchingPullRequest],
      branchExists: true,
      repository: 'eunsoogi/orot',
      version: '0.1.1',
    }),
    { action: 'reuse', url: matchingPullRequest.html_url, branch: details.branch },
  );
  assert.deepEqual(
    classifyExistingVersionPr({
      pullRequests: [],
      branchExists: false,
      repository: 'eunsoogi/orot',
      version: '0.1.1',
    }),
    { action: 'create', branch: details.branch, title: details.title, marker: details.marker },
  );
  assert.throws(
    () =>
      classifyExistingVersionPr({
        pullRequests: [],
        branchExists: true,
        repository: 'eunsoogi/orot',
        version: '0.1.1',
      }),
    /refusing to overwrite/,
  );
  assert.throws(
    () =>
      classifyExistingVersionPr({
        pullRequests: [{ ...matchingPullRequest, title: 'unrelated PR' }],
        branchExists: true,
        repository: 'eunsoogi/orot',
        version: '0.1.1',
      }),
    /does not match/,
  );
  assert.throws(
    () =>
      classifyExistingVersionPr({
        pullRequests: [{ ...matchingPullRequest, body: details.marker }],
        branchExists: true,
        repository: 'eunsoogi/orot',
        version: '0.1.1',
      }),
    /does not match/,
  );
});

test('version workflow keeps tests read-only and grants write access only to the dispatch PR job', () => {
  const workflow = readFileSync(
    new URL('../../../.github/workflows/version-pr.yml', import.meta.url),
    'utf8',
  );
  assert.match(workflow, /pull_request:[\s\S]*branches: \[main\]/);
  assert.match(workflow, /permissions:\s+contents: read/);
  assert.match(workflow, /create_pr:[\s\S]*permissions:\s+contents: write\s+pull-requests: write/);
  assert.match(workflow, /ensure_metadata:[\s\S]*issues: write\s+pull-requests: read/);
  assert.match(
    workflow,
    /if: github\.event_name == 'workflow_dispatch' && github\.ref == 'refs\/heads\/main'/,
  );
  assert.match(workflow, /run-version-pr\.mjs --validate-only/);
  assert.match(workflow, /node scripts\/version\/run-version-pr\.mjs$/m);
  assert.match(workflow, /node scripts\/version\/ensure-pr-metadata\.mjs$/m);
  assert.doesNotMatch(workflow, /pull_request_target:/);
});
