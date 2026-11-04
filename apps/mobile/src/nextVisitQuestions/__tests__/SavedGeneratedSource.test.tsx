import { fireEvent, render, screen } from '@testing-library/react-native';
import { NextVisitQuestionsScreen } from '../NextVisitQuestionsScreen';
import {
  appointment,
  makeProps,
  questions,
  source,
} from '../testSupport/fixtures';

test('opens restored generated context as an earlier AI result', async () => {
  const onOpenSource = jest.fn();
  const generated = {
    ...source,
    sourceKind: 'generated_artifact' as const,
    sourceId: 'opaque-generated',
  };
  await render(
    <NextVisitQuestionsScreen
      {...makeProps({
        onOpenSource,
        savedQuestions: {
          status: 'ready',
          appointmentId: appointment.id,
          questions: [
            {
              ...questions[0]!,
              citations: [],
              generatedArtifactContext: [generated],
            },
          ],
          caveats: [],
        },
      })}
    />,
  );
  await fireEvent.press(screen.getByText('생성에 사용한 이전 AI 결과 보기'));
  expect(onOpenSource).toHaveBeenCalledWith(generated);
});

test('does not duplicate an AI source already shown as a citation', async () => {
  const generated = {
    ...source,
    sourceKind: 'generated_artifact' as const,
    sourceId: 'opaque-generated',
  };
  await render(
    <NextVisitQuestionsScreen
      {...makeProps({
        savedQuestions: {
          status: 'ready',
          appointmentId: appointment.id,
          questions: [
            {
              ...questions[0]!,
              citations: [generated],
              generatedArtifactContext: [generated],
            },
          ],
          caveats: [],
        },
      })}
    />,
  );
  expect(screen.getByTestId('next-visit-source-0-0')).toBeTruthy();
  expect(screen.queryByText('생성에 사용한 이전 AI 결과 보기')).toBeNull();
});
