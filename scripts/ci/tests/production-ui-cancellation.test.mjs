import test from 'node:test';
import assert from 'node:assert/strict';
import { cancellationPreflight } from '../production-ui-cancellation.mjs';

test('the owned process group receives cancellation and reports termination', async () => {
  assert.deepEqual(await cancellationPreflight(), { signal: 'SIGINT', exitCode: 73 });
});
