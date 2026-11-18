import type { OutboundProcessingRequest } from '@orot/agent-runtime';
import { createRecapForegroundConsent } from '../recapForegroundConsent';
const request = (): OutboundProcessingRequest => ({
  operationRunId: 'synthetic',
  providerId: 'synthetic',
  modelId: 'model',
  recipient: 'Synthetic',
  remoteProcessing: true,
  allowedScope: { sourceKinds: ['personal_record'] },
  payload: { messages: [{ role: 'user', content: 'Synthetic transcript' }] },
  signal: new AbortController().signal,
});

test('foreground removal invalidates the exact issued request even if the same port is restored', async () => {
  const owner = createRecapForegroundConsent();
  const surface = {
    authorize: jest.fn(async () => 'authorized' as const),
    isAuthorizationCurrent: () => true,
  };
  const outbound = request();
  owner.set(surface);
  expect(await owner.consent.authorize(outbound)).toBe('authorized');
  const invalidated = jest.fn();
  const stop = owner.consent.subscribeAuthorizationInvalidation!(
    outbound,
    invalidated,
  );
  owner.set(null);
  expect(invalidated).toHaveBeenCalledTimes(1);
  owner.set(surface);
  expect(owner.consent.isAuthorizationCurrent!(outbound)).toBe(false);
  stop();
  expect(await owner.consent.authorize(outbound)).toBe('authorized');
  expect(owner.consent.isAuthorizationCurrent!(outbound)).toBe(true);
});

test('a late approval from a removed surface never authorizes recap and local processing remains local', async () => {
  const owner = createRecapForegroundConsent();
  let complete!: (value: 'authorized') => void;
  owner.set({
    authorize: () =>
      new Promise(resolve => {
        complete = resolve;
      }),
  });
  const outbound = request();
  const pending = owner.consent.authorize(outbound);
  owner.set(null);
  complete('authorized');
  expect(await pending).toBe('renewal_required');
  expect(owner.consent.isAuthorizationCurrent!(outbound)).toBe(false);
  expect(
    await owner.consent.authorize({ ...outbound, remoteProcessing: false }),
  ).toBe('authorized');
});
