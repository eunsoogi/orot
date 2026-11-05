import { act, renderHook } from '@testing-library/react-native';
import { useNextVisitQuestionsController } from '../controller';
import { makeProps } from '../testSupport/fixtures';

test('generation assigns fresh identities that survive edits and reordering', async () => {
  const { result } = await renderHook(() =>
    useNextVisitQuestionsController(makeProps()),
  );
  await act(async () => {
    await result.current.generate();
  });
  const original = result.current.draftQuestions.map(
    question => question.identity!.id,
  );
  expect(new Set(original).size).toBe(original.length);
  await act(async () => {
    result.current.updateQuestion(0, {
      questionText: '수정한 질문을 확인할까요?',
    });
    result.current.moveQuestion(1, -1);
  });
  expect(
    result.current.draftQuestions.map(question => question.identity!.id),
  ).toEqual([original[1], original[0], original[2]]);
  await act(async () => {
    result.current.cancelReview();
    await result.current.generate();
  });
  expect(
    result.current.draftQuestions.every(
      question => !original.includes(question.identity!.id),
    ),
  ).toBe(true);
});
