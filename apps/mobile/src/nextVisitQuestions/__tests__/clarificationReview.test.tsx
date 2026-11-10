import { fireEvent, render, screen } from '@testing-library/react-native';
import { NextVisitQuestionsScreen } from '../NextVisitQuestionsScreen';
import { clarificationQuestions } from '../../agent/visitQuestions/clarificationQuestions';
import { appointment, makeProps, questions } from '../testSupport/fixtures';

test('keeps saved questions separate while selecting and saving a mixed review', async () => {
  const clarification = {
    ...clarificationQuestions[0]!,
    kind: 'clarification' as const,
    priority: 'routine' as const,
    citations: [],
  };
  const generated = [questions[0]!, clarification, questions[1]!];
  const saved = {
    ...questions[0]!,
    questionText: '이전에 저장한 질문을 확인할까요?',
  };
  const onSaveReviewedQuestions = jest.fn(makeProps().onSaveReviewedQuestions);
  const props = makeProps({
    savedQuestions: {
      status: 'ready',
      appointmentId: appointment.id,
      questions: [saved],
      caveats: [],
    },
    onGenerate: async () => ({
      status: 'ready',
      questions: generated,
      caveats: ['incomplete_coverage'],
    }),
    onSaveReviewedQuestions,
  });
  await render(<NextVisitQuestionsScreen {...props} />);
  await fireEvent.press(screen.getByTestId('next-visit-generate'));
  await screen.findByTestId('next-visit-review-list');
  expect(screen.getByText('의료진에게 확인할 질문')).toBeTruthy();
  expect(props.onSaveReviewedQuestions).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByTestId('next-visit-question-details-2'));
  await fireEvent.press(screen.getByTestId('next-visit-question-remove-2'));
  await fireEvent.press(screen.getByTestId('next-visit-review-save'));
  expect(props.onSaveReviewedQuestions).toHaveBeenCalledWith(
    appointment,
    [
      expect.objectContaining({
        ...generated[0],
        identity: { id: expect.any(String) },
      }),
      expect.objectContaining({
        ...clarification,
        identity: { id: expect.any(String) },
      }),
    ],
    ['incomplete_coverage'],
    [{ id: 'fixture-1', revision: 'revision-1' }],
  );
  await fireEvent.press(await screen.findByTestId('next-visit-saved-edit'));
  expect(screen.getByTestId('next-visit-question-text-1')).toHaveDisplayValue(
    clarification.questionText,
  );
});

test('allows editing and removing a restored legacy question without relabeling it', async () => {
  const legacy = {
    ...questions[0]!,
    identity: { id: 'legacy', expectedRevision: 'original' },
    citations: [],
    legacySource: { id: 'legacy', revision: 'original' },
  };
  const onSaveReviewedQuestions = jest.fn(makeProps().onSaveReviewedQuestions);
  await render(
    <NextVisitQuestionsScreen
      {...makeProps({
        savedQuestions: {
          status: 'ready',
          appointmentId: appointment.id,
          questions: [legacy, questions[1]!],
          caveats: [],
        },
        onSaveReviewedQuestions,
      })}
    />,
  );
  await fireEvent.press(screen.getByTestId('next-visit-saved-edit'));
  expect(screen.getByText('원문 위치를 복원하지 못한 저장 질문')).toBeTruthy();
  await fireEvent.changeText(
    screen.getByTestId('next-visit-question-text-0'),
    '수정한 이전 질문을 확인할까요?',
  );
  await fireEvent.press(screen.getByTestId('next-visit-question-details-1'));
  await fireEvent.press(screen.getByTestId('next-visit-question-remove-1'));
  await fireEvent.press(screen.getByTestId('next-visit-review-save'));
  expect(onSaveReviewedQuestions).toHaveBeenCalledWith(
    appointment,
    [{ ...legacy, questionText: '수정한 이전 질문을 확인할까요?' }],
    [],
    [
      { id: 'legacy', revision: 'original' },
      { id: 'fixture-2', revision: 'revision-2' },
    ],
  );
});
