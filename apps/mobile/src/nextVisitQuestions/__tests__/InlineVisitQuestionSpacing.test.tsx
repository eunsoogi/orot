import { fireEvent, render, screen } from '@testing-library/react-native';
import { InlineVisitQuestionCard } from '../InlineVisitQuestionCard';
import { QuestionCard } from '../QuestionCard';
import { createQuestionCardStyles } from '../questionCardStyles';
import { createInlineVisitReview } from '../inlineVisitReview';
import { questions, theme } from '../testSupport/fixtures';

/** Component contracts prove spacing/controls, not UIKit geometry or Dynamic Type rendering. */
test('removes nested inline padding while preserving full wording, touch targets and edit controls', async () => {
  let sequence = 0;
  const state = createInlineVisitReview(
    'synthetic-spacing',
    [],
    questions,
    [],
    () => `synthetic-${++sequence}`,
  );
  await render(
    <InlineVisitQuestionCard
      state={state}
      onChange={jest.fn()}
      onSave={jest.fn()}
      onOpenSource={jest.fn()}
      theme={theme}
      isSaving={false}
    />,
  );
  expect(screen.getByTestId('inline-visit-review')).toHaveStyle({ gap: 8 });
  expect(createQuestionCardStyles(theme, true).headingRow).toMatchObject({
    gap: 0,
  });
  expect(createQuestionCardStyles(theme, true).headingRow).not.toHaveProperty(
    'marginHorizontal',
  );
  expect(createQuestionCardStyles(theme).headingRow).toMatchObject({
    gap: 8,
  });
  expect(screen.getByTestId('next-visit-question-0')).toHaveStyle({
    paddingHorizontal: 0,
    paddingVertical: 4,
  });
  expect(screen.getByTestId('inline-visit-select-0')).toHaveStyle({
    minHeight: 44,
  });
  expect(screen.getByTestId('next-visit-question-details-0')).toHaveStyle({
    minWidth: 44,
    minHeight: 44,
  });
  expect(screen.getByTestId('next-visit-question-text-0')).toHaveStyle({
    minHeight: 44,
    fontSize: 16,
  });
  expect(screen.getByTestId('next-visit-question-text-0').props.multiline).toBe(
    true,
  );
  expect(screen.getByTestId('next-visit-question-text-0').props.value).toBe(
    questions[0]!.questionText,
  );
  await fireEvent.press(screen.getByTestId('next-visit-question-details-0'));
  expect(
    screen.getByTestId('next-visit-question-rationale-0').props.scrollEnabled,
  ).toBe(false);
  expect(
    screen.getByTestId('next-visit-question-text-0').props.scrollEnabled,
  ).toBe(false);
});

test('keeps the standalone question card padding unchanged', async () => {
  await render(
    <QuestionCard
      question={questions[0]!}
      index={0}
      count={1}
      editable
      disabled={false}
      theme={theme}
      onUpdate={jest.fn()}
      onMove={jest.fn()}
      onRemove={jest.fn()}
      onOpenSource={jest.fn()}
    />,
  );
  expect(screen.getByTestId('next-visit-question-0')).toHaveStyle({
    paddingHorizontal: 12,
    paddingVertical: 12,
  });
});

test('keeps long editable questions untruncated without a nested scroll owner', async () => {
  const wording = '합성 긴 질문의 전체 문장을 화면에서 확인해요. '.repeat(50);
  await render(
    <QuestionCard
      question={{ ...questions[0]!, questionText: wording }}
      index={0}
      count={1}
      editable
      disabled={false}
      theme={theme}
      onUpdate={jest.fn()}
      onMove={jest.fn()}
      onRemove={jest.fn()}
      onOpenSource={jest.fn()}
    />,
  );
  const input = screen.getByTestId('next-visit-question-text-0');
  expect(input.props.value).toBe(wording);
  expect(input.props.multiline).toBe(true);
  expect(input.props.scrollEnabled).toBe(false);
  expect(input.props.numberOfLines).toBeUndefined();
  expect(createQuestionCardStyles(theme).questionInput).not.toHaveProperty(
    'height',
  );
  expect(createQuestionCardStyles(theme).questionInput).not.toHaveProperty(
    'maxHeight',
  );
});
