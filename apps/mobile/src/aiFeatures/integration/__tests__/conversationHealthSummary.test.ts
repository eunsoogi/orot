import { createConversationHealthSummary } from '../conversationHealthSummary';
import type { createHealthSummaryService } from '../healthSummaryService';
import type { ConversationRetentionCandidate } from '../../../ragConversation/conversationRetention';

test('keeps the summary result when conversation retention fails', async () => {
  const summary = {
    reference: {
      summaryId: 'summary',
      window: {
        fromInclusive: '2026-10-01T00:00:00Z',
        toExclusive: '2026-10-05T00:00:00Z',
        timeZone: 'UTC',
      },
    },
    analysis: {
      hypotheses: [],
      savedSummary: {
        status: 'saved' as const,
        id: 'summary',
        createdAt: '2026-10-05T00:00:00Z',
        modelName: 'Model',
      },
    },
  };
  const retry = jest.fn(async () => null);
  const service = jest.fn(async () => ({
    result: summary,
    retry,
    providerId: 'provider',
    modelId: 'model',
  })) as unknown as ReturnType<typeof createHealthSummaryService>;
  const onRetentionFailure = jest.fn();
  const onRetentionCandidate = jest.fn(
    async (_candidate: ConversationRetentionCandidate) => {
      throw new Error('write failed');
    },
  );
  const result = await createConversationHealthSummary(service)(
    { question: '내가 편집한 요청', window: summary.reference.window },
    new AbortController().signal,
    { onRetentionCandidate, onRetentionFailure },
  );
  expect(result).toMatchObject({ status: 'answer', healthSummary: summary });
  expect(onRetentionCandidate.mock.calls[0]?.[0]).toMatchObject({
    question: '내가 편집한 요청',
    healthSummary: summary.reference,
    sources: [],
    citations: [],
  });
  expect(onRetentionFailure).toHaveBeenCalledTimes(1);
});
