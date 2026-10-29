import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { FeatureEntryScreen } from '../FeatureEntryScreen';

test('explains the four actions and routes each card to its owner', async () => {
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
  expect(screen.getByText('의학 자료 찾기')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('ai-feature-visit-questions'));
  await fireEvent.press(screen.getByTestId('ai-feature-disease-hypotheses'));
  await fireEvent.press(screen.getByTestId('ai-feature-rag-conversation'));
  await fireEvent.press(screen.getByTestId('ai-feature-external-evidence'));
  actions.forEach(action => expect(action).toHaveBeenCalledTimes(1));
});

test('keeps every action in one evenly spaced list without a gap before literature search', async () => {
  const actions = [jest.fn(), jest.fn(), jest.fn(), jest.fn()];
  await render(
    <FeatureEntryScreen
      onOpenVisitQuestions={actions[0]}
      onOpenDiseaseHypotheses={actions[1]}
      onOpenRagConversation={actions[2]}
      onOpenExternalEvidence={actions[3]}
    />,
  );

  const rows = screen.getAllByTestId(
    /^ai-feature-(visit-questions|disease-hypotheses|rag-conversation|external-evidence)$/,
  );
  const list = rows[0]?.parent?.parent;
  expect(rows.map(row => row.props.testID)).toEqual([
    'ai-feature-visit-questions',
    'ai-feature-disease-hypotheses',
    'ai-feature-rag-conversation',
    'ai-feature-external-evidence',
  ]);
  expect(rows.every(row => row.parent?.parent === list)).toBe(true);
  expect(StyleSheet.flatten(list?.props.style).gap).toBe(16);
  expect(
    StyleSheet.flatten(
      screen.getByTestId('ai-features-screen').props.contentContainerStyle,
    ).paddingHorizontal,
  ).toBe(20);
  for (const id of [
    'visit-questions',
    'disease-hypotheses',
    'rag-conversation',
    'external-evidence',
  ]) {
    expect(screen.getByTestId(`ai-feature-${id}`)).toBeTruthy();
  }
  actions.forEach(action => expect(action).not.toHaveBeenCalled());
});
