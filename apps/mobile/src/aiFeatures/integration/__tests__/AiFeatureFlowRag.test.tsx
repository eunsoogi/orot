import { fireEvent, render, screen } from '@testing-library/react-native';
import { runRagConversationTurn } from '../../../ragConversation/service';
import type { AiFeatureLocalData } from '../localData';
import { AiFeatureRoute } from '../AiFeatureRoute';
import {
  apple,
  completeInventory,
  candidatesForInventory,
  localData,
  selectionStore,
  searchFixtureEvidence,
} from '../featureServiceFixtures';

jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

/** Partial coverage returned by a requested tool is surfaced without an unsupported answer. */
test('shows the insufficient-evidence response from the integrated RAG route', async () => {
  const source = localData([]);
  const partialData: AiFeatureLocalData = {
    ...source.data,
    readCandidates: jest.fn(async () =>
      candidatesForInventory({
        ...completeInventory,
        inventoryComplete: false,
        truncatedKinds: ['health_observation'],
      }),
    ),
  };
  const ragRunner = jest.fn(
    async (options: Parameters<typeof runRagConversationTurn>[0]) => {
      const batch = await searchFixtureEvidence(
        options.workflow.tools,
        'personal_record',
      );
      expect(
        batch.coverage.some(value => value.gaps.length > 0 || value.truncated),
      ).toBe(true);
      return { status: 'insufficient' as const };
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
        loadLocalData: async () => partialData,
        ragRunner,
      }}
    />,
  );

  await fireEvent.press(screen.getByTestId('ai-feature-rag-conversation'));
  await fireEvent.changeText(
    screen.getByTestId('rag-conversation-input'),
    '기록 질문',
  );
  await fireEvent.press(screen.getByTestId('rag-conversation-send'));

  expect(
    await screen.findByText(
      '근거가 부족하거나 서로 맞지 않아 답을 만들지 않았어요.',
    ),
  ).toBeTruthy();
  expect(ragRunner).toHaveBeenCalledTimes(1);
  expect(partialData.readCandidates).toHaveBeenCalledTimes(1);
});

test('routes a new-session composer change to its active draft and preserves the prior draft', async () => {
  const source = localData([]);
  const ragRunner = jest.fn() as unknown as typeof runRagConversationTurn;

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
  const input = screen.getByTestId('rag-conversation-input');
  await fireEvent.changeText(input, 'synthetic prior draft');
  expect(input.props.value).toBe('synthetic prior draft');
  expect(screen.getByTestId('rag-conversation-send').props.disabled).toBe(
    false,
  );

  await fireEvent.press(screen.getByTestId('rag-conversation-new-session'));
  const newInput = screen.getByTestId('rag-conversation-input');
  expect(newInput.props.value).toBe('');
  expect(screen.getByTestId('rag-conversation-send').props.disabled).toBe(true);
  await fireEvent.changeText(newInput, 'synthetic new-session question');
  expect(screen.getByTestId('rag-conversation-input').props.value).toBe(
    'synthetic new-session question',
  );
  expect(screen.getByTestId('rag-conversation-send').props.disabled).toBe(
    false,
  );

  // Select the older session through the history native-event boundary; this checks retained UI state, not store setup.
  await fireEvent.press(screen.getByTestId('rag-conversation-sessions-toggle'));
  const history = screen.getByTestId('conversation-history-list');
  expect(history.props.rows).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: 1, selected: false }),
      expect.objectContaining({ id: 2, selected: true }),
    ]),
  );
  await fireEvent(history, 'selectSession', { nativeEvent: { id: 1 } });
  expect(screen.getByTestId('rag-conversation-input').props.value).toBe(
    'synthetic prior draft',
  );
  expect(ragRunner).not.toHaveBeenCalled();
});
