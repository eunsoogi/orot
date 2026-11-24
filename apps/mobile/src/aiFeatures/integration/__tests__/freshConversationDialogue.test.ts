import { loadFreshConversationDialogue } from '../freshConversationDialogue';

type Input = Parameters<typeof loadFreshConversationDialogue>[0];

const persisted = (id: string, question: string, createdAt: string) => ({
  id,
  question,
  createdAt,
  answer: 'fixture answer',
});

test('keeps protected storage order and excludes all rows for contradictory or stale requested IDs', async () => {
  const signal = new AbortController().signal;
  const newer = persisted('newer', 'newer match', '2035-05-01T00:00:00Z');
  const older = persisted('older', 'older match', '2035-06-01T00:00:00Z');
  const rescued = persisted(
    'matched',
    'second selected match',
    '2035-07-01T00:00:00Z',
  );
  const contradictory = persisted(
    'contradictory',
    'exact match',
    '2035-08-01T00:00:00Z',
  );
  const stale = persisted(
    'stale',
    'not the expected question',
    '2035-09-01T00:00:00Z',
  );
  const firstSelected = persisted(
    'matched',
    'first selected question',
    '2035-05-02T00:00:00Z',
  );
  const selected = [newer, firstSelected, contradictory, older, rescued, stale];
  const expected = [
    older,
    contradictory,
    { id: contradictory.id, question: 'contradictory question' },
    { id: stale.id, question: 'stale expected question' },
    { id: 'missing', question: 'missing expected question' },
    rescued,
    newer,
  ];
  const retainedHistory = expected.map(({ id, question }) => ({
    id,
    question,
  }));
  const readProtectedPromptHistory = jest.fn(async () => selected);
  const protectedPromptHistoryIsCurrent = jest.fn(async () => false);
  const input = {
    messages: [],
    session: { id: 'fixture-session', version: 5 },
    retainedHistory,
    registry: { redactText: (text: string) => `redacted:${text}` },
    data: {
      openConversationArtifactStorage: async () => ({
        readProtectedPromptHistory,
        protectedPromptHistoryIsCurrent,
      }),
    },
    signal,
  } as unknown as Input;

  const result = await loadFreshConversationDialogue(input, false);

  expect(readProtectedPromptHistory).toHaveBeenCalledTimes(1);
  expect(readProtectedPromptHistory).toHaveBeenCalledWith(
    'fixture-session',
    5,
    expected.map(({ id }) => id),
    signal,
    false,
  );
  // A matching second instance admits the id; a conflicting expected question
  // retires the entire id even when another expected question matches.
  const admitted = [newer, firstSelected, older, rescued];
  const parents = admitted.map(({ id, createdAt }) => ({ id, createdAt }));
  expect(result?.historicalDialogueParents).toEqual(parents);
  expect(result?.priorTurns).toEqual(
    admitted.map(({ question, answer }) => ({
      question: `redacted:${question}`,
      answer: `redacted:${answer}`,
    })),
  );
  expect(result?.omitted).toBe(true);
  expect(result?.excludedQuestions).toEqual([
    'contradictory question',
    'stale expected question',
    'missing expected question',
  ]);
  expect(protectedPromptHistoryIsCurrent).not.toHaveBeenCalled();
  await expect(result?.dialogueOwnerIsCurrent?.()).resolves.toBe(false);
  expect(protectedPromptHistoryIsCurrent).toHaveBeenCalledWith(
    'fixture-session',
    5,
    parents,
    signal,
  );
});
