import assert from 'node:assert/strict';
import test from 'node:test';
import { sanitizedTrace } from '../production-ui-diagnostics.mjs';

test('trace keeps typed lifecycle fields and never emits untrusted message contents', () => {
  const event = {
    event: 'sdk_generation_completed',
    requestId: 'request-1',
    bridgeCallId: 'call-1',
    identityOrigin: 'bridge',
    sdkCallId: 'unavailable',
    bytes: 42,
    prompt: 'private',
  };
  const lines = [
    JSON.stringify({ eventMessage: '[OROT_NATIVE_TOOL] ' + JSON.stringify(event) }),
    JSON.stringify({ eventMessage: 'unrelated private content' }),
  ].join('\n');
  assert.deepEqual(sanitizedTrace(lines), [
    {
      event: 'sdk_generation_completed',
      requestId: 'request-1',
      bridgeCallId: 'call-1',
      identityOrigin: 'bridge',
      sdkCallId: 'unavailable',
      bytes: 42,
    },
  ]);
  assert.deepEqual(sanitizedTrace('{broken'), []);
});
