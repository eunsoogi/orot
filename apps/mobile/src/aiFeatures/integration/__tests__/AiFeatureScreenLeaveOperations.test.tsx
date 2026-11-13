import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
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

jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

afterEach(() => jest.restoreAllMocks());

test('retains a running RAG turn on leave and aborts only through its stop control', async () => {
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

  await fireEvent.changeText(
    route.getByTestId('rag-conversation-input'),
    '다음 진료에서 물어볼 내용을 정리해 주세요.',
  );
  await fireEvent.press(route.getByTestId('rag-conversation-send'));
  await waitFor(() => expect(signal).toBeInstanceOf(AbortSignal));
  await fireEvent.press(route.getByTestId('rag-conversation-sessions-toggle'));
  await waitFor(() =>
    expect(route.getByTestId('conversation-history-screen')).toBeTruthy(),
  );
  expect(alert).not.toHaveBeenCalled();
  expect(signal?.aborted).toBe(false);
  await fireEvent.press(route.getByTestId('navigation-back'));
  expect(
    route.getByTestId('rag-conversation-activity-bubble', {
      includeHiddenElements: true,
    }),
  ).toBeTruthy();
  await fireEvent.press(route.getByTestId('rag-conversation-cancel'));
  expect(signal?.aborted).toBe(true);
});

test('retains a possibilities request on leave and ignores its late result after Stop', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  let signal: AbortSignal | undefined;
  let finish!: (outcome: RagConversationOutcome) => void;
  const ragRunner = jest.fn(
    (
      _options: Parameters<typeof runRagConversationTurn>[0],
      invocation?: Parameters<typeof runRagConversationTurn>[1],
    ) => {
      signal = invocation?.signal;
      return new Promise<RagConversationOutcome>(resolve => {
        finish = resolve;
      });
    },
  ) as unknown as typeof runRagConversationTurn;
  const route = await render(
    <AiFeatureRoute
      initialRoute="disease-hypotheses"
      onBack={jest.fn()}
      serviceDependencies={routeDependencies({ ragRunner })}
    />,
  );
  expect(route.getByTestId('rag-conversation-input')).toHaveProp('value', '');
  await fireEvent.press(
    route.getByTestId('conversation-intent-use-suggestion'),
  );
  await fireEvent.press(route.getByTestId('rag-conversation-send'));
  await waitFor(() => expect(signal).toBeInstanceOf(AbortSignal));
  await fireEvent.press(route.getByTestId('rag-conversation-sessions-toggle'));
  expect(route.getByTestId('conversation-history-screen')).toBeTruthy();
  expect(alert).not.toHaveBeenCalled();
  expect(signal?.aborted).toBe(false);
  await fireEvent.press(route.getByTestId('navigation-back'));
  await fireEvent.press(route.getByTestId('rag-conversation-cancel'));
  expect(signal?.aborted).toBe(true);
  await act(async () =>
    finish({
      status: 'answer',
      answer: '취소 후 늦게 도착한 가능성',
      citations: [],
    }),
  );
  expect(route.queryByText('취소 후 늦게 도착한 가능성')).toBeNull();
  expect(route.queryByTestId('disease-hypotheses-screen')).toBeNull();
});

test('retains a RAG external search on leave and ignores results after explicit stop', async () => {
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
      serviceDependencies={routeDependencies({
        externalEvidence,
        externalQueryConsent: { authorize: async () => 'authorized' },
        ragRunner: async (options, invocation) => {
          await options.workflow.tools
            .find(tool => tool.sourceKind === 'external_medical')!
            .search({
              operationRunId: 'test-turn',
              operationKey: 'search',
              input: { topics: ['sleep', 'blood_pressure'] },
              allowedScope: options.workflow.execution.allowedScope,
              resultLimit: 5,
              maxPayloadBytes: 65536,
              signal: invocation?.signal ?? new AbortController().signal,
            });
          return { status: 'no_evidence' };
        },
      })}
    />,
  );

  await fireEvent.changeText(
    route.getByTestId('rag-conversation-input'),
    '수면과 혈압 연구',
  );
  await fireEvent.press(route.getByTestId('rag-conversation-send'));
  await waitFor(() => expect(signal).toBeInstanceOf(AbortSignal));
  await fireEvent.press(route.getByTestId('rag-conversation-sessions-toggle'));
  await waitFor(() =>
    expect(route.getByTestId('conversation-history-screen')).toBeTruthy(),
  );
  expect(alert).not.toHaveBeenCalled();
  expect(signal?.aborted).toBe(false);
  await fireEvent.press(route.getByTestId('navigation-back'));
  await fireEvent.press(route.getByTestId('rag-conversation-cancel'));
  expect(signal?.aborted).toBe(true);
  await act(async () => finish({ status: 'empty' }));
  expect(
    route.queryByText('현재 기록에서 답변 근거를 찾지 못했어요.'),
  ).toBeNull();
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
