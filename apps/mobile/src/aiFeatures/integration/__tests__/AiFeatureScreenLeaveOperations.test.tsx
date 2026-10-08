import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import type { AlertButton } from 'react-native';
import { runDiseaseHypothesisAnalysis } from '../../../diseaseHypotheses/task';
import type { DiseaseHypothesisRunOutcome } from '../../../diseaseHypotheses/task';
import { runRagConversationTurn } from '../../../ragConversation/service';
import type { RagConversationOutcome } from '../../../ragConversation/service';
import type { EuropePmcMedicalEvidenceService } from '../../../externalMedicalEvidence/europePmc';
import {
  apple,
  localData,
  memoryRecord,
  selectionStore,
} from '../featureServiceFixtures';
import { AiFeatureRoute } from '../AiFeatureRoute';
import type { AiFeatureServiceDependencies } from '../featureServices';
import { navigationText } from '../../../i18n/navigation';

jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

afterEach(() => jest.restoreAllMocks());

test('keeps a running RAG turn on cancel and aborts it after confirmed leave', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  let signal: AbortSignal | undefined;
  const ragRunner = jest.fn(
    (
      _input: Parameters<typeof runRagConversationTurn>[0],
      invocation?: Parameters<typeof runRagConversationTurn>[1],
    ) =>
      new Promise<RagConversationOutcome>(resolve => {
        signal = invocation?.signal;
        invocation?.signal?.addEventListener(
          'abort',
          () => resolve({ status: 'unavailable' }),
          { once: true },
        );
      }),
  ) as unknown as typeof runRagConversationTurn;
  const route = await render(
    <AiFeatureRoute
      onBack={jest.fn()}
      serviceDependencies={routeDependencies({ ragRunner })}
    />,
  );

  await fireEvent.press(route.getByTestId('ai-feature-rag-conversation'));
  await fireEvent.changeText(
    route.getByTestId('rag-conversation-input'),
    '다음 진료에서 물어볼 내용을 정리해 주세요.',
  );
  await fireEvent.press(route.getByTestId('rag-conversation-send'));
  await waitFor(() => expect(signal).toBeInstanceOf(AbortSignal));
  await fireEvent.press(route.getByTestId('navigation-back'));
  await waitFor(() => expect(alert).toHaveBeenCalledTimes(1));
  expect(alert.mock.calls[0]?.[0]).toBe(
    navigationText.leaveUnsavedAndOperation.title,
  );
  await pressAlertButton(alert, 0);
  expect(signal?.aborted).toBe(false);
  expect(route.getByTestId('rag-conversation-loading')).toBeTruthy();

  await fireEvent.press(route.getByTestId('navigation-back'));
  await waitFor(() => expect(alert).toHaveBeenCalledTimes(2));
  await pressAlertButton(alert, 1);
  await waitFor(() =>
    expect(route.queryByTestId('rag-conversation-screen')).toBeNull(),
  );
  expect(signal?.aborted).toBe(true);
});

