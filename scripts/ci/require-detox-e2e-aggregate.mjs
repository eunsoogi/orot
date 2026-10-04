#!/usr/bin/env node

const args = process.argv.slice(2);
if (args.length !== 8) {
  throw new Error(
    'Usage: node require-detox-e2e-aggregate.mjs <release-result> <release-profile> <release-cases> <release-suites> <debug-result> <debug-profile> <debug-cases> <debug-suites>',
  );
}

function requireProfile({ label, result, profile, testCases, testSuites, expectedProfile, expectedCases }) {
  if (result !== 'success') {
    throw new Error(`${label} child job must succeed; received ${JSON.stringify(result || 'missing')}`);
  }
  if (profile !== expectedProfile) {
    throw new Error(`${label} child output must identify ${expectedProfile}; received ${JSON.stringify(profile || 'missing')}`);
  }
  for (const [kind, value, expected] of [
    ['test cases', testCases, expectedCases],
    ['Jest suites', testSuites, 1],
  ]) {
    if (!/^(0|[1-9]\d*)$/.test(value ?? '') || Number(value) !== expected) {
      throw new Error(`${label} child output must report exactly ${expected} ${kind}; received ${JSON.stringify(value || 'missing')}`);
    }
  }
}

requireProfile({
  label: 'Release',
  result: args[0],
  profile: args[1],
  testCases: args[2],
  testSuites: args[3],
  expectedProfile: 'release',
  expectedCases: 8,
});
requireProfile({
  label: 'OpenAI Debug',
  result: args[4],
  profile: args[5],
  testCases: args[6],
  testSuites: args[7],
  expectedProfile: 'openai-provider',
  expectedCases: 1,
});

console.log('9/9 tests passed across Release (8) and OpenAI Debug (1); both child jobs succeeded');
