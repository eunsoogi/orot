import { fireEvent, render, screen } from '@testing-library/react-native';
import { FeatureEntryScreen } from '../FeatureEntryScreen';

test('explains all four actions and routes each card to its owner', async () => {
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
  expect(screen.getByText('질환 가능성 살펴보기')).toBeTruthy();
  expect(screen.getByText('건강 기록과 대화하기')).toBeTruthy();
  expect(screen.getByText('의료 자료 찾아보기')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('ai-feature-visit-questions'));
  await fireEvent.press(screen.getByTestId('ai-feature-disease-hypotheses'));
  await fireEvent.press(screen.getByTestId('ai-feature-rag-conversation'));
  await fireEvent.press(screen.getByTestId('ai-feature-external-evidence'));
  actions.forEach(action => expect(action).toHaveBeenCalledTimes(1));
});
