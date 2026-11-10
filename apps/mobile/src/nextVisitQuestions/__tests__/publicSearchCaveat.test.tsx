import { fireEvent, render, screen } from '@testing-library/react-native';
import { NextVisitQuestionsScreen } from '../NextVisitQuestionsScreen';
import {
  appointment,
  makeProps,
  questions,
  type Props,
} from '../testSupport/fixtures';

test('shows the public-source limitation and carries it through review and save', async () => {
  const onSaveReviewedQuestions = jest.fn<
    ReturnType<Props['onSaveReviewedQuestions']>,
    Parameters<Props['onSaveReviewedQuestions']>
  >(async (_visit, reviewed, caveats) => ({
    questions: reviewed,
    caveats,
    memoryStatus: 'saved' as const,
  }));
  await render(
    <NextVisitQuestionsScreen
      {...makeProps({
        onGenerate: async () => ({
          status: 'ready',
          questions,
          caveats: ['public_search_not_retained'],
        }),
        onSaveReviewedQuestions,
      })}
    />,
  );
  await fireEvent.press(screen.getByTestId('next-visit-generate'));
  await screen.findByTestId('next-visit-review-list');
  expect(
    screen.getByText(
      '공개 웹검색은 실행됐지만, 검색 결과는 이 질문에 반영하거나 저장하지 않았어요.',
    ),
  ).toBeTruthy();
  await fireEvent.press(screen.getByTestId('next-visit-review-save'));
  expect(onSaveReviewedQuestions).toHaveBeenCalledWith(
    appointment,
    questions.map(question =>
      expect.objectContaining({
        ...question,
        identity: { id: expect.any(String) },
      }),
    ),
    ['public_search_not_retained'],
    [],
  );
});
