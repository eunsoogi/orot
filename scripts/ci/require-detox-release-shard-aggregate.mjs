#!/usr/bin/env node

import { appendFileSync } from 'node:fs';
import { releaseShardInventory } from './release-jest-summary.mjs';

const args = process.argv.slice(2);
const expectedArgumentCount = releaseShardInventory.length * 4 + 1;
if (args.length !== expectedArgumentCount) {
  throw new Error(
    `Release shard aggregator expects ${releaseShardInventory.length} results and one GitHub output path`,
  );
}

function requireShard({ result, profile, testCases, testSuites }, expected) {
  const label = expected.wrapper;
  if (result !== 'success') {
    throw new Error(
      label + ' child job must succeed; received ' + JSON.stringify(result || 'missing'),
    );
  }
  if (profile !== 'release') {
    throw new Error(
      label +
        ' child output must identify release; received ' +
        JSON.stringify(profile || 'missing'),
    );
  }
  for (const [kind, value, required] of [
    ['test cases', testCases, expected.tests],
    ['Jest suites', testSuites, expected.suites],
  ]) {
    if (!/^(0|[1-9]\d*)$/.test(value ?? '') || Number(value) !== required) {
      throw new Error(
        label +
          ' child output must report exactly ' +
          required +
          ' ' +
          kind +
          '; received ' +
          JSON.stringify(value || 'missing'),
      );
    }
  }
  return { cases: Number(testCases), suites: Number(testSuites) };
}

// Publish outputs only after both isolated runners match their current case counts.
const shardResults = releaseShardInventory.map((expected, index) => {
  const offset = index * 4;
  return requireShard(
    {
      result: args[offset],
      profile: args[offset + 1],
      testCases: args[offset + 2],
      testSuites: args[offset + 3],
    },
    expected,
  );
});
const totalCases = shardResults.reduce((total, shard) => total + shard.cases, 0);
const totalSuites = shardResults.reduce((total, shard) => total + shard.suites, 0);
if (totalCases !== 21 || totalSuites !== 2) {
  throw new Error(
    'Release shard aggregate must contain exactly 21 cases across 2 suites; received ' +
      totalCases +
      ' cases across ' +
      totalSuites +
      ' suites',
  );
}

appendFileSync(
  args.at(-1),
  ['e2e_profile=release', 'e2e_test_cases=' + totalCases, 'e2e_test_suites=' + totalSuites].join(
    '\n',
  ) + '\n',
);
console.log('21/21 Release cases passed across both shard suites');
