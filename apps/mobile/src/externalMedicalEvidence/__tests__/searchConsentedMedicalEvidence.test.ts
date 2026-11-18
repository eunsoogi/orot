import type { ExecutionConsentPort } from '@orot/agent-runtime';
import { searchConsentedMedicalEvidence } from '../searchConsentedMedicalEvidence';

test('missing settings approval never dispatches or prompts through the manual query service', async () => {
  const service = {
    search: jest.fn(async () => ({ status: 'empty' as const })),
  };
  expect(
    await searchConsentedMedicalEvidence(
      { authorize: async () => 'renewal_required' },
      service,
      'Synthetic public topic',
      new AbortController().signal,
    ),
  ).toBe('consent_required');
  expect(service.search).not.toHaveBeenCalled();
});

test('manual search binds Europe PMC and cancels/discards a response after settings revocation', async () => {
  let invalidate = () => {};
  let finish!: (value: { status: 'empty' }) => void;
  let current = true;
  const consent: ExecutionConsentPort = {
    authorize: jest.fn(async () => 'authorized'),
    isAuthorizationCurrent: () => current,
    subscribeAuthorizationInvalidation: (_request, listener) => {
      invalidate = listener;
      return () => {};
    },
  };
  const service = {
    search: jest.fn(
      (_query: string, _options: { signal?: AbortSignal }) =>
        new Promise<{ status: 'empty' }>(resolve => {
          finish = resolve;
        }),
    ),
  };
  const response = searchConsentedMedicalEvidence(
    consent,
    service,
    'Synthetic public topic',
    new AbortController().signal,
  );
  await Promise.resolve();
  expect(consent.authorize).toHaveBeenCalledWith(
    expect.objectContaining({
      providerId: 'europe-pmc',
      recipient: 'Europe PMC',
      consentScope: expect.objectContaining({
        purpose: 'public_medical_search',
      }),
    }),
  );
  expect(service.search).toHaveBeenCalledTimes(1);
  current = false;
  invalidate();
  expect(service.search.mock.calls[0][1].signal?.aborted).toBe(true);
  finish({ status: 'empty' });
  await expect(response).resolves.toBe('consent_required');
});
