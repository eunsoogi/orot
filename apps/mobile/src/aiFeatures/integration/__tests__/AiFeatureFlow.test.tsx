import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import type { EvidenceItem } from '@orot/agent-runtime';
import { StyleSheet, Text } from 'react-native';
import { selectionStore } from '../featureServiceFixtures';
import {
  VisitQuestionHarness,
  type VisitQuestionRenderInput,
} from '../testSupport/VisitQuestionRouteHarness';
import { AiFeatureFlow } from '../AiFeatureFlow';
import type { ExternalMedicalPublication } from '../../../externalMedicalEvidence/europePmc';

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
          reference={reference}
        />
      </>
    ),
  );
  const testSelectionStore = selectionStore(null);
  await render(
    <AiFeatureFlow
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
  await fireEvent.press(screen.getByTestId('ai-feature-source-back'));
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
    expect(
      screen.getByTestId('visit-question-provider-revision'),
    ).toHaveTextContent('1:function'),
  );
  expect(screen.getByTestId('visit-question-route')).toBeTruthy();
  expect(screen.getByTestId('visit-question-draft')).toHaveTextContent(
    '수정한 질문 초안',
  );
  await fireEvent.press(screen.getByTestId('visit-question-back'));

  await fireEvent.press(screen.getByTestId('ai-feature-disease-hypotheses'));
  expect(screen.getByTestId('disease-hypotheses-screen')).toBeTruthy();
  await fireEvent.press(screen.getByText('뒤로'));

  await fireEvent.press(screen.getByTestId('ai-feature-rag-conversation'));
  expect(screen.getByTestId('rag-conversation-screen')).toBeTruthy();
  await fireEvent.press(screen.getByText('뒤로'));

  await fireEvent.press(screen.getByTestId('ai-feature-external-evidence'));
  expect(screen.getByTestId('external-medical-evidence-screen')).toBeTruthy();
});

test('exposes provider selection from the feature entry', async () => {
  await render(
    <AiFeatureFlow
      renderVisitQuestions={() => <Text>질문 화면</Text>}
      onOpenArticle={jest.fn()}
    />,
  );

  await fireEvent.press(screen.getByTestId('ai-feature-select-provider'));
  await waitFor(() =>
    expect(screen.getByTestId('provider-selection-screen')).toBeTruthy(),
  );
});

test('keeps next-visit questions explicitly unavailable until its screen is supplied', async () => {
  await render(<AiFeatureFlow onOpenArticle={jest.fn()} />);

  expect(screen.getByTestId('visit-questions-unavailable')).toHaveTextContent(
    '현재 진료 질문을 준비할 수 없어요.',
  );
  expect(screen.getByTestId('ai-feature-visit-questions')).toBeDisabled();
  await fireEvent.press(screen.getByTestId('ai-feature-disease-hypotheses'));
  expect(screen.getByTestId('disease-hypotheses-screen')).toBeTruthy();
});

test('shows an error when the selected external article cannot be opened', async () => {
  const publication: ExternalMedicalPublication = {
    provider: 'Europe PMC',
    recordId: '12345',
    source: 'MED',
    title: 'A sourced article',
    authors: null,
    journal: null,
    publicationDate: null,
    updatedDate: null,
    abstract: null,
    originalUrl: 'https://europepmc.org/article/MED/12345',
    retrievedAt: '2026-10-08T00:00:00.000Z',
  };
  const externalEvidence = {
    search: jest.fn(async () => ({
      status: 'available' as const,
      publications: [publication],
    })),
  };
  const onOpenArticle = jest.fn(async () => {
    throw new Error('No browser is available.');
  });
  await render(
    <AiFeatureFlow
      onOpenArticle={onOpenArticle}
      serviceDependencies={{ externalEvidence }}
    />,
  );

  await fireEvent.press(screen.getByTestId('ai-feature-external-evidence'));
  await fireEvent.press(screen.getByTestId('external-evidence-consent'));
  await fireEvent.changeText(
    screen.getByTestId('external-evidence-query'),
    'blood pressure',
  );
  await fireEvent.press(screen.getByTestId('external-evidence-search'));
  expect(await screen.findByText(publication.title)).toBeTruthy();
  await fireEvent.press(screen.getByText('원문 열기'));

  expect(
    await screen.findByTestId('external-article-open-error'),
  ).toHaveTextContent('외부 문헌을 열지 못했어요. 링크를 확인해 주세요.');
  expect(onOpenArticle).toHaveBeenCalledWith(publication);
});
