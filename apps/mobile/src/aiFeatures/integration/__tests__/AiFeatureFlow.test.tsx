import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import type { EvidenceItem } from '@orot/agent-runtime';
import { Alert } from 'react-native';
import type { AlertButton } from 'react-native';
import type {
  ProviderSelection,
  ProviderSelectionStore,
} from '../../../providers/selection';
import { StyleSheet, Text } from 'react-native';
import {
  VisitQuestionHarness,
  type VisitQuestionRenderInput,
} from '../testSupport/VisitQuestionRouteHarness';
import { AiFeatureRoute } from '../AiFeatureRoute';
import { navigationText } from '../../../i18n/navigation';

jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

jest.mock('../../../providers/selection/options', () => {
  const actual = jest.requireActual('../../../providers/selection/options');
  return {
    ...actual,
    loadAppleSelectionOption: jest.fn(async () =>
      actual.createAppleSelectionOption('available'),
    ),
  };
});

test('routes all four entry actions through the integration and returns from visit questions', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  const reference: EvidenceItem = {
    sourceKind: 'personal_record',
    sourceId: 'record-source-1',
    sourceRevision: 'source-revision-1',
    evidenceId: 'record-evidence-1',
    evidenceRevision: 'evidence-revision-1',
    locator: { kind: 'structured_record', recordId: 'record-evidence-1' },
    effectiveTime: '2026-10-01T00:00:00.000Z',
    reviewState: 'reviewed',
    content: '검토된 건강 기록',
  };
  const renderVisitQuestions = jest.fn(
    ({
      onBack,
      onOpenProviderSelection,
      onOpenSource: openVisitQuestionSource,
      onRouteStateChange,
      resolveSelectedAi,
      selectedAiRevision,
      loadSavedVisitQuestions,
    }: VisitQuestionRenderInput) => (
      <>
        <Text testID="visit-question-provider-revision">
          {selectedAiRevision}:{typeof resolveSelectedAi}
        </Text>
        <VisitQuestionHarness
          loadSavedVisitQuestions={loadSavedVisitQuestions}
          onBack={onBack}
          onOpenProviderSelection={onOpenProviderSelection}
          onOpenSource={openVisitQuestionSource}
          onRouteStateChange={onRouteStateChange}
          reference={reference}
        />
      </>
    ),
  );
  const testSelectionStore = mutableSelectionStore();
  await render(
    <AiFeatureRoute
      onBack={jest.fn()}
      renderVisitQuestions={renderVisitQuestions}
      onOpenArticle={jest.fn()}
      serviceDependencies={{
        selectedAi: { selectionStore: testSelectionStore },
      }}
    />,
  );

  const screenContent = screen.getByTestId('ai-feature-screen-content');
  expect(StyleSheet.flatten(screenContent.props.style)).toMatchObject({
    flex: 1,
  });
  await fireEvent.press(screen.getByTestId('ai-feature-visit-questions'));
  expect(screen.getByTestId('visit-question-route')).toBeTruthy();
  expect(renderVisitQuestions).toHaveBeenCalledWith(
    expect.objectContaining({
      onBack: expect.any(Function),
      onOpenProviderSelection: expect.any(Function),
      onOpenSource: expect.any(Function),
      resolveSelectedAi: expect.any(Function),
      selectedAiRevision: 0,
      loadSavedVisitQuestions: expect.any(Function),
    }),
  );
  expect(screen.getByTestId('visit-question-loader')).toHaveTextContent(
    'function',
  );
  await fireEvent.press(screen.getByTestId('visit-question-source'));
  expect(
    await screen.findByTestId('ai-feature-source-unavailable'),
  ).toBeTruthy();
  await fireEvent.press(screen.getByTestId('navigation-back'));
  await waitFor(() =>
    expect(screen.queryByTestId('ai-feature-source-unavailable')).toBeNull(),
  );
  await fireEvent.press(screen.getByTestId('visit-question-edit'));
  await fireEvent.press(screen.getByTestId('visit-question-select-provider'));
  expect(screen.getByTestId('provider-selection-screen')).toBeTruthy();
  await waitFor(() =>
    expect(screen.getByTestId('provider-option-0')).toBeTruthy(),
  );
  await fireEvent.press(screen.getByTestId('provider-option-0'));
  await fireEvent.press(screen.getByTestId('provider-selection-confirm'));
  expect(testSelectionStore.save).toHaveBeenCalledWith({
    providerId: 'apple-foundation-models',
    modelId: 'apple-foundation-models-system-default',
  });
  await waitFor(() =>
    expect(screen.queryByTestId('provider-selection-screen')).toBeNull(),
  );
  expect(screen.getByTestId('visit-question-route')).toBeTruthy();
  // Selection persistence and the route revision update complete asynchronously.
  await waitFor(() =>
    expect(
      renderVisitQuestions.mock.calls.map(
        ([input]) => input.selectedAiRevision,
      ),
    ).toContain(1),
  );
  await waitFor(() =>
    expect(
      screen.getByTestId('visit-question-provider-revision'),
    ).toHaveTextContent('1:function'),
  );
  expect(screen.getByTestId('visit-question-route')).toBeTruthy();
  expect(screen.getByTestId('visit-question-draft')).toHaveTextContent(
    '수정한 질문 초안',
  );
  const latestVisitRouteInput =
    renderVisitQuestions.mock.calls[
      renderVisitQuestions.mock.calls.length - 1
    ]?.[0];
  if (!latestVisitRouteInput)
    throw new Error('Visit route input was not kept.');
  await expect(
    latestVisitRouteInput.resolveSelectedAi(),
  ).resolves.toMatchObject({
    status: 'ready',
    selection: {
      providerId: 'apple-foundation-models',
      modelId: 'apple-foundation-models-system-default',
    },
    modelId: 'apple-foundation-models-system-default',
    remoteProcessing: false,
  });
  await fireEvent.press(screen.getByTestId('visit-question-back'));
  await waitFor(() => expect(alert).toHaveBeenCalledTimes(1));
  expect(alert.mock.calls[0]?.[0]).toBe(navigationText.leaveUnsaved.title);
  await pressAlertButton(alert, 1);
  await waitFor(() =>
    expect(screen.getByTestId('ai-features-screen')).toBeTruthy(),
  );

  await fireEvent.press(screen.getByTestId('ai-feature-disease-hypotheses'));
  expect(screen.getByTestId('disease-hypotheses-screen')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('navigation-back'));

  await fireEvent.press(screen.getByTestId('ai-feature-rag-conversation'));
  expect(screen.getByTestId('rag-conversation-screen')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('navigation-back'));

  await fireEvent.press(screen.getByTestId('ai-feature-external-evidence'));
  expect(screen.getByTestId('external-medical-evidence-screen')).toBeTruthy();
});

/** Models saved selection so the flow can resolve the committed choice again. */
function mutableSelectionStore(): ProviderSelectionStore {
  let selected: ProviderSelection | null = null;
  return {
    load: jest.fn(async () => selected),
    save: jest.fn(async selection => {
      selected = selection;
    }),
    clear: jest.fn(async () => {
      selected = null;
    }),
  };
}

/** Uses the native confirmation callback to resume the shared navigation guard. */
async function pressAlertButton(alert: jest.SpyInstance, index: number) {
  const buttons = alert.mock.calls.at(-1)?.[2] as AlertButton[] | undefined;
  const press = buttons?.[index]?.onPress;
  if (!press) throw new Error(`Alert button ${index} was not registered.`);
  await act(async () => {
    press();
    await Promise.resolve();
  });
}
