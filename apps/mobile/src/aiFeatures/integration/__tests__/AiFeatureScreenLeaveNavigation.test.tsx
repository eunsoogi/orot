import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import type { RagConversationOutcome } from '../../../ragConversation/service';
import { runRagConversationTurn } from '../../../ragConversation/service';
import { AiFeatureRoute } from '../AiFeatureRoute';
import {
  apple,
  localData,
  memoryRecord,
  selectionStore,
} from '../featureServiceFixtures';

jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

afterEach(() => jest.restoreAllMocks());

test('retains a RAG draft through history and Back without confirmation', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  const view = await render(<AiFeatureRoute onBack={jest.fn()} />);

  const input = view.getByTestId('rag-conversation-input');
  await fireEvent.changeText(
    input,
    '다음 진료에서 확인할 내용을 정리하고 싶어요.',
  );
  await fireEvent.press(view.getByTestId('rag-conversation-sessions-toggle'));

  await waitFor(() =>
    expect(view.getByTestId('conversation-history-screen')).toBeTruthy(),
  );
  expect(alert).not.toHaveBeenCalled();
  await fireEvent.press(view.getByTestId('navigation-back'));

  expect(view.getByTestId('rag-conversation-input').props.value).toBe(
    '다음 진료에서 확인할 내용을 정리하고 싶어요.',
  );
  expect(view.getByTestId('rag-conversation-screen')).toBeTruthy();
});

test('finishes a RAG turn while history is active and shows it once on Back', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  const source = localData([memoryRecord(1)]);
  let finish!: (outcome: RagConversationOutcome) => void;
  let runnerSignal: AbortSignal | undefined;
  const ragRunner = jest.fn(
    (
      _options: Parameters<typeof runRagConversationTurn>[0],
      invocation: Parameters<typeof runRagConversationTurn>[1],
    ) => {
      runnerSignal = invocation?.signal;
      return new Promise<RagConversationOutcome>(resolve => {
        finish = resolve;
      });
    },
  ) as unknown as typeof runRagConversationTurn;
  const view = await render(
    <AiFeatureRoute
      onBack={jest.fn()}
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

  await fireEvent.changeText(
    view.getByTestId('rag-conversation-input'),
    '저장된 기록을 확인해 주세요.',
  );
  await fireEvent.press(view.getByTestId('rag-conversation-send'));
  await waitFor(() => expect(ragRunner).toHaveBeenCalledTimes(1));
  expect(
    view.getByTestId('rag-conversation-activity-bubble', {
      includeHiddenElements: true,
    }),
  ).toBeTruthy();

  await fireEvent.press(view.getByTestId('rag-conversation-sessions-toggle'));
  await waitFor(() =>
    expect(view.getByTestId('conversation-history-screen')).toBeTruthy(),
  );
  expect(alert).not.toHaveBeenCalled();
  expect(runnerSignal?.aborted).toBe(false);

  // Completion belongs to the app-owned session while the history destination is active.
  await act(async () => {
    finish({
      status: 'answer',
      answer: '늦게 완료된 답변',
      citations: [],
    });
  });
  await fireEvent.press(view.getByTestId('navigation-back'));
  expect(view.getAllByText(/늦게 완료된 답변/)).toHaveLength(1);
  expect(view.getByText(/공개 웹검색을 사용할 수 없어/)).toBeTruthy();
  expect(ragRunner).toHaveBeenCalledTimes(1);
});
