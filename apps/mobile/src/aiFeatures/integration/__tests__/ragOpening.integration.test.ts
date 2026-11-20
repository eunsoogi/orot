import { NativeModules } from 'react-native';
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

test.each([false, true])(
  'receipt phase diagnostics require explicit opt-in: %s',
  async enabled => {
    const original = NativeModules.OrotProviderDiagnostics;
    const marks: string[] = [];
    const unexpectedDisabledMarks: string[] = [];
    NativeModules.OrotProviderDiagnostics = {
      enabled,
      report: (_feature: string, stage: string, outcome: string) => {
        if (enabled) marks.push(`${stage}:${outcome}`);
        else if (stage.startsWith('conversation_receipt_'))
          unexpectedDisabledMarks.push(stage);
      },
    };
    try {
      const f = publicEvidenceFixture();
      const provider = {
        ...f.selected.provider,
        capabilities: { ...f.selected.provider.capabilities, streaming: false },
        generate: jest
          .fn()
          .mockResolvedValueOnce(
            providerSuccess({
              text: '요청하신 흐름을 살펴볼게요.',
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
          ),
      };
      const send = createRagConversationService({
        selectedAi: async () => ({ ...f.selected, provider }),
        consent: f.consent,
        queryConsent: { authorize: async () => 'authorized' },
        externalEvidence: { search: jest.fn() },
        loadLocalData: async () => localData([]).data,
        registry: new LocalEvidenceReferenceRegistry(),
        ragRunner: async () => ({
          status: 'answer',
          answer: '합성 최종 답변',
          citations: [],
        }),
      });
      const receipts: string[] = [];
      const result = await send('간단히 인사해 줘', [], undefined, {
        onProviderReceipt: receipt => receipts.push(receipt),
        onTaskStreamEvent: jest.fn(),
      });
      expect(result.status).toBe('answer');
      expect(unexpectedDisabledMarks).toEqual([]);
      expect(receipts).toEqual(['response_started']);
      expect(
        marks.filter(mark =>
          /^(conversation_receipt_|opening_generate:|opening_review:)/.test(
            mark,
          ),
        ),
      ).toEqual(
        enabled
          ? [
              'conversation_receipt_attempt:started',
              'opening_generate:started',
              'conversation_receipt_response_started:completed',
              'opening_generate:completed',
              'opening_review:started',
              'opening_review:completed',
              'conversation_receipt_main:started',
              'conversation_receipt_main:completed',
              'conversation_receipt_attempt:completed',
            ]
          : [],
      );
    } finally {
      NativeModules.OrotProviderDiagnostics = original;
    }
  },
);
