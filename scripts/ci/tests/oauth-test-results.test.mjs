import assert from 'node:assert/strict';
import test from 'node:test';
import { oauthTestEnvironment } from '../oauth-test-context.mjs';
import {
  oauthDiscoveredTests,
  verifyOAuthReceipt,
  verifyOAuthTestOutput,
} from '../oauth-test-results.mjs';

const tests = [
  'OpenAIProviderTests.TokenTests/testLogin',
  'OpenAIProviderTests.TokenTests/testRefresh',
];
const events = (ids = tests, status = 'passed') =>
  ids
    .flatMap((id) => {
      const [suite, method] = id.split('/');
      return [
        `Test Case '-[${suite} ${method}]' started.`,
        `Test Case '-[${suite} ${method}]' ${status} (0.01 seconds).`,
      ];
    })
    .join('\n');
const env = { GITHUB_SHA: 'a'.repeat(40), GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '1' };
const receipt = () => ({
  schemaVersion: 1,
  passed: true,
  context: {
    sourceSha: env.GITHUB_SHA,
    runId: env.GITHUB_RUN_ID,
    attempt: env.GITHUB_RUN_ATTEMPT,
    profile: 'oauth-macos',
    configuration: 'Debug',
    inputDigest: 'b'.repeat(64),
  },
  tests,
  archiveDigest: 'c'.repeat(64),
  manifestDigest: 'd'.repeat(64),
  harnessBinaryDigest: 'e'.repeat(64),
});

test('OAuth discovery and completed XCTest events retain exactly one execution of every method', () => {
  assert.deepEqual(oauthDiscoveredTests(tests.slice().reverse().join('\n')), tests);
  assert.deepEqual(verifyOAuthTestOutput(events(), tests), tests);
  for (const text of [
    '',
    tests[0] + '\n' + tests[0],
    'OtherPackage.Tests/testOne',
    'OpenAIProviderTests.Bad/testOne()',
  ])
    assert.throws(() => oauthDiscoveredTests(text));
  for (const text of [
    events(tests.slice(1)),
    events([...tests, tests[0]]),
    events(tests, 'failed'),
    events(tests, 'skipped'),
    events().replace('started.', 'finished.'),
    events() + '\n' + events(['OpenAIProviderTests.Unexpected/testExtra']),
  ])
    assert.throws(() => verifyOAuthTestOutput(text, tests));
});

test('OAuth receipts reject stale runs, missing harness or archive provenance, and partial execution', () => {
  assert.deepEqual(verifyOAuthReceipt(receipt(), env).tests, tests);
  for (const field of [
    'sourceSha',
    'runId',
    'attempt',
    'profile',
    'configuration',
    'inputDigest',
  ]) {
    const value = receipt();
    value.context[field] = '';
    assert.throws(() => verifyOAuthReceipt(value, env));
  }
  for (const field of ['archiveDigest', 'manifestDigest', 'harnessBinaryDigest'])
    assert.throws(() => verifyOAuthReceipt({ ...receipt(), [field]: '' }, env));
  for (const change of [
    { passed: false },
    { tests: [] },
    { tests: [...tests, tests[0]] },
    { schemaVersion: 0 },
  ])
    assert.throws(() => verifyOAuthReceipt({ ...receipt(), ...change }, env));
  assert.throws(() => verifyOAuthReceipt(undefined, env));
});

test('the XCTest loader never receives account credentials through its environment', () => {
  assert.deepEqual(
    oauthTestEnvironment({
      PATH: '/bin',
      HOME: '/tmp/test-home',
      TMPDIR: '/tmp',
      DEVELOPER_DIR: '/Xcode',
      SDKROOT: '/SDK',
      LANG: 'en_US.UTF-8',
      LC_ALL: 'C',
      GITHUB_TOKEN: 'synthetic-secret',
      AWS_ACCESS_KEY_ID: 'synthetic-secret',
      OPENAI_API_KEY: 'synthetic-secret',
      NODE_OPTIONS: '--inspect',
      DYLD_INSERT_LIBRARIES: '/untrusted',
    }),
    {
      PATH: '/bin',
      HOME: '/tmp/test-home',
      TMPDIR: '/tmp',
      DEVELOPER_DIR: '/Xcode',
      SDKROOT: '/SDK',
      LANG: 'en_US.UTF-8',
      LC_ALL: 'C',
    },
  );
});
