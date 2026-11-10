import { createDailyReportIdentity } from '@orot/domain';
import { finishRagConversation } from '../finishRagConversation';
import { createRagConversationService } from '../ragConversationService';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { apple, consent, localData } from '../featureServiceFixtures';
import type { RagConversationServiceDependencies } from '../ragConversationServiceDependencies';

test('cancelling a selected report prevents provider work', async () => {
  const selectedAi = jest.fn(async () => apple);
  const ragRunner = jest.fn();
  const controller = new AbortController();
  controller.abort();
  const send = createRagConversationService({
    consent,
    queryConsent: {} as never,
    externalEvidence: {} as never,
    loadLocalData: async () => localData([]).data,
    selectedAi,
    registry: new LocalEvidenceReferenceRegistry(),
    ragRunner,
    resolveDailyReport: async () => ({ status: 'unavailable' }),
  } as unknown as RagConversationServiceDependencies);
  await expect(
    send('보고서를 설명해 주세요', [], controller.signal, undefined, {
      intent: 'conversation',
      entryKey: 'entry',
      dailyReport: {
        identity: createDailyReportIdentity('2035-01-01', 'UTC'),
        runId: 'report',
        revision: 1,
      },
    }),
  ).resolves.toEqual({ status: 'failure', kind: 'cancelled' });
  expect(selectedAi).not.toHaveBeenCalled();
  expect(ragRunner).not.toHaveBeenCalled();
});

test('a report without cited evidence cannot fall back to an ordinary conversation', async () => {
  const selectedAi = jest.fn(async () => apple);
  const ragRunner = jest.fn();
  const send = createRagConversationService({
    consent,
    queryConsent: {} as never,
    externalEvidence: {} as never,
    loadLocalData: async () => localData([]).data,
    selectedAi,
    registry: new LocalEvidenceReferenceRegistry(),
    ragRunner,
    resolveDailyReport: async () => ({ status: 'current', sources: [] }),
  } as unknown as RagConversationServiceDependencies);
  await expect(
    send('보고서를 설명해 주세요', [], undefined, undefined, {
      intent: 'conversation',
      entryKey: 'entry',
      dailyReport: {
        identity: createDailyReportIdentity('2035-01-01', 'UTC'),
        runId: 'report',
        revision: 1,
      },
    }),
  ).resolves.toEqual({ status: 'failure', kind: 'stale_evidence' });
  expect(selectedAi).not.toHaveBeenCalled();
  expect(ragRunner).not.toHaveBeenCalled();
});

test('withholds the answer when the selected report changes during retention', async () => {
  let reportCurrent = true;
  const answer = {
    status: 'answer' as const,
    answer: 'Synthetic prior revision answer',
    citations: [],
  };
  await expect(
    finishRagConversation({
      outcome: answer,
      publicSearch: { status: 'unavailable' },
      retention: {
        onValidatedEvidence: () => {},
        finish: async () => {
          reportCurrent = false;
          return { outcome: answer, retained: false };
        },
      },
      signal: new AbortController().signal,
      continuation: false,
      reportIsCurrent: async () => reportCurrent,
    }),
  ).resolves.toEqual({ status: 'failure', kind: 'stale_evidence' });
});

test('keeps an atomically saved answer if cancellation rejects the post-commit report read', async () => {
  const controller = new AbortController();
  const outcome = {
    status: 'answer' as const,
    answer: 'Committed answer',
    citations: [],
  };
  await expect(
    finishRagConversation({
      outcome,
      publicSearch: {
        status: 'success',
        batch: { items: [], coverage: [], conflicts: [] },
      },
      retention: {
        onValidatedEvidence: () => {},
        finish: async () => ({ outcome, retained: true }),
      },
      signal: controller.signal,
      continuation: false,
      reportIsCurrent: async () => {
        controller.abort();
        throw new Error('Artifact discovery was cancelled.');
      },
    }),
  ).resolves.toEqual(outcome);
});
