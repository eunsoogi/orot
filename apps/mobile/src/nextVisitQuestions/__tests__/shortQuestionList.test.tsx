import { fireEvent, render, screen } from '@testing-library/react-native';
import { NextVisitQuestionsScreen } from '../NextVisitQuestionsScreen';
import { makeProps, questions } from '../testSupport/fixtures';

test.each([1, 2])(
  'reviews %i candidates without adding filler',
  async count => {
    await render(
      <NextVisitQuestionsScreen
        {...makeProps({
          onGenerate: async () => ({
            status: 'ready',
            questions: questions.slice(0, count),
            caveats: [],
          }),
        })}
      />,
    );
    await fireEvent.press(screen.getByTestId('next-visit-generate'));
    expect(await screen.findByTestId('next-visit-review-list')).toBeTruthy();
    expect(screen.getByDisplayValue(questions[0]!.questionText)).toBeTruthy();
    expect(screen.queryByDisplayValue(questions[2]!.questionText)).toBeNull();
  },
);
