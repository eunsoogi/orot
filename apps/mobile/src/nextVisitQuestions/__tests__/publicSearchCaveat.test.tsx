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

test.each([
  [
    'public_search_offline',
    '인터넷에 연결되어 있지 않아 공개 웹검색 결과를 반영하지 않았어요.',
  ],
  [
    'public_search_unsupported',
    '선택한 AI는 공개 웹검색을 지원하지 않아 검색 결과를 반영하지 않았어요.',
  ],
  [
    'public_search_not_configured',
    '현재 선택한 AI 설정에서는 공개 웹검색을 연결할 수 없어 검색 결과를 반영하지 않았어요.',
  ],
  [
    'public_search_failed',
    '공개 웹검색을 완료하지 못해 검색 결과를 반영하지 않았어요. 다시 시도할 수 있어요.',
  ],
] as const)(
  'shows %s alongside locally generated questions',
  async (caveat, message) => {
    await render(
      <NextVisitQuestionsScreen
        {...makeProps({
          onGenerate: async () => ({
            status: 'ready',
            questions,
            caveats: [caveat],
          }),
        })}
      />,
    );
    await fireEvent.press(screen.getByTestId('next-visit-generate'));
    expect(await screen.findByTestId('next-visit-review-list')).toBeTruthy();
    expect(screen.getByText(message)).toBeTruthy();
    expect(screen.getByDisplayValue(questions[0]!.questionText)).toBeTruthy();
  },
);
