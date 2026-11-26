import { saveOrdinaryConversationMemoryNote } from '../../storage/ordinaryConversationMemoryNote';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import {
  canProposeReplyPreferenceSpan,
  validateAuthoredRoutineSpan,
  validateReplyPreferenceSpan,
} from '../authoredReplyPreferenceSpan';

const preference = '앞으로는 짧은 답변을 선호해요.';
const routine = '매일 책을 읽어요.';
const adjacent = '이번에는 자세히 설명해 주세요.';
const optOut = '이 메시지는 간직하지 말아 주세요.';

test('authored memory honors the existing no-retention language before offering or approving a span', () => {
  for (const span of [preference, routine]) {
    const request = span + ' ' + optOut;
    expect(canProposeReplyPreferenceSpan(request)).toBe(false);
    expect(validateReplyPreferenceSpan(request, span)).toBeUndefined();
    expect(validateAuthoredRoutineSpan(request, span)).toBeUndefined();
  }
});

test('the new refusal neither erases an ordinary eligible authored sentence nor rewrites it', () => {
  expect(
    validateReplyPreferenceSpan(preference + ' ' + adjacent, preference),
  ).toBe(preference);
  expect(validateAuthoredRoutineSpan(routine + ' ' + adjacent, routine)).toBe(
    routine,
  );
});

test('a forged but verbatim model span cannot open the protected write transaction after opt-out', async () => {
  const fixture = openSqliteTestDatabase(':memory:');
  try {
    const transaction = jest.fn(
      fixture.database.transaction.bind(fixture.database),
    );
    for (const [span, scope] of [
      [preference, 'reply-preferences'],
      [routine, 'authored-routine'],
    ] as const) {
      const choice =
        scope === 'reply-preferences'
          ? { replyPreferenceSpan: span }
          : { authoredRoutineSpan: span };
      await expect(
        saveOrdinaryConversationMemoryNote(
          {
            database: { ...fixture.database, transaction },
            generation: 1,
            scope,
            deviceEpoch: 'fixture',
            isCurrent: () => true,
          },
          {
            requestId: 'fixture',
            sessionId: 'fixture',
            sessionVersion: 1,
            question: span + ' ' + optOut,
            createdAt: '2026-01-01T00:00:00Z',
            ...choice,
          },
          true,
          () => true,
        ),
      ).resolves.toBe(false);
    }
    expect(transaction).not.toHaveBeenCalled();
  } finally {
    fixture.close();
  }
});
