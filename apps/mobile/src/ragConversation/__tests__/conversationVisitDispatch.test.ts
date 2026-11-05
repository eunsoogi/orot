import { shouldPrepareVisitQuestions } from '../conversationVisitDispatch';

test('visit entry prepares only its first turn, while follow-ups stay conversation turns', () => {
  const entry = {
    intent: 'visit-questions' as const,
    entryKey: 'entry',
    appointmentId: 'visit',
  };
  expect(shouldPrepareVisitQuestions(entry, [])).toBe(true);
  expect(
    shouldPrepareVisitQuestions(entry, [
      { role: 'user', content: '이전 요청' },
    ]),
  ).toBe(false);
  expect(
    shouldPrepareVisitQuestions(
      { intent: 'conversation', entryKey: 'other' },
      [],
    ),
  ).toBe(false);
});
