import { fireEvent, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import * as inferenceConsent from '../../../agent/execution/useInferenceConsent';
import { AiFeatureRoute } from '../AiFeatureRoute';

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
afterEach(() => jest.restoreAllMocks());

/** The provider remains reachable directly; the retired dashboard adds no extra scroll host. */
test('exposes provider selection from the default conversation', async () => {
  await render(<AiFeatureRoute onBack={jest.fn()} />);
  expect(screen.getByTestId('rag-conversation-screen')).toBeTruthy();
  expect(screen.queryByTestId('ai-feature-entry-page')).toBeNull();
  expect(screen.getAllByTestId('ai-feature-select-provider')).toHaveLength(1);
  await fireEvent.press(screen.getByTestId('ai-feature-select-provider'));
  expect(screen.getByTestId('provider-selection-screen')).toBeTruthy();
});

test('visit-question links show an explicit preparation action without running it on entry', async () => {
  await render(
    <AiFeatureRoute initialRoute="visit-questions" onBack={jest.fn()} />,
  );
  expect(screen.getByTestId('rag-conversation-screen')).toBeTruthy();
  expect(screen.getByTestId('conversation-visit-prepare')).toBeTruthy();
  expect(screen.queryByTestId('conversation-intent-use-suggestion')).toBeNull();
  expect(screen.getByTestId('rag-conversation-input')).toHaveProp('value', '');
  expect(screen.queryByTestId('rag-conversation-progress')).toBeNull();
  expect(screen.queryByTestId('visit-questions-unavailable')).toBeNull();
  await fireEvent.press(screen.getByTestId('rag-conversation-sessions-toggle'));
  expect(screen.queryByTestId('conversation-saved-visit-questions')).toBeNull();
});

/** Search is tool-owned; navigation must neither authorize transmission nor fetch articles. */
test('old literature links enter conversation without performing a public search', async () => {
  const search = jest.fn();
  const authorize = jest.fn(async () => 'renewal_required' as const);
  jest
    .spyOn(inferenceConsent, 'useInferenceConsent')
    .mockReturnValue({ consent: { authorize }, disclosureSheet: null });
  await render(
    <AiFeatureRoute
      initialRoute="external-evidence"
      onBack={jest.fn()}
      serviceDependencies={{ externalEvidence: { search } }}
    />,
  );
  expect(screen.getByTestId('rag-conversation-screen')).toBeTruthy();
  expect(screen.queryByTestId('external-medical-evidence-screen')).toBeNull();
  expect(screen.queryByTestId('external-evidence-search')).toBeNull();
  expect(
    screen.getByText('필요하면 동의를 받고 공개 웹자료와 의학 문헌도 찾아요.'),
  ).toBeTruthy();
  expect(search).not.toHaveBeenCalled();
  expect(authorize).not.toHaveBeenCalled();
});

/** Existing saved-output navigation survives independently of new conversational feature implementations. */
test('opens the saved-question reader with an explicit read-only contract', async () => {
  const renderSaved = jest.fn(() => (
    <Text testID="saved-question-reader">저장된 질문</Text>
  ));
  await render(
    <AiFeatureRoute onBack={jest.fn()} renderVisitQuestions={renderSaved} />,
  );
  await fireEvent.press(screen.getByTestId('rag-conversation-sessions-toggle'));
  await fireEvent.press(
    screen.getByTestId('conversation-saved-visit-questions'),
  );
  expect(screen.getByTestId('saved-question-reader')).toBeTruthy();
  expect(renderSaved).toHaveBeenCalledWith(
    expect.objectContaining({
      readOnly: true,
      loadSavedVisitQuestions: expect.any(Function),
      onOpenSource: expect.any(Function),
    }),
  );
  await fireEvent.press(screen.getByTestId('navigation-back'));
  expect(screen.getByTestId('conversation-history-screen')).toBeTruthy();
});
