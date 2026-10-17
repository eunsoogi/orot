import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import type { AlertButton } from 'react-native';
import { navigationText } from '../../../i18n/navigation';
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

test('keeps a RAG draft when shared back confirmation is canceled', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  const view = await render(<AiFeatureRoute onBack={jest.fn()} />);

  await fireEvent.press(view.getByTestId('ai-feature-rag-conversation'));
  const input = view.getByTestId('rag-conversation-input');
  await fireEvent.changeText(
    input,
    '다음 진료에서 확인할 내용을 정리하고 싶어요.',
  );
  await fireEvent.press(view.getByTestId('navigation-back'));

  await waitFor(() => expect(alert).toHaveBeenCalledTimes(1));
  expect(alert.mock.calls[0]?.[0]).toBe(navigationText.leaveUnsaved.title);
  await pressAlertButton(alert, 0);

  expect(view.getByTestId('rag-conversation-input').props.value).toBe(
    '다음 진료에서 확인할 내용을 정리하고 싶어요.',
  );
  expect(view.getByTestId('rag-conversation-screen')).toBeTruthy();
});

test('aborts RAG generation after confirmed Back and ignores a late answer', async () => {
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

  await fireEvent.press(view.getByTestId('ai-feature-rag-conversation'));
  await fireEvent.changeText(
    view.getByTestId('rag-conversation-input'),
    '저장된 기록을 확인해 주세요.',
  );
  await fireEvent.press(view.getByTestId('rag-conversation-send'));
  await waitFor(() => expect(ragRunner).toHaveBeenCalledTimes(1));
  expect(view.getByTestId('rag-conversation-loading')).toBeTruthy();

  await fireEvent.press(view.getByTestId('navigation-back'));
  await waitFor(() => expect(alert).toHaveBeenCalledTimes(1));
  expect(alert.mock.calls[0]?.[0]).toBe(
    navigationText.leaveUnsavedAndOperation.title,
  );
  await pressAlertButton(alert, 0);
  expect(runnerSignal?.aborted).toBe(false);
  expect(view.getByTestId('rag-conversation-loading')).toBeTruthy();

  await fireEvent.press(view.getByTestId('navigation-back'));
  await waitFor(() => expect(alert).toHaveBeenCalledTimes(2));
  await pressAlertButton(alert, 1);
  await waitFor(() =>
    expect(view.getByTestId('ai-features-screen')).toBeTruthy(),
  );
  expect(runnerSignal?.aborted).toBe(true);

  // A provider can settle after cancellation; the departed feature must discard its answer.
  await act(async () => {
    finish({
      status: 'answer',
      answer: '늦게 완료된 답변',
      citations: [],
    });
  });
  expect(view.queryByText('늦게 완료된 답변')).toBeNull();
});

/** Resumes the route guard through the same native Alert callback used by the app. */
async function pressAlertButton(alert: jest.SpyInstance, index: number) {
  const buttons = alert.mock.calls.at(-1)?.[2] as AlertButton[] | undefined;
  const press = buttons?.[index]?.onPress;
  if (!press) throw new Error(`Alert button ${index} was not registered.`);
  await act(async () => {
    press();
    await Promise.resolve();
  });
}
