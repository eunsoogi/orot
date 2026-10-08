import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { Alert, Text } from 'react-native';
import type { AlertButton } from 'react-native';
import { AiFeatureRoute } from '../AiFeatureRoute';
import type {
  VisitQuestionsRenderInput,
  VisitQuestionsRouteState,
} from '../AiFeatureFlowScreen';

jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

describe('visit questions guarded navigation', () => {
  afterEach(() => jest.restoreAllMocks());

  it('rejects a stale leave confirmation after visit questions change', async () => {
    const alert = jest
      .spyOn(Alert, 'alert')
      .mockImplementation(() => undefined);
    let reportRouteState:
      ((state: VisitQuestionsRouteState) => void) | undefined;
    const renderVisitQuestions = jest.fn((input: VisitQuestionsRenderInput) => {
      reportRouteState = input.onRouteStateChange;
      return <Text testID="visit-question-route">다음 진료 질문 화면</Text>;
    });
    await render(
      <AiFeatureRoute
        onBack={jest.fn()}
        renderVisitQuestions={renderVisitQuestions}
      />,
    );

    await fireEvent.press(screen.getByTestId('ai-feature-visit-questions'));
    await waitFor(() => expect(reportRouteState).toEqual(expect.any(Function)));
    await act(async () => {
      reportRouteState?.({
        hasUnsavedChanges: true,
        isSaving: false,
        revision: 1,
      });
    });

    await fireEvent.press(screen.getByTestId('navigation-back'));
    await waitFor(() => expect(alert).toHaveBeenCalledTimes(1));
    expect(alert.mock.calls[0]?.[0]).toBe('저장하지 않은 내용이 있어요');

    await act(async () => {
      reportRouteState?.({
        hasUnsavedChanges: true,
        isSaving: false,
        revision: 2,
      });
    });
    await pressAlertButton(alert, 1);

    expect(screen.getByTestId('visit-question-route')).toBeTruthy();
    expect(screen.getByTestId('navigation-back')).toBeTruthy();
  });

  it('keeps visit questions mounted while saving and leaves after a clean save', async () => {
    const alert = jest
      .spyOn(Alert, 'alert')
      .mockImplementation(() => undefined);
    let reportRouteState:
      ((state: VisitQuestionsRouteState) => void) | undefined;
    const renderVisitQuestions = jest.fn((input: VisitQuestionsRenderInput) => {
      reportRouteState = input.onRouteStateChange;
      return <Text testID="visit-question-route">다음 진료 질문 화면</Text>;
    });
    await render(
      <AiFeatureRoute
        onBack={jest.fn()}
        renderVisitQuestions={renderVisitQuestions}
      />,
    );

    await fireEvent.press(screen.getByTestId('ai-feature-visit-questions'));
    await waitFor(() => expect(reportRouteState).toEqual(expect.any(Function)));
    await act(async () => {
      reportRouteState?.({
        hasUnsavedChanges: true,
        isSaving: true,
        revision: 1,
      });
    });

    await fireEvent.press(screen.getByTestId('navigation-back'));
    await waitFor(() => expect(alert).toHaveBeenCalledTimes(1));
    expect(alert.mock.calls[0]?.[0]).toBe('질문을 저장하고 있어요');
    expect(screen.getByTestId('visit-question-route')).toBeTruthy();

    await act(async () => {
      reportRouteState?.({
        hasUnsavedChanges: false,
        isSaving: false,
        revision: 2,
      });
    });
    await fireEvent.press(screen.getByTestId('navigation-back'));

    await waitFor(() =>
      expect(screen.queryByTestId('visit-question-route')).toBeNull(),
    );
    expect(alert).toHaveBeenCalledTimes(1);
  });
});

/** Calls the alert's native confirmation handler so the real route guard resumes. */
async function pressAlertButton(alert: jest.SpyInstance, index: number) {
  const buttons = alert.mock.calls.at(-1)?.[2] as AlertButton[] | undefined;
  const press = buttons?.[index]?.onPress;
  if (!press) throw new Error(`Alert button ${index} was not registered.`);
  await act(async () => {
    press();
    await Promise.resolve();
  });
}
