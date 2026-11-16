import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { InlineVisitQuestionCard } from '../InlineVisitQuestionCard';
import { createInlineVisitReview } from '../inlineVisitReview';
import { questions, theme } from '../testSupport/fixtures';

test('selects and edits a candidate without dropping the saved question', async () => {
  const onSave = jest.fn(async () => undefined);
  function Example() {
    const [state, setState] = useState(() =>
      createInlineVisitReview(
        'session-a:turn-a',
        [questions[0]!],
        [questions[1]!],
        [],
        () => 'new-question',
      ),
    );
    return (
      <InlineVisitQuestionCard
        state={state}
        onChange={setState}
        onSave={onSave}
        onOpenSource={() => undefined}
        theme={theme}
        isSaving={false}
      />
    );
  }
  await render(<Example />);
  await fireEvent.press(screen.getByTestId('inline-visit-select-1'));
  await fireEvent.changeText(
    screen.getByTestId('next-visit-question-text-1'),
    '수정한 질문을 확인할까요?',
  );
  await fireEvent.press(screen.getByTestId('inline-visit-save'));
  expect(onSave).toHaveBeenCalledWith(
    expect.objectContaining({
      questions: [
        expect.objectContaining({ identity: questions[0]!.identity }),
        expect.objectContaining({
          identity: { id: 'new-question' },
          questionText: '수정한 질문을 확인할까요?',
        }),
      ],
      expectedSavedQuestions: [{ id: 'fixture-1', revision: 'revision-1' }],
    }),
  );
});

test('does not save or claim success when no question is selected', async () => {
  const onSave = jest.fn(async () => undefined);
  function Example() {
    const [state, setState] = useState(() =>
      createInlineVisitReview(
        'session-a:turn-a',
        [],
        [questions[0]!],
        [],
        () => 'new-question',
      ),
    );
    return (
      <InlineVisitQuestionCard
        state={state}
        onChange={setState}
        onSave={onSave}
        onOpenSource={() => undefined}
        theme={theme}
        isSaving={false}
      />
    );
  }
  await render(<Example />);
  expect(
    screen.getByTestId('inline-visit-save').props.accessibilityState.disabled,
  ).toBe(true);
  await fireEvent.press(screen.getByTestId('inline-visit-save'));
  expect(onSave).not.toHaveBeenCalled();
});

test('uses one save checkbox per question and keeps importance a separate edit action', async () => {
  const onSave = jest.fn(async () => undefined);
  function Example() {
    const [state, setState] = useState(() =>
      createInlineVisitReview(
        'selection-owner',
        [],
        [{ ...questions[0]!, priority: 'important' }],
        [],
        () => 'candidate',
      ),
    );
    return (
      <InlineVisitQuestionCard
        state={state}
        onChange={setState}
        onSave={onSave}
        onOpenSource={() => undefined}
        theme={theme}
        isSaving={false}
      />
    );
  }
  await render(<Example />);
  expect(screen.getAllByRole('checkbox')).toHaveLength(1);
  expect(
    screen.getByRole('checkbox', { name: '질문 1 저장 선택' }),
  ).not.toBeChecked();
  expect(screen.getByTestId('inline-visit-save')).toBeDisabled();
  expect(screen.getByText('선택한 질문 저장')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('next-visit-question-details-0'));
  expect(screen.getAllByRole('checkbox')).toHaveLength(1);
  expect(
    screen.getByTestId('next-visit-question-priority-0').props
      .accessibilityState.selected,
  ).toBe(true);
  await fireEvent.press(screen.getByTestId('next-visit-question-priority-0'));
  expect(screen.getByTestId('inline-visit-select-0')).not.toBeChecked();
  await fireEvent.press(screen.getByTestId('inline-visit-select-0'));
  expect(screen.getByText('질문 1개 저장')).toBeTruthy();
  expect(screen.getByTestId('inline-visit-save')).not.toBeDisabled();
  await fireEvent.press(screen.getByTestId('inline-visit-save'));
  expect(onSave).toHaveBeenCalledWith(
    expect.objectContaining({
      questions: [expect.objectContaining({ priority: 'routine' })],
    }),
  );
});

test('locks selection and edits during save while keeping source controls available afterward', async () => {
  const onChange = jest.fn();
  const onOpenSource = jest.fn();
  const state = createInlineVisitReview(
    'saving-owner',
    [questions[0]!],
    [],
    [],
  );
  const props = {
    state,
    onChange,
    onSave: jest.fn(async () => undefined),
    onOpenSource,
    theme,
  };
  const view = await render(<InlineVisitQuestionCard {...props} isSaving />);
  expect(screen.getByTestId('inline-visit-select-0')).toBeDisabled();
  expect(screen.getByTestId('next-visit-question-details-0')).toBeDisabled();
  await fireEvent.press(screen.getByTestId('inline-visit-select-0'));
  expect(onChange).not.toHaveBeenCalled();
  await view.rerender(<InlineVisitQuestionCard {...props} isSaving={false} />);
  expect(screen.getByTestId('inline-visit-select-0')).toBeChecked();
  expect(screen.queryByTestId('next-visit-source-0-0')).toBeNull();
  await fireEvent.press(screen.getByTestId('next-visit-question-details-0'));
  await fireEvent.press(screen.getByTestId('next-visit-source-0-0'));
  expect(onOpenSource).toHaveBeenCalledWith(questions[0]!.citations[0]);
});

test('keeps completed-result limits in quiet details but leaves save failures visible', async () => {
  const state = createInlineVisitReview(
    'details-owner',
    [],
    [questions[0]!],
    ['public_search_not_retained'],
    () => 'candidate',
  );
  await render(
    <InlineVisitQuestionCard
      state={state}
      onChange={jest.fn()}
      onSave={jest.fn()}
      onOpenSource={jest.fn()}
      theme={theme}
      isSaving={false}
      saveMessage="저장 실패"
    />,
  );
  expect(screen.queryByText('새 질문')).toBeNull();
  expect(screen.queryByText('질문 1')).toBeNull();
  expect(screen.getByDisplayValue(questions[0]!.questionText)).toBeTruthy();
  expect(screen.queryByTestId('next-visit-caveats')).toBeNull();
  expect(
    screen.queryByTestId('next-visit-caveat-public_search_not_retained'),
  ).toBeNull();
  expect(screen.getByRole('alert')).toHaveTextContent('저장 실패');
  await fireEvent.press(screen.getByTestId('inline-visit-generation-details'));
  expect(
    screen.getByTestId('next-visit-caveat-public_search_not_retained'),
  ).toBeTruthy();
  await fireEvent.press(screen.getByTestId('inline-visit-generation-details'));
  expect(
    screen.queryByTestId('next-visit-caveat-public_search_not_retained'),
  ).toBeNull();
});
