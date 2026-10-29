import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import test from 'node:test';
import { versionPrDetails } from '../metadata.mjs';

const repository = 'eunsoogi/orot';
const url = `https://github.com/${repository}/pull/200`;
const metadataScript = new URL('../ensure-pr-metadata.mjs', import.meta.url).pathname;
const creationModule = new URL('../github-pr.mjs', import.meta.url).href;

// The subprocess resolves this local CLI substitute; fixtures never contact GitHub.
function runFixture(args, responses, env = {}) {
  const root = mkdtempSync(join(tmpdir(), 'orot-version-pr-'));
  const statePath = join(root, 'state.json');
  const output = join(root, 'output');
  writeFileSync(output, '');
  writeFileSync(statePath, JSON.stringify({ responses, calls: [] }));
  writeFileSync(
    join(root, 'gh'),
    `#!/usr/bin/env node
const fs = require('node:fs');
const state = JSON.parse(fs.readFileSync(process.env.FIXTURE_STATE, 'utf8'));
state.calls.push(process.argv.slice(2));
const response = state.responses.shift();
fs.writeFileSync(process.env.FIXTURE_STATE, JSON.stringify(state));
if (!response) process.exit(90);
process.stdout.write(typeof response === 'string' ? response : JSON.stringify(response));
`,
    { mode: 0o755 },
  );
  try {
    const result = spawnSync(process.execPath, args, {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${root}${delimiter}${process.env.PATH}`,
        GH_TOKEN: '',
        GITHUB_TOKEN: '',
        GITHUB_OUTPUT: output,
        FIXTURE_STATE: statePath,
        GITHUB_REPOSITORY: repository,
        PULL_REQUEST_URL: url,
        ...env,
      },
    });
    const state = JSON.parse(readFileSync(statePath, 'utf8'));
    return { ...result, ...state, output: readFileSync(output, 'utf8') };
  } finally {
    for (const file of ['gh', 'state.json', 'output']) unlinkSync(join(root, file));
    rmdirSync(root);
  }
}

function prFor(version) {
  const details = versionPrDetails(version);
  return {
    html_url: url,
    title: details.title,
    body: details.body,
    state: 'open',
    draft: true,
    base: { ref: 'main' },
    head: { ref: details.branch, repo: { full_name: repository } },
  };
}

for (const version of ['0.3.0', '12.34.56']) {
  test(`creation CLI receives the requested ${version} identity without a milestone or closing issue`, () => {
    const details = versionPrDetails(version);
    const program = `import { createVersionPullRequest } from ${JSON.stringify(creationModule)};
createVersionPullRequest(${JSON.stringify(repository)}, ${JSON.stringify(details)}, ${JSON.stringify(version)});`;
    const result = runFixture(['--input-type=module', '-e', program], [url]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.calls.length, 1);
    const call = result.calls[0];
    assert.deepEqual(call.slice(0, 8), [
      'pr',
      'create',
      '--repo',
      repository,
      '--base',
      'main',
      '--head',
      details.branch,
    ]);
    assert.equal(call[call.indexOf('--title') + 1], details.title);
    const body = call[call.indexOf('--body') + 1];
    assert.ok(body.includes(`Updates Orot version metadata to ${version}.`));
    assert.ok(body.includes(details.marker));
    assert.doesNotMatch(body, /(?:Fixes|Closes|Resolves) #\d+/i);
    assert.ok(call.includes('--draft'));
    assert.ok(!call.includes('--milestone'));
  });

  for (const milestone of [null, { number: 42, title: 'Maintainer selection' }]) {
    test(`metadata CLI preserves ${milestone ? 'manual milestone' : 'no milestone'} for ${version}`, () => {
      const pr = prFor(version);
      const before = {
        labels: [{ name: 'existing-label' }],
        assignees: [{ login: 'existing-owner' }],
        milestone,
      };
      const after = {
        labels: ['existing-label', 'area/foundation', 'type/ci', 'priority/p1'].map((name) => ({
          name,
        })),
        assignees: ['existing-owner', 'eunsoogi'].map((login) => ({ login })),
        milestone,
      };
      const result = runFixture([metadataScript], [pr, before, after, after, pr], {
        OROT_VERSION: version,
      });
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(
        result.calls.filter((call) => !call.includes('PATCH')),
        [
          ['api', `repos/${repository}/pulls/200`],
          ['api', `repos/${repository}/issues/200`],
          ['api', `repos/${repository}/issues/200`],
          ['api', `repos/${repository}/pulls/200`],
        ],
      );
      const patch = result.calls.find((args) => args.includes('PATCH'));
      assert.deepEqual(patch, [
        'api',
        '--method',
        'PATCH',
        `repos/${repository}/issues/200`,
        '-f',
        'assignees[]=existing-owner',
        '-f',
        'assignees[]=eunsoogi',
        '-f',
        'labels[]=existing-label',
        '-f',
        'labels[]=area/foundation',
        '-f',
        'labels[]=type/ci',
        '-f',
        'labels[]=priority/p1',
      ]);
      assert.ok(result.calls.every((call) => !call.some((arg) => arg.includes('milestone'))));
      assert.equal(result.responses.length, 0);
      assert.equal(result.output, 'metadata=verified\n');

      const rerun = runFixture([metadataScript], [pr, after, after, pr], { OROT_VERSION: version });
      assert.equal(rerun.status, 0, rerun.stderr);
      assert.ok(rerun.calls.every((call) => !call.includes('PATCH')));
      assert.equal(rerun.responses.length, 0);
    });
  }
}

test('metadata CLI fails if labels or the final PR identity do not read back', () => {
  const version = '12.34.56';
  const pr = prFor(version);
  const before = { labels: [], assignees: [], milestone: null };
  const complete = {
    labels: ['area/foundation', 'type/ci', 'priority/p1'].map((name) => ({ name })),
    assignees: [{ login: 'eunsoogi' }],
    milestone: null,
  };
  const missing = runFixture([metadataScript], [pr, before, complete, before], {
    OROT_VERSION: version,
  });
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /metadata readback/);
  assert.equal(missing.output, '');
  const changed = runFixture([metadataScript], [pr, complete, complete, { ...pr, draft: false }], {
    OROT_VERSION: version,
  });
  assert.notEqual(changed.status, 0);
  assert.match(changed.stderr, /did not match/);
  assert.equal(changed.output, '');
});
