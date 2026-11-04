import { createHash } from '../../../agent/execution/consentHashTestSupport';
import { createRememberedInferenceConfirmation } from '../../../agent/execution/rememberedInferenceConsent';
import { createExecutionConsentRegistry } from '../../../agent/execution/consentRegistry';
import { createPublicWebEvidence } from '../publicWebEvidence';
import { publicEvidenceFixture } from '../testSupport/publicWebEvidenceTestSupport';
import {
  beginConsentReset,
  finishConsentReset,
} from '../../../agent/execution/consentRevision';

test('does not reuse a public topic receipt for a private record query', async () => {
  const run = publicEvidenceFixture();
  const values = new Set<string>();
  const confirm = jest
    .fn()
    .mockResolvedValueOnce(true)
    .mockResolvedValue(false);
  const consent = createExecutionConsentRegistry(
    createRememberedInferenceConfirmation(confirm, {
      receipts: {
        has: async key => values.has(key),
        save: async (key, valid) => {
          if (valid()) values.add(key);
        },
        clear: async () => values.clear(),
      },
      digest: async value => createHash('sha256').update(value).digest('hex'),
    }),
  );
  const evidence = createPublicWebEvidence({
    selected: run.selected,
    consent,
  })!;
  await evidence.tool.search({
    ...run.request,
    input: { topics: ['blood_pressure'] },
  });
  await expect(
    evidence.tool.search({
      ...run.request,
      operationRunId: 'private-query-run',
      input: { query: '김테스트 2026-10-20 혈압 170/100' },
    }),
  ).rejects.toThrow();
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(run.search).toHaveBeenCalledTimes(1);
  // Approval cannot authorize unclassified text or create a new receipt.
  confirm.mockResolvedValue(true);
  const receiptsBefore = [...values];
  await expect(
    evidence.tool.search({
      ...run.request,
      operationRunId: 'reviewed-query',
      input: { query: '김테스트 2026-10-20 혈압 170/100' },
    }),
  ).rejects.toThrow();
  await expect(
    evidence.tool.search({
      ...run.request,
      operationRunId: 'another-query',
      input: { query: '김테스트 2026-10-21 혈압 160/95' },
    }),
  ).rejects.toThrow();
  expect(confirm).toHaveBeenCalledTimes(1);
  expect([...values]).toEqual(receiptsBefore);
});

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
  })!.tool.search({ ...run.request, input: { topics: ['blood_pressure'] } });
  await createPublicWebEvidence({
    selected: run.selected,
    consent: makeConsent(),
  })!.tool.search({
    ...run.request,
    operationRunId: 'second-run',
    input: { topics: ['sleep', 'physical_activity'] },
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
  })!.tool.search({ ...run.request, input: { topics: ['blood_pressure'] } });
  expect(confirm).toHaveBeenCalledTimes(2);
});

test('revocation invalidates cached permission even within the same active operation', async () => {
  const run = publicEvidenceFixture();
  const values = new Set<string>();
  const confirm = jest
    .fn()
    .mockResolvedValueOnce(true)
    .mockResolvedValue(false);
  const receipts = {
    has: async (key: string) => values.has(key),
    save: async (key: string, valid: () => boolean) => {
      if (valid()) values.add(key);
    },
    clear: async () => {
      values.clear();
    },
  };
  const consent = createExecutionConsentRegistry(
    createRememberedInferenceConfirmation(confirm, {
      receipts,
      digest: async value => createHash('sha256').update(value).digest('hex'),
    }),
  );
  const tool = createPublicWebEvidence({
    selected: run.selected,
    consent,
  })!.tool;
  await tool.search(run.request);
  beginConsentReset();
  try {
    await receipts.clear();
  } finally {
    finishConsentReset();
  }
  expect(await tool.search(run.request)).toEqual({
    status: 'consent_required',
  });
  expect(confirm).toHaveBeenCalledTimes(2);
  expect(run.search).toHaveBeenCalledTimes(1);
});
