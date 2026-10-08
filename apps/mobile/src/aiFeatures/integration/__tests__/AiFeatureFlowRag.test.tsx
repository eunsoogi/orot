import { fireEvent, render, screen } from '@testing-library/react-native';
import type { LocalHealthEvidenceInventory } from '../../../healthEvidence/localEvidenceRepository';
import { runRagConversationTurn } from '../../../ragConversation/service';
import type { AiFeatureLocalData } from '../localData';
import { AiFeatureFlow } from '../AiFeatureFlow';
import {
  apple,
  completeInventory,
  localData,
  selectionStore,
} from '../featureServiceFixtures';

jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

/** Partial local coverage must stop the integrated RAG route before model inference. */
test('shows the insufficient-evidence response from the integrated RAG route', async () => {
  const source = localData([]);
  const partialData: AiFeatureLocalData = {
    ...source.data,
    loadInventory: jest.fn(async (): Promise<LocalHealthEvidenceInventory> => ({
      ...completeInventory,
      inventoryComplete: false,
      truncatedKinds: ['health_observation'],
    })),
  };
  const ragRunner = jest.fn(async () => ({
    status: 'no_evidence' as const,
  })) as unknown as typeof runRagConversationTurn;

  await render(
    <AiFeatureFlow
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
  expect(ragRunner).not.toHaveBeenCalled();
});
