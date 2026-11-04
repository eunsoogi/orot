import { providerFailure } from '@orot/model-runtime';
import { createRagConversationService } from '../ragConversationService';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { localData } from '../featureServiceFixtures';
import { publicEvidenceFixture } from '../testSupport/publicWebEvidenceTestSupport';
import type { runRagConversationTurn } from '../../../ragConversation/service';

function fixture() {
  const run = publicEvidenceFixture();
  const runner = jest.fn(
    async (_options: Parameters<typeof runRagConversationTurn>[0]) => ({
      status: 'answer' as const,
      answer: '로컬 기록 답변',
      citations: [],
    }),
  );
  const send = createRagConversationService({
    selectedAi: async () => run.selected,
    consent: run.consent,
    queryConsent: { authorize: async () => 'authorized' },
    externalEvidence: { search: jest.fn() },
    loadLocalData: async () => localData([]).data,
    registry: new LocalEvidenceReferenceRegistry(),
    ragRunner: runner as unknown as typeof runRagConversationTurn,
    createOperationRunId: () => 'conversation-test',
  });
  return { ...run, runner, send };
}

test('runs one topic-only lookup before generating a conversation answer', async () => {
  const run = fixture();
  await run.send('김테스트 혈압 170/100의 일반적인 의미가 뭔가요?', []);
  expect(run.search).toHaveBeenCalledTimes(1);
  expect(run.search.mock.calls[0]![0].query).toContain('blood pressure');
  expect(run.search.mock.calls[0]![0].query).not.toMatch(/김테스트|170\/100/);
  expect(run.search.mock.invocationCallOrder[0]).toBeLessThan(
    run.runner.mock.invocationCallOrder[0]!,
  );
  const options = run.runner.mock.calls[0]![0] as Parameters<
    typeof runRagConversationTurn
  >[0];
  expect(options.publicEvidence?.items[0]?.sourceId).toBe('public-web');
});

test('a provider failure keeps the local answer and explains the missing lookup', async () => {
  const run = fixture();
  run.search.mockResolvedValue(
    providerFailure({
      code: 'provider_unavailable',
      message: 'unavailable',
      retryable: true,
    }),
  );
  const result = await run.send('혈압 기록을 알려줘', []);
  expect(result).toMatchObject({
    status: 'answer',
    answer: expect.stringContaining('로컬 기록 답변'),
  });
  expect(result).toMatchObject({
    answer: expect.stringContaining('공개 웹검색을 사용할 수 없어'),
  });
  expect(run.runner).toHaveBeenCalledTimes(1);
});

test('cancellation during search stops the feature before model execution', async () => {
  const run = fixture();
  let started!: () => void;
  const dispatched = new Promise<void>(resolve => {
    started = resolve;
  });
  run.search.mockImplementation(
    (_request, options) =>
      new Promise(resolve => {
        started();
        options?.signal?.addEventListener('abort', () =>
          resolve(
            providerFailure({
              code: 'provider_unavailable',
              message: 'cancelled',
              retryable: false,
            }),
          ),
        );
      }),
  );
  const pending = run.send('혈압을 알려줘', [], run.controller.signal);
  await dispatched;
  run.controller.abort();
  await expect(pending).resolves.toEqual({
    status: 'failure',
    kind: 'cancelled',
  });
  expect(run.runner).not.toHaveBeenCalled();
});
