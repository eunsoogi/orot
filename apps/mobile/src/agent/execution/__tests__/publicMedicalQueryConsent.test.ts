import { createExecutionConsentRegistry } from '../consentRegistry';
import { createRememberedInferenceConfirmation } from '../rememberedInferenceConsent';
import { publicMedicalQueryConsent } from '../publicMedicalQueryConsent';
import { createHash } from '../consentHashTestSupport';

test('different public search terms reuse one destination/data permission without storing query text', async () => {
  const digests = new Set<string>();
  const confirm = jest.fn(async () => true);
  const consent = createExecutionConsentRegistry(
    createRememberedInferenceConfirmation(confirm, {
      digest: async value => createHash('sha256').update(value).digest('hex'),
      receipts: {
        has: async key => digests.has(key),
        save: async (key, valid) => {
          if (valid()) digests.add(key);
        },
        clear: async () => {
          digests.clear();
        },
      },
    }),
  );
  const port = publicMedicalQueryConsent(consent);
  for (const query of ['sleep duration', 'physical activity']) {
    expect(
      await port.authorize({
        operationRunId: query,
        operationKey: 'search',
        sourceId: 'europe-pmc',
        query,
        signal: new AbortController().signal,
      }),
    ).toBe('authorized');
  }
  expect(confirm).toHaveBeenCalledTimes(1);
  expect([...digests]).toEqual([expect.stringMatching(/^[a-f0-9]{64}$/)]);
});
