import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import type { PersistedMemoryRecord } from '@orot/agent-memory';
import { runDiseaseHypothesisAnalysis } from '../../../diseaseHypotheses/task';
import {
  apple,
  localData,
  memoryRecord,
  selectionStore,
  searchFixtureEvidence,
} from '../featureServiceFixtures';
import { AiFeatureRoute } from '../AiFeatureRoute';
import type { AiFeatureServiceDependencies } from '../featureServices';

jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

afterEach(() => jest.restoreAllMocks());

test('leaves a read-only citation without confirmation and ignores its late reread', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  const record = memoryRecord(1);
  const source = localData([record]);
  let finishRead!: (records: PersistedMemoryRecord[]) => void;
  const pendingRead = new Promise<PersistedMemoryRecord[]>(resolve => {
    finishRead = resolve;
  });
  const listRecords = jest.fn(() => pendingRead);
  source.data.memoryStorage.listRecords =
    listRecords as typeof source.data.memoryStorage.listRecords;
  const diseaseRunner = jest.fn(
    async (options: Parameters<typeof runDiseaseHypothesisAnalysis>[0]) => {
      const reference = (await searchFixtureEvidence(options.tools)).items[0];
      if (!reference) throw new Error('Expected the local memory citation.');
      return {
        status: 'workflow' as const,
        result: {
          status: 'result' as const,
          value: {
            hypotheses: [
              {
                title: '검토할 가능성',
                summary: '검토가 필요한 내용이에요.',
                supportingEvidence: [reference],
                contraryEvidence: [],
                uncertainty: '자료가 제한적이에요.',
                missingData: ['진료 기록'],
              },
            ],
          },
          citations: [reference],
          coverage: [],
          checkpoint: {} as never,
        },
      };
    },
  ) as unknown as typeof runDiseaseHypothesisAnalysis;
  const route = await render(
    <AiFeatureRoute
      onBack={jest.fn()}
      serviceDependencies={routeDependencies({
        diseaseRunner,
        loadLocalData: async () => source.data,
      })}
    />,
  );

  await fireEvent.press(route.getByTestId('ai-feature-disease-hypotheses'));
  await fireEvent.press(route.getByTestId('disease-hypotheses-generate'));
  await fireEvent.press(await route.findByLabelText(/원문 근거 열기/));
  await waitFor(() => expect(listRecords).toHaveBeenCalled());
  expect(route.getByTestId('ai-feature-source-loading')).toBeTruthy();

  await fireEvent.press(route.getByTestId('navigation-back'));
  await waitFor(() =>
    expect(route.queryByTestId('ai-feature-source-detail')).toBeNull(),
  );
  await act(async () => finishRead([record]));
  expect(alert).not.toHaveBeenCalled();
  expect(route.queryByTestId('ai-feature-source-detail')).toBeNull();
  expect(route.getByTestId('disease-hypotheses-results')).toBeTruthy();
});

function routeDependencies(
  overrides: Partial<AiFeatureServiceDependencies> = {},
): AiFeatureServiceDependencies {
  return {
    selectedAi: {
      selectionStore: selectionStore({
        providerId: apple.provider.id,
        modelId: apple.modelId,
      }),
      loadAppleOption: async () => apple,
    },
    loadLocalData: async () => localData([memoryRecord(1)]).data,
    ...overrides,
  };
}