test('guards disease analysis while loading and its completed result', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  let signal: AbortSignal | undefined;
  let finish!: (outcome: DiseaseHypothesisRunOutcome) => void;
  const diseaseRunner = jest.fn(
    (
      _options: Parameters<typeof runDiseaseHypothesisAnalysis>[0],
      _inventory: Parameters<typeof runDiseaseHypothesisAnalysis>[1],
      invocation?: Parameters<typeof runDiseaseHypothesisAnalysis>[2],
    ) => {
      signal = invocation?.signal;
      return new Promise<DiseaseHypothesisRunOutcome>(resolve => {
        finish = resolve;
      });
    },
  ) as unknown as typeof runDiseaseHypothesisAnalysis;
  const route = await render(
    <AiFeatureRoute
      onBack={jest.fn()}
      serviceDependencies={routeDependencies({ diseaseRunner })}
    />,
  );

  await fireEvent.press(route.getByTestId('ai-feature-disease-hypotheses'));
  await fireEvent.press(route.getByTestId('disease-hypotheses-generate'));
  await waitFor(() => expect(signal).toBeInstanceOf(AbortSignal));
  await fireEvent.press(route.getByTestId('navigation-back'));
  await waitFor(() => expect(alert).toHaveBeenCalledTimes(1));
  expect(alert.mock.calls[0]?.[0]).toBe(
    navigationText.leaveOngoingOperation.title,
  );
  await pressAlertButton(alert, 0);
  expect(signal?.aborted).toBe(false);

  await act(async () => {
    finish({
      status: 'workflow',
      result: {
        status: 'result',
        value: {
          hypotheses: [
            {
              title: '검토할 가능성',
              summary: '저장된 기록 일부와 맞아요.',
              supportingEvidence: [],
              contraryEvidence: [],
              uncertainty: '자료가 제한적이에요.',
              missingData: ['진료 기록'],
            },
          ],
        },
        citations: [],
        coverage: [],
        checkpoint: {} as never,
      },
    });
  });
  await waitFor(() =>
    expect(route.getByTestId('disease-hypotheses-results')).toBeTruthy(),
  );
  await fireEvent.press(route.getByTestId('navigation-back'));
  await waitFor(() => expect(alert).toHaveBeenCalledTimes(2));
  expect(alert.mock.calls[1]?.[0]).toBe(navigationText.leaveUnsaved.title);
  await pressAlertButton(alert, 0);
  expect(route.getByTestId('disease-hypotheses-results')).toBeTruthy();
});

test('guards external search and the returned empty-result state', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  let signal: AbortSignal | undefined;
  let finish!: (
    result: Awaited<ReturnType<EuropePmcMedicalEvidenceService['search']>>,
  ) => void;
  const externalEvidence: EuropePmcMedicalEvidenceService = {
    search: jest.fn(
      (_query, options) =>
        new Promise(resolve => {
          signal = options.signal;
          finish = resolve;
        }),
    ),
  };
  const route = await render(
    <AiFeatureRoute
      onBack={jest.fn()}
      serviceDependencies={routeDependencies({ externalEvidence })}
    />,
  );

  await fireEvent.press(route.getByTestId('ai-feature-external-evidence'));
  await fireEvent.changeText(
    route.getByTestId('external-evidence-query'),
    '수면과 혈압 연구',
  );
  await fireEvent.press(route.getByTestId('external-evidence-consent'));
  await fireEvent.press(route.getByTestId('external-evidence-search'));
  await waitFor(() => expect(signal).toBeInstanceOf(AbortSignal));
  await fireEvent.press(route.getByTestId('navigation-back'));
  await waitFor(() => expect(alert).toHaveBeenCalledTimes(1));
  expect(alert.mock.calls[0]?.[0]).toBe(
    navigationText.leaveUnsavedAndOperation.title,
  );
  await pressAlertButton(alert, 0);
  expect(signal?.aborted).toBe(false);

  await act(async () => finish({ status: 'empty' }));
  await waitFor(() =>
    expect(route.getByTestId('external-evidence-empty')).toBeTruthy(),
  );
  await fireEvent.press(route.getByTestId('navigation-back'));
  await waitFor(() => expect(alert).toHaveBeenCalledTimes(2));
  expect(alert.mock.calls[1]?.[0]).toBe(navigationText.leaveUnsaved.title);
  await pressAlertButton(alert, 0);
  expect(route.getByTestId('external-medical-evidence-screen')).toBeTruthy();
});

function routeDependencies(
  overrides: Partial<AiFeatureServiceDependencies> = {},
): AiFeatureServiceDependencies {
  const data = localData([memoryRecord(1)]).data;
  return {
    selectedAi: {
      selectionStore: selectionStore({
        providerId: apple.provider.id,
        modelId: apple.modelId,
      }),
      loadAppleOption: async () => apple,
    },
    loadLocalData: async () => data,
    ...overrides,
  };
}

/** Uses the real Alert callback to resume the shared route guard. */
async function pressAlertButton(alert: jest.SpyInstance, index: number) {
  const buttons = alert.mock.calls.at(-1)?.[2] as AlertButton[] | undefined;
  const press = buttons?.[index]?.onPress;
  if (!press) throw new Error(`Alert button ${index} was not registered.`);
  await act(async () => {
    press();
    await Promise.resolve();
  });
}
