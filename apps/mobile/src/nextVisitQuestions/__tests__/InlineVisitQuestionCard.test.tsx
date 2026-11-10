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
