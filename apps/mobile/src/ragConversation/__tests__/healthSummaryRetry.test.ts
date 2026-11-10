import { createConversationSessions } from '../conversationSessions';
import type { HealthSummaryResult } from '../healthSummary';

type SummaryMessage = {
  healthSummary?: HealthSummaryResult;
  retryHealthSummary?: () => Promise<HealthSummaryResult | null>;
};

test('retry updates only the summary card that owns the operation', async () => {
  const store = createConversationSessions();
  const window = {
    fromInclusive: '2026-10-01T00:00:00Z',
    toExclusive: '2026-10-05T00:00:00Z',
    timeZone: 'UTC',
  };
  const make = (id: string) => ({
    reference: { summaryId: id, window },
    analysis: { hypotheses: [], savedSummary: { status: 'failed' as const } },
  });
  const retry = jest.fn(async () => ({
    ...make('one'),
    analysis: {
      hypotheses: [],
      savedSummary: {
        status: 'saved' as const,
        id: 'one',
        createdAt: '2026-10-05T00:00:00Z',
        modelName: 'Model',
      },
    },
  }));
  store.setDraft(1, '첫 요약');
  await store.send(1, async () => ({
    status: 'answer',
    answer: '첫 결과',
    citations: [],
    healthSummary: make('one'),
    retryHealthSummary: retry,
  }));
  store.create();
  store.setDraft(2, '둘째 요약');
  await store.send(2, async () => ({
    status: 'answer',
    answer: '둘째 결과',
    citations: [],
    healthSummary: make('two'),
    retryHealthSummary: jest.fn(async () => null),
  }));
  const first = store
    .getSnapshot()
    .sessions[0]!.messages.at(-1)! as SummaryMessage;
  await first.retryHealthSummary!();
  const sessions = store.getSnapshot().sessions;
  expect(
    (sessions[0]!.messages.at(-1) as SummaryMessage).healthSummary?.analysis
      .savedSummary?.status,
  ).toBe('saved');
  expect(
    (sessions[1]!.messages.at(-1) as SummaryMessage).healthSummary?.analysis
      .savedSummary?.status,
  ).toBe('failed');
  expect(retry).toHaveBeenCalledTimes(1);
  store.dispose();
});
