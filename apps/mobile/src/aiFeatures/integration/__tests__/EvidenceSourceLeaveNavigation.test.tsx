import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import type { AlertButton } from 'react-native';
import type { PersistedMemoryRecord } from '@orot/agent-memory';
import { runDiseaseHypothesisAnalysis } from '../../../diseaseHypotheses/task';
import { navigationText } from '../../../i18n/navigation';
import {
  apple,
  localData,
  memoryRecord,
  selectionStore,
} from '../featureServiceFixtures';
import { AiFeatureRoute } from '../AiFeatureRoute';
import type { AiFeatureServiceDependencies } from '../featureServices';

jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

afterEach(() => jest.restoreAllMocks());

test('confirms before leaving a source citation during its local reread', async () => {
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
      const reference = options.initialEvidence.items[0];
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
  await fireEvent.press(await route.findByText(/원문 근거 열기/));
  await waitFor(() => expect(listRecords).toHaveBeenCalled());
  expect(route.getByTestId('ai-feature-source-loading')).toBeTruthy();

  await fireEvent.press(route.getByTestId('navigation-back'));
  await waitFor(() => expect(alert).toHaveBeenCalledTimes(1));
  expect(alert.mock.calls[0]?.[0]).toBe(
    navigationText.leaveOngoingOperation.title,
  );
  await pressAlertButton(alert, 0);
  expect(route.getByTestId('ai-feature-source-loading')).toBeTruthy();

  await fireEvent.press(route.getByTestId('navigation-back'));
  await waitFor(() => expect(alert).toHaveBeenCalledTimes(2));
  await pressAlertButton(alert, 1);
  await waitFor(() =>
    expect(route.queryByTestId('ai-feature-source-detail')).toBeNull(),
  );
  await act(async () => finishRead([record]));
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

/** Uses the native confirmation button to resume the route guard. */
async function pressAlertButton(alert: jest.SpyInstance, index: number) {
  const buttons = alert.mock.calls.at(-1)?.[2] as AlertButton[] | undefined;
  const press = buttons?.[index]?.onPress;
  if (!press) throw new Error(`Alert button ${index} was not registered.`);
  await act(async () => {
    press();
    await Promise.resolve();
  });
}
