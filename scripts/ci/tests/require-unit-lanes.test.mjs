import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const gate = fileURLToPath(new URL('../require-unit-lanes.sh', import.meta.url));
const laneKeys = ['MOBILE_SHARD_1', 'MOBILE_SHARD_2', 'MOBILE_SHARD_3', 'UNIT_PACKAGES'];

function check(selected, overrides = {}) {
  const outcomes = Object.fromEntries(
    laneKeys.map((lane) => [lane, selected === 'true' ? 'success' : 'skipped']),
  );
  return spawnSync('bash', [gate], {
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      SELECTION_RESULT: 'success',
      SELECTION_COMPLETE: 'true',
      UNIT_SELECTED: selected,
      ...outcomes,
      ...overrides,
    },
  });
}

test('requires every selected lane; accepts an explicit verified no-op', () => {
  assert.equal(check('true').status, 0);
  assert.equal(check('false').status, 0);
  assert.notEqual(check('false', { UNIT_PACKAGES: 'success' }).status, 0);
});

test('rejects failed selection, missing selection signals, and incomplete lane evidence', () => {
  for (const overrides of [
    { SELECTION_RESULT: 'failure' },
    { SELECTION_RESULT: 'cancelled' },
    { SELECTION_COMPLETE: '' },
    { UNIT_SELECTED: '' },
  ]) {
    assert.notEqual(check('true', overrides).status, 0);
  }
  for (const lane of laneKeys) {
    for (const result of ['failure', 'skipped', 'cancelled', '']) {
      assert.notEqual(check('true', { [lane]: result }).status, 0, `${lane}: ${result}`);
    }
  }
});
