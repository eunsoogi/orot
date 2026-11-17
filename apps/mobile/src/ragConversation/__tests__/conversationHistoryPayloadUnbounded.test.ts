import {
  boundedProviderHistory,
  retainedHistoryTurns,
} from '../conversationHistoryPayload';

test('preserves long user context but never reuses unverified assistant prose', () => {
  const users = Array.from({ length: 12 }, (_, index) => ({
    role: 'user' as const,
    content: `${index}:` + '한😀'.repeat(2000),
  }));
  const result = boundedProviderHistory([
    ...users,
    { role: 'assistant', content: 'unverified private answer' },
  ]);
  expect(result.slice(0, 12)).toEqual(users);
  expect(JSON.stringify(result)).not.toContain('unverified private answer');
});

test('retains earlier source identities beyond the old four-turn window', () => {
  const messages = Array.from({ length: 12 }, (_, index) => [
    { id: index * 2, role: 'user' as const, content: `question ${index}` },
    {
      id: index * 2 + 1,
      role: 'assistant' as const,
      content: 'answer',
      retainedTurnId: `turn-${index}`,
    },
  ]).flat();
  expect(retainedHistoryTurns(messages, '')).toEqual(
    Array.from({ length: 12 }, (_, index) => ({
      question: `question ${index}`,
      id: `turn-${index}`,
    })),
  );
});
