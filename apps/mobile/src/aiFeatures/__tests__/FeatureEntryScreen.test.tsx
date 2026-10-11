import { fireEvent, render, screen } from '@testing-library/react-native';
import { FeatureEntryScreen } from '../FeatureEntryScreen';

test('explains the three actions and routes each card to its owner', async () => {
  const actions = [jest.fn(), jest.fn(), jest.fn(), jest.fn()];
  await render(
    <FeatureEntryScreen
      onOpenVisitQuestions={actions[0]}
      onOpenDiseaseHypotheses={actions[1]}
      onOpenRagConversation={actions[2]}
      onOpenExternalEvidence={actions[3]}
    />,
  );

  expect(screen.getByText('다음 진료 질문')).toBeTruthy();
  expect(screen.getByText('증상 정리')).toBeTruthy();
  expect(screen.getByText('기록과 대화')).toBeTruthy();
  expect(screen.queryByText('의학 자료 찾기')).toBeNull();
  await fireEvent.press(screen.getByTestId('ai-feature-visit-questions'));
  await fireEvent.press(screen.getByTestId('ai-feature-disease-hypotheses'));
  await fireEvent.press(screen.getByTestId('ai-feature-rag-conversation'));
  expect(screen.queryByTestId('ai-feature-external-evidence')).toBeNull();
  actions
    .slice(0, 3)
    .forEach(action => expect(action).toHaveBeenCalledTimes(1));
});
