import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { appColors } from '../../layout/appColors';
import { FeatureEntryScreen } from '../FeatureEntryScreen';

test('prioritizes record conversation, groups preparation and review, and routes all four actions', async () => {
  const actions = {
    conversation: jest.fn(),
    questions: jest.fn(),
    symptoms: jest.fn(),
    literature: jest.fn(),
  };
  await render(
    <FeatureEntryScreen
      onOpenRagConversation={actions.conversation}
      onOpenVisitQuestions={actions.questions}
      onOpenDiseaseHypotheses={actions.symptoms}
      onOpenExternalEvidence={actions.literature}
    />,
  );

  const destinationIds = [
    'rag-conversation',
    'visit-questions',
    'disease-hypotheses',
    'external-evidence',
  ];
  const cards = screen.getAllByTestId(
    /^ai-feature-(rag-conversation|visit-questions|disease-hypotheses|external-evidence)$/,
  );
  expect(cards.map(card => card.props.testID)).toEqual(
    destinationIds.map(id => `ai-feature-${id}`),
  );
  expect(screen.queryByTestId('ai-feature-health-review')).toBeNull();
  expect(screen.getByText('진료를 준비해요')).toBeTruthy();
  expect(screen.getByText('기록을 더 살펴봐요')).toBeTruthy();
  expect(screen.getByText('대화 시작')).toBeTruthy();
  expect(
    StyleSheet.flatten(screen.getByText('대화 시작').props.style),
  ).toMatchObject({ color: appColors.primaryText });

  for (const id of destinationIds) {
    await fireEvent.press(screen.getByTestId(`ai-feature-${id}`));
  }
  Object.values(actions).forEach(action =>
    expect(action).toHaveBeenCalledTimes(1),
  );
});

test('keeps unavailable visit questions disabled with an accessible explanation', async () => {
  const conversation = jest.fn();
  const symptoms = jest.fn();
  await render(
    <FeatureEntryScreen
      onOpenRagConversation={conversation}
      onOpenDiseaseHypotheses={symptoms}
      onOpenExternalEvidence={jest.fn()}
    />,
  );

  const visitQuestions = screen.getByTestId('ai-feature-visit-questions');
  expect(visitQuestions.props.accessibilityState).toEqual({ disabled: true });
  expect(screen.getByTestId('visit-questions-unavailable')).toBeTruthy();

  await fireEvent.press(visitQuestions);
  expect(conversation).not.toHaveBeenCalled();
  expect(symptoms).not.toHaveBeenCalled();
});

test('keeps conversation copy in a full row above its scalable action cue', async () => {
  await render(
    <FeatureEntryScreen
      onOpenRagConversation={jest.fn()}
      onOpenVisitQuestions={jest.fn()}
      onOpenDiseaseHypotheses={jest.fn()}
      onOpenExternalEvidence={jest.fn()}
    />,
  );

  const card = screen.getByTestId('ai-feature-rag-conversation');
  const content = screen.getByTestId('ai-feature-rag-conversation-content');
  expect(StyleSheet.flatten(card.props.style)).toMatchObject({
    alignItems: 'stretch',
    flexDirection: 'column',
  });
  expect(StyleSheet.flatten(content.props.style)).toMatchObject({
    flexDirection: 'row',
    minWidth: 0,
  });
  expect(screen.getByText('기록과 대화')).toBeTruthy();
  expect(screen.getByText('내 기록에서 궁금한 점을 물어보세요.')).toBeTruthy();
  expect(screen.getByText('대화 시작')).toBeTruthy();
});
