import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { appColors } from '../../layout/appColors';
import { FeatureEntryScreen } from '../FeatureEntryScreen';

test('prioritizes record conversation, groups preparation and review, and routes all five actions', async () => {
  const actions = {
    conversation: jest.fn(),
    questions: jest.fn(),
    symptoms: jest.fn(),
    healthReview: jest.fn(),
    literature: jest.fn(),
  };
  await render(
    <FeatureEntryScreen
      onOpenRagConversation={actions.conversation}
      onOpenVisitQuestions={actions.questions}
      onOpenDiseaseHypotheses={actions.symptoms}
      onOpenHealthReview={actions.healthReview}
      onOpenExternalEvidence={actions.literature}
    />,
  );

  const destinationIds = [
    'rag-conversation',
    'visit-questions',
    'disease-hypotheses',
    'health-review',
    'external-evidence',
  ];
  const cards = screen.getAllByTestId(
    /^ai-feature-(rag-conversation|visit-questions|disease-hypotheses|health-review|external-evidence)$/,
  );
  expect(cards.map(card => card.props.testID)).toEqual(
    destinationIds.map(id => `ai-feature-${id}`),
  );
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
      onOpenHealthReview={jest.fn()}
    />,
  );

  const visitQuestions = screen.getByTestId('ai-feature-visit-questions');
  expect(visitQuestions.props.accessibilityState).toEqual({ disabled: true });
  expect(screen.getByTestId('visit-questions-unavailable')).toBeTruthy();

  await fireEvent.press(visitQuestions);
  expect(conversation).not.toHaveBeenCalled();
  expect(symptoms).not.toHaveBeenCalled();
});
