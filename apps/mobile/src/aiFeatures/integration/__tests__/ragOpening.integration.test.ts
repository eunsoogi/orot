import { providerSuccess } from '@orot/model-runtime';
import { createRagConversationService } from '../ragConversationService';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { localData } from '../featureServiceFixtures';
import { publicEvidenceFixture } from '../testSupport/publicWebEvidenceTestSupport';
import type { runRagConversationTurn } from '../../../ragConversation/service';

/** Uses actual service/consent/preview paths with synthetic provider prose and a stub final runner. */
test('ordinary chat delivers reviewed opening before external lookup and final runner', async () => {
  const f = publicEvidenceFixture();
  const order: string[] = [];
  const generate = jest
    .fn()
    .mockResolvedValueOnce(
      providerSuccess({
        text: '요청하신 기록의 흐름을 살펴볼게요.',
        toolCalls: [],
        finishReason: 'complete',
      }),
    )
    .mockResolvedValueOnce(
      providerSuccess({
        text: 'ALLOW',
        toolCalls: [],
        finishReason: 'complete',
      }),
    );
  const selected = {
    ...f.selected,
    provider: {
      ...f.selected.provider,
      capabilities: { ...f.selected.provider.capabilities, streaming: false },
      generate,
    },
  };
  f.search.mockImplementation(async () => {
    order.push('search');
    return providerSuccess({ text: '', callCount: 1, citations: [] });
  });
  const runner = jest.fn(async () => {
    order.push('final');
    return {
      status: 'answer' as const,
      answer: '합성 최종 답변',
      citations: [],
    };
  });
  const send = createRagConversationService({
    selectedAi: async () => selected,
    consent: f.consent,
    queryConsent: { authorize: async () => 'authorized' },
    externalEvidence: { search: jest.fn() },
    loadLocalData: async () => localData([]).data,
    registry: new LocalEvidenceReferenceRegistry(),
    ragRunner: runner as unknown as typeof runRagConversationTurn,
  });
  const result = await send('혈압 기록을 알려줘', [], undefined, {
    onTaskStreamEvent: event => {
      if (event.type === 'initial_response') order.push('opening');
    },
  });
  expect(result.status).toBe('answer');
  expect(order).toEqual(['opening', 'search', 'final']);
  expect(generate).toHaveBeenCalledTimes(2);
  expect(runner).toHaveBeenCalledTimes(1);
});
