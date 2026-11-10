import { questions } from '../testSupport/fixtures';
import {
  createInlineVisitReview,
  inlineReviewCommitted,
  inlineReviewMove,
  inlineReviewSelection,
  inlineReviewToggle,
  inlineReviewUpdate,
} from '../inlineVisitReview';

test('keeps saved questions while new candidates are selected, edited and reordered', () => {
  const original = createInlineVisitReview(
    'session-a:turn-a',
    [questions[0]!],
    [questions[1]!, questions[2]!],
    [],
    (() => {
      let i = 0;
      return () => `new-${++i}`;
    })(),
  );
  expect(
    inlineReviewSelection(original)?.questions.map(q => q.identity?.id),
  ).toEqual(['fixture-1']);
  const selected = inlineReviewToggle(original, 'new-1');
  const edited = inlineReviewUpdate(selected, 'new-1', {
    questionText: '가'.repeat(240) + '?',
  });
  const moved = inlineReviewMove(edited, 'new-1', -1);
  expect(
    inlineReviewSelection(moved)?.questions.map(q => q.identity?.id),
  ).toEqual(['new-1', 'fixture-1']);
  expect(inlineReviewSelection(moved)?.questions[0]?.questionText).toBe(
    '가'.repeat(240) + '?',
  );
  expect(inlineReviewSelection(moved)?.expectedSavedQuestions).toEqual([
    { id: 'fixture-1', revision: 'revision-1' },
  ]);
  expect(
    inlineReviewSelection(original)?.questions.map(q => q.identity?.id),
  ).toEqual(['fixture-1']);
});

test('zero selection is a no-op and regenerated candidates cannot overwrite an earlier draft', () => {
  const first = createInlineVisitReview(
    'session-a:turn-a',
    [],
    [questions[0]!],
    [],
    () => 'run-one',
  );
  expect(inlineReviewSelection(first)).toBeNull();
  const edited = inlineReviewUpdate(
    inlineReviewToggle(first, 'run-one'),
    'run-one',
    { questionText: '이전 수정 질문을 확인할까요?' },
  );
  const next = createInlineVisitReview(
    'session-a:turn-a',
    [],
    [questions[0]!],
    [],
    () => 'run-two',
  );
  expect(inlineReviewSelection(edited)?.questions[0]).toMatchObject({
    questionText: '이전 수정 질문을 확인할까요?',
    identity: { id: 'run-one' },
  });
  expect(next.items[0]?.question.identity?.id).toBe('run-two');
  expect(inlineReviewSelection(next)).toBeNull();
});

test('a late save acknowledgement cannot change a different conversation owner', () => {
  const other = createInlineVisitReview(
    'session-b:turn-b',
    [],
    [questions[0]!],
    [],
    () => 'other',
  );
  const saved = [
    {
      ...questions[0]!,
      identity: { id: 'saved', expectedRevision: 'new-revision' },
    },
  ];
  expect(inlineReviewCommitted(other, 'session-a:turn-a', saved)).toBe(other);
});
