import { createDailyReportIdentity } from '@orot/domain';
import { createRagConversationService } from '../ragConversationService';
import type { RagConversationServiceDependencies } from '../ragConversationServiceDependencies';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { apple, consent, localData } from '../featureServiceFixtures';
import { prepareDailyReportConversationEvidence } from '../dailyReportConversationEvidence';
import { publicEvidenceFixture } from '../testSupport/publicWebEvidenceTestSupport';
import { runRagConversationTurn } from '../../../ragConversation/service';
import { providerSuccess } from '@orot/model-runtime';

// The dispatch race isolates consent and provider calls; SQLCipher deletion is covered separately.
jest.mock('../deletionAwareEvidence', () => ({
  revalidateWithLocalDeletionGuard: (
    refs: never,
    signal: AbortSignal,
    revalidate: (refs: never, signal: AbortSignal) => Promise<boolean>,
  ) => revalidate(refs, signal),
}));

const context = {
  intent: 'conversation' as const,
  entryKey: 'entry',
  dailyReport: {
    identity: createDailyReportIdentity('2035-01-01', 'UTC'),
    runId: 'report',
    revision: 1,
  },
};

test('a stale selected report prevents any provider or fallback work', async () => {
  const selectedAi = jest.fn(async () => apple);
  const ragRunner = jest.fn();
  const resolveDailyReport = jest.fn(async () => ({
    status: 'stale' as const,
  }));
  const send = createRagConversationService({
    consent,
    queryConsent: {} as never,
    externalEvidence: {} as never,
    loadLocalData: async () => localData([]).data,
    selectedAi,
    registry: new LocalEvidenceReferenceRegistry(),
    ragRunner,
    resolveDailyReport,
  } as unknown as RagConversationServiceDependencies);
  await expect(
    send('보고서를 설명해 주세요', [], undefined, undefined, context),
  ).resolves.toEqual({ status: 'failure', kind: 'stale_evidence' });
  expect(resolveDailyReport).toHaveBeenCalled();
  expect(selectedAi).not.toHaveBeenCalled();
  expect(ragRunner).not.toHaveBeenCalled();
});

test.each([false, true])(
  'consent wait rechecks report before provider dispatch (changed: %s)',
  async changed => {
    const registry = new LocalEvidenceReferenceRegistry();
    let current = true;
    const source = registry.add({
      reference: {
        sourceKind: 'personal_record',
        sourceId: 'private-id',
        evidenceId: 'private-id',
        sourceRevision: '1',
        evidenceRevision: '1',
        locator: {},
        effectiveTime: null,
        reviewState: 'unreviewed',
      },
      content: '',
      validate: async () => current,
      readSource: async () =>
        current
          ? ({
              status: 'available',
              document: {
                sourceKind: 'personal_record',
                records: [
                  {
                    kind: 'health_observation',
                    record: {
                      id: 'private-id',
                      concept: 'heart_rate',
                      value: {
                        kind: 'quantity',
                        amount: 72,
                        unit: 'count/min',
                      },
                    },
                  },
                ],
              },
            } as never)
          : { status: 'changed' },
    });
    const fixture = publicEvidenceFixture();
    fixture.authorize.mockImplementation(async () => {
      if (changed) current = false;
      return 'authorized';
    });
    const generate = jest.fn(async () =>
      providerSuccess({
        text: JSON.stringify({
          type: 'result',
          value: { answerKind: 'conversation', answer: '확인했어요.' },
          citations: [],
        }),
        toolCalls: [],
        finishReason: 'complete' as const,
      }),
    );
    const onTaskStreamEvent = jest.fn();
    const runner: typeof runRagConversationTurn = (options, invocation) => {
      expect(invocation?.onTaskStreamEvent).toBeUndefined();
      return runRagConversationTurn(options, invocation);
    };
    const send = createRagConversationService({
      consent: fixture.consent,
      queryConsent: { authorize: async () => 'authorized' },
      externalEvidence: { search: jest.fn() },
      loadLocalData: async () => localData([]).data,
      selectedAi: async () => ({
        ...fixture.selected,
        provider: {
          ...fixture.selected.provider,
          searchPublicWeb: undefined,
          generate,
          capabilities: {
            ...fixture.selected.provider.capabilities,
            streaming: false,
            toolCalling: false,
            structuredOutput: false,
          },
        },
      }),
      registry,
      ragRunner: runner,
      resolveDailyReport: async () =>
        current
          ? { status: 'current', sources: [source] }
          : { status: 'stale' },
    });
    const outcome = await send(
      '이 기록을 설명해 주세요',
      [],
      undefined,
      { onTaskStreamEvent },
      context,
    );
    expect(onTaskStreamEvent).not.toHaveBeenCalled();
    expect(fixture.authorize).toHaveBeenCalled();
    if (changed) {
      expect(generate).not.toHaveBeenCalled();
      expect(outcome.status).not.toBe('answer');
    } else {
      expect(generate).toHaveBeenCalled();
      expect(JSON.stringify(generate.mock.calls)).toContain('heart_rate');
      expect(JSON.stringify(generate.mock.calls)).not.toContain('private-id');
    }
  },
);

test('only cited local facts are admitted and changes invalidate the selected report', async () => {
  const registry = new LocalEvidenceReferenceRegistry();
  let current = true;
  const source = registry.add({
    reference: {
      sourceKind: 'personal_record',
      sourceId: 'private-id',
      evidenceId: 'private-id',
      sourceRevision: 'one',
      evidenceRevision: 'one',
      locator: {},
      effectiveTime: null,
      reviewState: 'unreviewed',
    },
    content: '',
    validate: async () => current,
    readSource: async () =>
      current
        ? ({
            status: 'available',
            document: {
              sourceKind: 'personal_record',
              records: [
                {
                  kind: 'health_observation',
                  record: {
                    id: 'private-id',
                    concept: 'heart_rate',
                    value: { kind: 'quantity', amount: 72, unit: 'count/min' },
                  },
                },
              ],
            },
          } as never)
        : { status: 'changed' },
  });
  const resolve = jest.fn(async () =>
    current
      ? { status: 'current' as const, sources: [source] }
      : { status: 'stale' as const },
  );
  const controller = new AbortController();
  const prepared = await prepareDailyReportConversationEvidence({
    report: context.dailyReport,
    resolve,
    registry,
    loadLocalData: async () => localData([]).data,
    signal: controller.signal,
  });
  expect(prepared?.items).toHaveLength(1);
  expect(prepared?.items[0]?.content).toContain('heart_rate');
  expect(JSON.stringify(prepared?.items)).not.toContain('private-id');
  expect(await prepared?.isCurrent()).toBe(true);
  current = false;
  expect(await prepared?.isCurrent()).toBe(false);
  controller.abort();
  expect(await prepared?.isCurrent()).toBe(false);
});
