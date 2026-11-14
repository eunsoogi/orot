import { render, screen } from '@testing-library/react-native';
import { QuestionCard } from '../QuestionCard';
import { questions, theme } from '../testSupport/fixtures';

test('keeps saved question identity independent of its exact reviewed wording', async () => {
  const question = {
    ...questions[0]!,
    questionText: '검토해 수정한 합성 질문',
  };
  await render(
    <QuestionCard
      count={1}
      editable={false}
      index={0}
      onMove={() => undefined}
      onOpenSource={() => undefined}
      onRemove={() => undefined}
      onUpdate={() => undefined}
      question={question}
      theme={theme}
      disabled={false}
    />,
  );
  expect(
    screen.getByTestId('next-visit-saved-question-text-0').props.children,
  ).toBe(question.questionText);
  expect(screen.queryByTestId('next-visit-question-text-0')).toBeNull();
});
