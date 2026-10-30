import assert from 'node:assert/strict';
import test from 'node:test';
import { executeProductionUi } from '../production-ui-execution.mjs';

test('preflight precedes the runner-only install and the app is checked after the run', async () => {
  const calls = [];
  const result = await executeProductionUi({
    validate: async () => {
      calls.push('validate');
      return { runner: '/runner.app' };
    },
    preflight: async () => calls.push('preflight'),
    installRunner: async (runner) => calls.push(['installRunner', runner]),
    run: async () => {
      calls.push('run');
      return 0;
    },
    verifyAfter: async () => calls.push('verifyAfter'),
  });
  assert.equal(result, 0);
  assert.deepEqual(calls, [
    'validate',
    'preflight',
    ['installRunner', '/runner.app'],
    'run',
    'verifyAfter',
  ]);
});

test('failure before installation cannot mutate the destination and run failures still check the app', async () => {
  const calls = [];
  const operations = {
    validate: async () => ({ runner: '/runner.app' }),
    preflight: async () => {
      throw new Error('no cancellation');
    },
    installRunner: async () => calls.push('install'),
    run: async () => calls.push('run'),
    verifyAfter: async () => calls.push('verify'),
  };
  await assert.rejects(executeProductionUi(operations), /no cancellation/);
  assert.deepEqual(calls, []);
  operations.preflight = async () => {};
  operations.run = async () => {
    throw new Error('native failed');
  };
  await assert.rejects(executeProductionUi(operations), /native failed/);
  assert.deepEqual(calls, ['install', 'verify']);
});
