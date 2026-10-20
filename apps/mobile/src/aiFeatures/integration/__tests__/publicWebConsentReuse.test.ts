import { createHash } from '../../../agent/execution/consentHashTestSupport';
import { createRememberedInferenceConfirmation } from '../../../agent/execution/rememberedInferenceConsent';
import { createExecutionConsentRegistry } from '../../../agent/execution/consentRegistry';
import { createPublicWebEvidence } from '../publicWebEvidence';
import { publicEvidenceFixture } from '../testSupport/publicWebEvidenceTestSupport';

test('reuses only the same account/model/public-query permission across changed topics and stores hashes', async () => {
  const run = publicEvidenceFixture();
  const values = new Set<string>();
  const confirm = jest.fn(async () => true);
  const receipts = {
    has: async (key: string) => values.has(key),
    save: async (key: string, valid: () => boolean) => {
      if (valid()) values.add(key);
    },
    clear: async () => {
      values.clear();
    },
  };
  const makeConsent = () =>
    createExecutionConsentRegistry(
      createRememberedInferenceConfirmation(confirm, {
        receipts,
        digest: async value => createHash('sha256').update(value).digest('hex'),
      }),
    );
  await createPublicWebEvidence({
    selected: run.selected,
    consent: makeConsent(),
  })!.tool.search(run.request);
  await createPublicWebEvidence({
    selected: run.selected,
    consent: makeConsent(),
  })!.tool.search({
    ...run.request,
    operationRunId: 'second-run',
    input: { query: 'Another general public topic' },
  });
  expect(confirm).toHaveBeenCalledTimes(1);
  expect([...values]).toEqual([expect.stringMatching(/^[a-f0-9]{64}$/u)]);
  expect([...values].join()).not.toContain('Public concept');
  expect(run.search).toHaveBeenCalledTimes(2);
  const changedProvider = {
    ...run.selected.provider,
    id: 'chatgpt-plan:synthetic:other-model',
  };
  await createPublicWebEvidence({
    selected: {
      ...run.selected,
      provider: changedProvider,
      modelId: 'other-model',
      selection: { providerId: changedProvider.id, modelId: 'other-model' },
      option: {
        ...run.selected.option,
        provider: changedProvider,
        modelId: 'other-model',
      },
    },
    consent: makeConsent(),
  })!.tool.search(run.request);
  expect(confirm).toHaveBeenCalledTimes(2);
});
