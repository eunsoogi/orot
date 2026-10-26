import { useLayoutEffect } from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { Alert, Text } from 'react-native';
import { AiFeatureRoute } from '../AiFeatureRoute';
import type {
  VisitQuestionsRenderInput,
  VisitQuestionsRouteState,
} from '../AiFeatureFlowScreen';

jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);
afterEach(() => jest.restoreAllMocks());

const phases = [
  {
    hasUnsavedChanges: true,
    isSaving: false,
    isGenerating: false,
    revision: 1,
  },
  {
    hasUnsavedChanges: false,
    isSaving: false,
    isGenerating: true,
    revision: 2,
  },
  { hasUnsavedChanges: true, isSaving: true, isGenerating: false, revision: 3 },
];

/** Retained work never needs destructive-leave approval; other feature guards remain separate. */
test.each(phases)(
  'leaves visit questions without a prompt in phase $revision',
  async state => {
    const alert = jest
      .spyOn(Alert, 'alert')
      .mockImplementation(() => undefined);
    const route = await render(
      <AiFeatureRoute
        onBack={jest.fn()}
        renderVisitQuestions={input => <Probe {...input} state={state} />}
      />,
    );
    await fireEvent.press(route.getByTestId('ai-feature-visit-questions'));
    await waitFor(() =>
      expect(route.getByTestId('visit-question-route')).toBeTruthy(),
    );
    await fireEvent.press(route.getByTestId('navigation-back'));
    await waitFor(() =>
      expect(route.queryByTestId('visit-question-route')).toBeNull(),
    );
    expect(alert).not.toHaveBeenCalled();
  },
);

function Probe({
  onRouteStateChange,
  state,
}: VisitQuestionsRenderInput & { readonly state: VisitQuestionsRouteState }) {
  useLayoutEffect(() => {
    onRouteStateChange(state);
  }, [onRouteStateChange, state]);
  return <Text testID="visit-question-route">다음 진료 질문 화면</Text>;
}
