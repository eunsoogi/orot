import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { NextVisitQuestionsScreen } from '../NextVisitQuestionsScreen';
import type { GenerationOutcome, NextVisitEvidenceReference } from '../types';
import {
  appointment,
  makeProps,
  questions,
  type Props,
} from '../testSupport/fixtures';

// Cold React Native test workers can need longer than Jest's five-second default.
jest.setTimeout(15000);

const savedQuestions = {
  status: 'ready' as const,
  appointmentId: appointment.id,
  // Existing reviewed questions stay visible until the person confirms a replacement.
  questions: questions.map((question, index) => ({
    ...question,
    questionText: `저장된 질문 ${index + 1}은 그대로 남아 있을까요?`,
  })),
  caveats: [],
};

test.each([
  [
    'rejected citations',
    {
      status: 'rejected_output' as const,
      message: '합성 인용 오류',
    },
  ],
  [
    'provider failure',
    {
      status: 'provider_unavailable' as const,
      message: '합성 제공자 오류',
    },
  ],
  [
    'denied consent',
    { status: 'consent_required' as const, message: '합성 동의 거부' },
  ],
])('retains the prior saved questions after %s', async (_label, outcome) => {
  const base = makeProps();
  const onSaveReviewedQuestions = jest.fn(base.onSaveReviewedQuestions);
  const props = makeProps({
    savedQuestions,
    onGenerate: async () => outcome,
    onSaveReviewedQuestions,
  });
  await render(<NextVisitQuestionsScreen {...props} />);

  await fireEvent.press(screen.getByTestId('next-visit-generate'));
  expect(
    await screen.findByTestId('next-visit-generation-message'),
  ).toHaveTextContent(outcome.message);
  expect(screen.getByTestId('next-visit-saved-list')).toBeTruthy();
  expect(
    screen.getByText(savedQuestions.questions[0]!.questionText),
  ).toBeTruthy();
  expect(screen.queryByTestId('next-visit-review-list')).toBeNull();
  expect(onSaveReviewedQuestions).not.toHaveBeenCalled();
});

test('leaves saved questions unchanged until a reviewed replacement is saved', async () => {
  const base = makeProps({
    savedQuestions,
    onGenerate: async () => ({ status: 'ready', questions, caveats: [] }),
  });
  const onSaveReviewedQuestions = jest.fn(base.onSaveReviewedQuestions);
  await render(
    <NextVisitQuestionsScreen
      {...makeProps({ ...base, savedQuestions, onSaveReviewedQuestions })}
    />,
  );

  await fireEvent.press(screen.getByTestId('next-visit-generate'));
  await screen.findByTestId('next-visit-review-list');
  expect(onSaveReviewedQuestions).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByTestId('next-visit-review-cancel'));

  expect(screen.getByTestId('next-visit-saved-list')).toBeTruthy();
  expect(
    screen.getByText(savedQuestions.questions[0]!.questionText),
  ).toBeTruthy();
  expect(onSaveReviewedQuestions).not.toHaveBeenCalled();

  await fireEvent.press(screen.getByTestId('next-visit-generate'));
  await screen.findByTestId('next-visit-review-list');
  await fireEvent.press(screen.getByTestId('next-visit-review-save'));

  expect(await screen.findByText(questions[0]!.questionText)).toBeTruthy();
  expect(
    screen.queryByText(savedQuestions.questions[0]!.questionText),
  ).toBeNull();
  expect(onSaveReviewedQuestions).toHaveBeenCalledTimes(1);
});

test('retains prior saved questions when a cancelled generation resolves late', async () => {
  let resolveOutcome!: (
    outcome: GenerationOutcome<NextVisitEvidenceReference>,
  ) => void;
  const onGenerate: Props['onGenerate'] = () =>
    new Promise(resolve => {
      resolveOutcome = resolve;
    });
  const base = makeProps();
  const onSaveReviewedQuestions = jest.fn(base.onSaveReviewedQuestions);
  await render(
    <NextVisitQuestionsScreen
      {...makeProps({ savedQuestions, onGenerate, onSaveReviewedQuestions })}
    />,
  );

  const pendingGeneration = fireEvent.press(
    screen.getByTestId('next-visit-generate'),
  );
  await screen.findByTestId('next-visit-generation-loading');
  await fireEvent.press(screen.getByTestId('next-visit-generation-cancel'));
  await act(async () => {
    resolveOutcome({ status: 'ready', questions, caveats: [] });
    await pendingGeneration;
  });

  expect(screen.getByTestId('next-visit-saved-list')).toBeTruthy();
  expect(
    screen.getByText(savedQuestions.questions[0]!.questionText),
  ).toBeTruthy();
  expect(screen.queryByTestId('next-visit-review-list')).toBeNull();
  expect(onSaveReviewedQuestions).not.toHaveBeenCalled();
});
