import type {
  ExecutionConsentPort,
  OutboundProcessingRequest,
} from '@orot/agent-runtime';
import { withLiveConsentSignal } from '../withLiveConsentSignal';

function fixture() {
  const request: OutboundProcessingRequest = {
    operationRunId: 'synthetic',
    providerId: 'synthetic',
    modelId: 'model',
    recipient: 'Synthetic',
    remoteProcessing: true,
    allowedScope: { sourceKinds: ['external_medical'] },
    payload: {
      messages: [{ role: 'user', content: 'Synthetic public topic' }],
    },
    signal: new AbortController().signal,
  };
  let invalidated = () => {};
  const removed = jest.fn();
  const consent: ExecutionConsentPort = {
    authorize: async () => 'authorized',
    isAuthorizationCurrent: () => true,
    subscribeAuthorizationInvalidation: (same, listener) => {
      expect(same).toBe(request);
      invalidated = listener;
      return removed;
    },
  };
  return { request, consent, removed, invalidate: () => invalidated() };
}

test('revocation aborts public transport and discards its late response without mutating caller signal', async () => {
  const f = fixture();
  let signal!: AbortSignal;
  let complete!: (value: string) => void;
  const result = withLiveConsentSignal(f.consent, f.request, current => {
    signal = current;
    return new Promise(resolve => {
      complete = resolve;
    });
  });
  f.invalidate();
  expect(signal.aborted).toBe(true);
  expect(f.request.signal.aborted).toBe(false);
  complete('Not published');
  await expect(result).rejects.toThrow('Transmission permission changed');
  expect(f.removed).toHaveBeenCalledTimes(1);
});

test('synchronous invalidation on subscribe prevents transport and still releases observer', async () => {
  const f = fixture();
  f.consent.subscribeAuthorizationInvalidation = (_request, listener) => {
    listener();
    return f.removed;
  };
  const transport = jest.fn(async () => 'Never sent');
  await expect(
    withLiveConsentSignal(f.consent, f.request, transport),
  ).rejects.toThrow();
  expect(transport).not.toHaveBeenCalled();
  expect(f.removed).toHaveBeenCalledTimes(1);
});
