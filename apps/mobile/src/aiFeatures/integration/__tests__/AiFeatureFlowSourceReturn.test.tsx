import { fireEvent, render, screen } from '@testing-library/react-native';
import { AiFeatureRoute } from '../AiFeatureRoute';
import { getDiseaseHypothesisCopy } from '../../../diseaseHypotheses/copy';
import { runDiseaseHypothesisAnalysis } from '../../../diseaseHypotheses/task';
import { runRagConversationTurn } from '../../../ragConversation/service';
import { referenceOnly } from '../testSupport/personalEvidenceTestSupport';
import {
  apple,
  localData,
  memoryRecord,
  selectionStore,
  searchFixtureEvidence,
} from '../featureServiceFixtures';

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

test('preserves the conversation and answer after opening and returning from its citation', async () => {
  const source = localData([memoryRecord(1)]);
  const ragRunner = jest.fn(
    async (options: Parameters<typeof runRagConversationTurn>[0]) => {
      const current = await searchFixtureEvidence(options.workflow.tools);
      const item = current.items[0];
      if (!item) return { status: 'no_evidence' as const };
      return {
        status: 'answer' as const,
        answer: '근거를 확인한 대화 답변',
        citations: [referenceOnly(item)],
      };
    },
  ) as unknown as typeof runRagConversationTurn;

  await render(
    <AiFeatureRoute
      onBack={jest.fn()}
      onOpenArticle={jest.fn()}
      serviceDependencies={{
        selectedAi: {
          selectionStore: selectionStore({
            providerId: apple.provider.id,
            modelId: apple.modelId,
          }),
          loadAppleOption: async () => apple,
        },
        loadLocalData: async () => source.data,
        ragRunner,
      }}
    />,
  );

  await fireEvent.press(screen.getByTestId('ai-feature-rag-conversation'));
  await fireEvent.changeText(
    screen.getByTestId('rag-conversation-input'),
    '첫 질문',
  );
  await fireEvent.press(screen.getByTestId('rag-conversation-send'));
  expect(await screen.findByText('근거를 확인한 대화 답변')).toBeTruthy();
  // The source card names the reviewed memo and date instead of exposing its opaque alias.
  await fireEvent.press(
    screen.getByRole('button', { name: /^원문 근거 열기 · 검토한 메모/ }),
  );
  expect(await screen.findByTestId('ai-feature-source-detail')).toBeTruthy();
  expect(await screen.findByText(memoryRecord(1).text)).toBeTruthy();
  await fireEvent.press(screen.getByTestId('navigation-back'));

  expect(screen.getByText('첫 질문')).toBeTruthy();
  expect(screen.getByText('근거를 확인한 대화 답변')).toBeTruthy();
});

test('preserves generated hypotheses after opening and returning from their citation', async () => {
  const source = localData([memoryRecord(1)]);
  let citationLabel = '';
  const diseaseRunner = jest.fn(
    async (options: Parameters<typeof runDiseaseHypothesisAnalysis>[0]) => {
      const item = (await searchFixtureEvidence(options.tools)).items[0];
      if (!item)
        return {
          status: 'incomplete_inventory',
          reason: 'unavailable',
        } as const;
      const reference = referenceOnly(item);
      citationLabel = getDiseaseHypothesisCopy().source(item.sourceId);
      return {
        status: 'workflow',
        result: {
          status: 'result',
          value: {
            hypotheses: [
              {
                title: '검토할 가설',
                summary: '저장된 근거가 뒷받침하는 가능성입니다.',
                supportingEvidence: [reference],
                contraryEvidence: [],
                uncertainty: '추가 확인이 필요합니다.',
                missingData: ['최근 측정값'],
              },
            ],
          },
          citations: [reference],
        },
      } as never;
    },
  ) as unknown as typeof runDiseaseHypothesisAnalysis;

  await render(
    <AiFeatureRoute
      onBack={jest.fn()}
      onOpenArticle={jest.fn()}
      serviceDependencies={{
        selectedAi: {
          selectionStore: selectionStore({
            providerId: apple.provider.id,
            modelId: apple.modelId,
          }),
          loadAppleOption: async () => apple,
        },
        loadLocalData: async () => source.data,
        diseaseRunner,
      }}
    />,
  );

  await fireEvent.press(screen.getByTestId('ai-feature-disease-hypotheses'));
  await fireEvent.press(screen.getByTestId('disease-hypotheses-generate'));
  expect(await screen.findByTestId('disease-hypotheses-results')).toBeTruthy();
  await fireEvent.press(screen.getByText(citationLabel));
  expect(await screen.findByTestId('ai-feature-source-detail')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('navigation-back'));

  expect(screen.getByTestId('disease-hypotheses-results')).toBeTruthy();
  expect(screen.getByText('검토할 가설')).toBeTruthy();
});
