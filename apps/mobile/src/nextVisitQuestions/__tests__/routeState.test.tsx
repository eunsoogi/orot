import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { NextVisitQuestionsScreen } from '../NextVisitQuestionsScreen';
import {
  appointment,
  makeProps,
  questions,
  type Props,
} from '../testSupport/fixtures';

// Cold React Native test workers can need longer than Jest's five-second default.
jest.setTimeout(15000);

test('publishes active generation so the route can guard navigation', async () => {
  let resolveGeneration!: (
    outcome: Awaited<ReturnType<Props['onGenerate']>>,
  ) => void;
  const onGenerate: Props['onGenerate'] = () =>
    new Promise(resolve => {
      resolveGeneration = resolve;
    });
  const onRouteStateChange = jest.fn();
  await render(
    <NextVisitQuestionsScreen
      {...makeProps({ onGenerate, onRouteStateChange })}
    />,
  );

  const latestState = () =>
    onRouteStateChange.mock.calls.at(-1)?.[0] as
      | {
          hasUnsavedChanges: boolean;
          isSaving: boolean;
          isGenerating?: boolean;
        }
      | undefined;

  await fireEvent.press(screen.getByTestId('next-visit-generate'));
  await screen.findByTestId('next-visit-generation-loading');
  expect(latestState()?.isGenerating).toBe(true);

  await act(async () => {
    resolveGeneration({ status: 'ready', questions, caveats: [] });
    await Promise.resolve();
  });
  await screen.findByTestId('next-visit-review-list');
  expect(latestState()).toMatchObject({
    hasUnsavedChanges: true,
    isSaving: false,
    isGenerating: false,
  });
});

test('publishes generated draft and save ownership with increasing revisions', async () => {
  let resolveSave!: (
    result: Awaited<ReturnType<Props['onSaveReviewedQuestions']>>,
  ) => void;
  const onSaveReviewedQuestions: Props['onSaveReviewedQuestions'] = () =>
    new Promise(resolve => {
      resolveSave = resolve;
    });
  const onRouteStateChange = jest.fn();
  const props = makeProps({ onRouteStateChange, onSaveReviewedQuestions });
  await render(<NextVisitQuestionsScreen {...props} />);

  const latestState = () =>
    onRouteStateChange.mock.calls.at(-1)?.[0] as {
      hasUnsavedChanges: boolean;
      isSaving: boolean;
      revision: number;
    };
  expect(latestState()).toMatchObject({
    hasUnsavedChanges: false,
    isSaving: false,
  });

  await fireEvent.press(screen.getByTestId('next-visit-generate'));
  await screen.findByTestId('next-visit-review-list');
  expect(latestState()).toMatchObject({
    hasUnsavedChanges: true,
    isSaving: false,
  });

  await fireEvent.press(screen.getByTestId('next-visit-review-save'));
  expect(latestState()).toMatchObject({
    hasUnsavedChanges: true,
    isSaving: true,
  });
  await act(async () => {
    resolveSave({
      questions,
      caveats: ['conflicting_records'],
      memoryStatus: 'saved',
    });
    await Promise.resolve();
  });

  expect(latestState()).toMatchObject({
    hasUnsavedChanges: false,
    isSaving: false,
  });
  const revisions = onRouteStateChange.mock.calls.map(
    ([state]) => (state as { revision: number }).revision,
  );
  expect(revisions.length).toBeGreaterThan(1);
  expect(
    revisions.every(
      (revision, index) => index === 0 || revision > revisions[index - 1]!,
    ),
  ).toBe(true);
});

test('publishes the current route state when its callback is replaced', async () => {
  const previousCallback = jest.fn();
  const nextCallback = jest.fn();
  const props = makeProps({ onRouteStateChange: previousCallback });
  const { rerender } = await render(<NextVisitQuestionsScreen {...props} />);

  await fireEvent.press(screen.getByTestId('next-visit-generate'));
  await screen.findByTestId('next-visit-review-list');
  const previousState = previousCallback.mock.calls.at(-1)?.[0] as {
    hasUnsavedChanges: boolean;
    isSaving: boolean;
    revision: number;
  };
  expect(previousState).toMatchObject({
    hasUnsavedChanges: true,
    isSaving: false,
  });

  await act(async () => {
    rerender(
      <NextVisitQuestionsScreen {...props} onRouteStateChange={nextCallback} />,
    );
  });

  expect(nextCallback).toHaveBeenCalledTimes(1);
  expect(nextCallback.mock.calls[0]?.[0]).toMatchObject({
    hasUnsavedChanges: true,
    isSaving: false,
    revision: previousState.revision,
  });
});

test('marks edited saved questions dirty, preserves that state after save failure, and clears on cancel', async () => {
  const onSaveReviewedQuestions = jest.fn<
    ReturnType<Props['onSaveReviewedQuestions']>,
    Parameters<Props['onSaveReviewedQuestions']>
  >();
  onSaveReviewedQuestions.mockRejectedValueOnce(new Error('synthetic failure'));
  const onRouteStateChange = jest.fn();
  const props = makeProps({
    onRouteStateChange,
    onSaveReviewedQuestions,
    savedQuestions: {
      status: 'ready',
      appointmentId: appointment.id,
      questions,
      caveats: ['conflicting_records'],
    },
  });
  await render(<NextVisitQuestionsScreen {...props} />);
  const latestState = () =>
    onRouteStateChange.mock.calls.at(-1)?.[0] as {
      hasUnsavedChanges: boolean;
      isSaving: boolean;
    };

  await fireEvent.press(screen.getByTestId('next-visit-saved-edit'));
  expect(latestState()).toMatchObject({
    hasUnsavedChanges: false,
    isSaving: false,
  });
  await fireEvent.changeText(
    screen.getByTestId('next-visit-question-text-0'),
    '수정 전 저장 질문은 아직 보존되어 있습니다.',
  );
  expect(latestState()).toMatchObject({
    hasUnsavedChanges: true,
    isSaving: false,
  });

  await fireEvent.press(screen.getByTestId('next-visit-review-save'));
  expect(
    await screen.findByText(
      '질문을 저장하지 못했어요. 수정 내용은 남아 있어요.',
    ),
  ).toBeTruthy();
  expect(latestState()).toMatchObject({
    hasUnsavedChanges: true,
    isSaving: false,
  });

  await fireEvent.press(screen.getByTestId('next-visit-review-cancel'));
  expect(latestState()).toMatchObject({
    hasUnsavedChanges: false,
    isSaving: false,
  });
});
