import { fireEvent, render, screen } from '@testing-library/react-native';
import { NextVisitQuestionsScreen } from '../NextVisitQuestionsScreen';
import {
  appointment,
  makeProps,
  questions,
  source,
  type Props,
} from '../testSupport/fixtures';

// Cold React Native test workers can need longer than Jest's five-second default.
jest.setTimeout(15000);

test('keeps generation disabled for an unavailable provider and opens selection', async () => {
  const onOpenProviderSelection = jest.fn();
  const props = makeProps({
    provider: {
      status: 'unavailable',
      selection: { providerId: 'synthetic-provider', modelId: 'fixture-model' },
      displayName: '합성 제공자',
      privacyBoundary: 'selected-context-remote',
      message: '합성 상태: 제공자를 사용할 수 없습니다.',
    },
    onOpenProviderSelection,
  });
  await render(<NextVisitQuestionsScreen {...props} />);

  expect(screen.getByText('합성 진료 예약')).toBeTruthy();
  expect(screen.getByTestId('next-visit-generate')).toBeDisabled();
  expect(
    screen.getByText('선택한 자료가 선택한 외부 제공자에게 전달될 수 있어요.'),
  ).toBeTruthy();
  await fireEvent.press(screen.getByTestId('next-visit-provider-select'));
  expect(onOpenProviderSelection).toHaveBeenCalledTimes(1);
  expect(props.onGenerate).not.toHaveBeenCalled();
});

test('disables provider selection while its availability is loading', async () => {
  const props = makeProps({
    provider: { status: 'loading', selection: null },
  });
  await render(<NextVisitQuestionsScreen {...props} />);

  expect(screen.getByText('저장된 AI 선택을 확인하고 있어요.')).toBeTruthy();
  expect(screen.getByTestId('next-visit-provider-select')).toBeDisabled();
  expect(screen.getByTestId('next-visit-generate')).toBeDisabled();
});

test('does not offer generation when no confirmed appointment is available', async () => {
  const props = makeProps({ appointment: { status: 'empty' } });
  await render(<NextVisitQuestionsScreen {...props} />);

  expect(
    screen.getByText('다가오는 확정 캘린더 예약을 찾지 못했어요.'),
  ).toBeTruthy();
  expect(screen.getByTestId('next-visit-generate')).toBeDisabled();
  expect(props.onGenerate).not.toHaveBeenCalled();
});

test('opens evidence and lets the person edit, reorder, save, and cancel a later edit', async () => {
  const onOpenSource = jest.fn();
  const onSaveReviewedQuestions = jest.fn<
    ReturnType<Props['onSaveReviewedQuestions']>,
    Parameters<Props['onSaveReviewedQuestions']>
  >();
  onSaveReviewedQuestions.mockImplementation(async (_visit, reviewed) => ({
    questions: reviewed,
    memoryStatus: 'saved',
  }));
  const props = makeProps({ onOpenSource, onSaveReviewedQuestions });
  await render(<NextVisitQuestionsScreen {...props} />);

  await fireEvent.press(screen.getByTestId('next-visit-generate'));
  expect(props.onGenerate).toHaveBeenCalledWith(
    appointment,
    { providerId: 'synthetic-provider', modelId: 'fixture-model' },
    expect.any(AbortSignal),
  );
  expect(await screen.findByTestId('next-visit-review-list')).toBeTruthy();
  expect(screen.getByText('질문 1의 이유')).toBeTruthy();
  expect(
    screen.getByText(
      '기록에 서로 다른 내용이 있어 질문을 저장하기 전에 확인해 주세요.',
    ),
  ).toBeTruthy();
  await fireEvent.changeText(
    screen.getByTestId('next-visit-question-text-0'),
    '수정한 증상 변화 질문',
  );
  await fireEvent.press(screen.getByTestId('next-visit-source-0-0'));
  expect(screen.getByTestId('next-visit-source-content').props.children).toBe(
    source.content,
  );
  expect(onOpenSource).toHaveBeenCalledWith(source);
  await fireEvent.press(screen.getByTestId('next-visit-source-close'));

  await fireEvent.press(screen.getByTestId('next-visit-question-up-1'));
  await fireEvent.press(screen.getByTestId('next-visit-question-remove-2'));
  await fireEvent.press(screen.getByTestId('next-visit-review-save'));
  expect(
    await screen.findByText('검토한 질문을 이 예약에 저장했어요.'),
  ).toBeTruthy();
  expect(onSaveReviewedQuestions).toHaveBeenCalledWith(appointment, [
    questions[1],
    { ...questions[0], questionText: '수정한 증상 변화 질문' },
  ]);

  await fireEvent.press(screen.getByTestId('next-visit-saved-edit'));
  await fireEvent.changeText(
    screen.getByTestId('next-visit-question-text-0'),
    '임시 수정은 저장 목록에 반영되지 않습니다.',
  );
  await fireEvent.press(screen.getByTestId('next-visit-review-cancel'));
  expect(screen.getByTestId('next-visit-saved-list')).toBeTruthy();
  expect(screen.getByText(questions[1].questionText)).toBeTruthy();
});

test('preserves edited questions when saving fails', async () => {
  const onSaveReviewedQuestions = jest.fn<
    ReturnType<Props['onSaveReviewedQuestions']>,
    Parameters<Props['onSaveReviewedQuestions']>
  >();
  onSaveReviewedQuestions.mockRejectedValueOnce(new Error('synthetic failure'));
  const props = makeProps({ onSaveReviewedQuestions });
  await render(<NextVisitQuestionsScreen {...props} />);

  await fireEvent.press(screen.getByTestId('next-visit-generate'));
  await screen.findByTestId('next-visit-review-list');
  await fireEvent.changeText(
    screen.getByTestId('next-visit-question-text-0'),
    '저장 실패 뒤에도 남아 있는 질문',
  );
  await fireEvent.press(screen.getByTestId('next-visit-review-save'));

  expect(
    await screen.findByText(
      '질문을 저장하지 못했어요. 수정 내용은 남아 있어요.',
    ),
  ).toBeTruthy();
  expect(screen.getByTestId('next-visit-question-text-0').props.value).toBe(
    '저장 실패 뒤에도 남아 있는 질문',
  );
});
