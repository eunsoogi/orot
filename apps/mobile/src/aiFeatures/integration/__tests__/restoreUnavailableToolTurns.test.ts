import {
  restoreUnavailableToolTurns,
  excludeUnavailableToolRequests,
} from '../restoreUnavailableToolTurns';
import { restoreColdConversationPreviews } from '../restoreColdConversationEligibility';

test('quarantine explanation cannot regain private preview or cold continuation state', async () => {
  const turns: Parameters<typeof restoreUnavailableToolTurns>[0] = [
    {
      question: 'private old question',
      answer: 'private tool result',
      citations: [],
      healthSources: [],
      toolMessageId: 'old',
      preview: 'private preview',
      interrupted: true,
      interruptionReason: 'expired',
    },
  ];
  const metadata = [{ messageId: 'old', createdAt: '2026-10-05T00:00:00Z' }];
  restoreUnavailableToolTurns(turns, metadata);
  const readInterruptedPreview = jest.fn(async () => 'private preview');
  const result = await restoreColdConversationPreviews(
    undefined,
    new AbortController().signal,
    turns,
    excludeUnavailableToolRequests(
      [{ id: 'old', interruptionReason: 'expired' as const }],
      metadata,
    ),
    { readInterruptedPreview, activeSessionVersion: async () => 0 },
    'session',
    0,
  );
  expect(readInterruptedPreview).not.toHaveBeenCalled();
  expect(JSON.stringify(result)).not.toContain('private');
  expect(result[0]?.answer).toContain('새 요청');
  expect(result[0]?.preview).toBeUndefined();
  expect(result[0]?.coldResume).toBeUndefined();
});
