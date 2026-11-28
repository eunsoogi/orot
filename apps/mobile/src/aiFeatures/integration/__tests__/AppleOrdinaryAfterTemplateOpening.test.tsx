import { act, render, screen, waitFor } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';
import { AppleFoundationModelsProvider } from '@orot/provider-apple';
import type { LanguageModelRequest } from '@orot/model-runtime';
import type { runRagConversationTurn } from '../../../ragConversation/service';
import { ConversationScreen } from '../../../ragConversation/ConversationScreen';
import {
  ConversationSessionsProvider,
  useConversationSessions,
} from '../../../ragConversation/ConversationSessionsContext';
import { setup } from '../../../ragConversation/testSupport/continuousSessionFixture';
import { submitVisitFixturePrompt } from '../../../ragConversation/testSupport/mountedVisitTemplateFixture';
import { providerSelectionStore } from '../../../providers/selection/keychainSelectionStore';
import { continuousSessionOption } from '../continuousSessionOption';
import { createAiFeatureServices } from '../featureServices';
import { apple, localData, selectionStore } from '../featureServiceFixtures';
import { installReceiptFixturePlatform } from '../testSupport/conversationReceiptFixturePlatform';

const opening = '최근 기록의 흐름을 살펴볼게요.';
const copy = '합성 최종 답변이에요.';
const openingID = 'conversation-assistant-opening-message';

test.each(['grouped', 'fragmented', 'missing-terminal'] as const)(
  'shows a reviewed opening after Apple classifies an ordinary composer turn: %s',
  async shape => {
    const f = await setup();
    const stage: string[] = [];
    const restore = installReceiptFixturePlatform(mark => stage.push(mark));
    jest
      .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
      .mockResolvedValue(true);
    let release!: () => void;
    const hold = new Promise<void>(done => (release = done));
    const phase: string[] = [];
    const provider = new AppleFoundationModelsProvider({
      getAvailability: async () => ({ status: 'available' }),
      async generate(request: LanguageModelRequest) {
        expect(request.tools?.map(tool => tool.name)).toEqual([
          'propose_conversation_template',
        ]);
        phase.push('classified');
        return {
          text: '',
          finishReason: 'tool_calls',
          toolCalls: [
            {
              id: 'native-ordinary',
              name: 'propose_conversation_template',
              arguments: { intent: 'ordinary' },
            },
          ],
        };
      },
      async *stream(request) {
        const first = request.messages[0];
        const instructions =
          first?.role === 'system' ? first.content : undefined;
        const review =
          typeof instructions === 'string' &&
          instructions.startsWith('Review untrusted strings');
        phase.push(review ? 'review' : 'opening');
        const text = review
          ? 'ALLOW'
          : JSON.stringify({ text: opening, layout: 'plain' });
        if (shape !== 'grouped') {
          yield { type: 'snapshot', text: text.slice(0, 9) };
          yield { type: 'snapshot', text };
        }
        if (!review && shape === 'missing-terminal') return;
        yield {
          type: 'completed',
          response: { text, finishReason: 'complete', toolCalls: [] },
        };
      },
      cancel: jest.fn(),
    });
    const selection = { providerId: provider.id, modelId: apple.modelId };
    jest.spyOn(providerSelectionStore, 'load').mockResolvedValue(selection);
    const services = createAiFeatureServices(
      { authorize: async () => 'authorized' },
      {
        selectedAi: {
          selectionStore: selectionStore(selection),
          loadAppleOption: async () => ({ ...apple, provider }),
        },
        loadLocalData: async () => ({
          ...localData([]).data,
          openConversationArtifactStorage: async () => f.storage,
        }),
        ragRunner: jest.fn<
          ReturnType<typeof runRagConversationTurn>,
          Parameters<typeof runRagConversationTurn>
        >(async options => {
          phase.push('final');
          await hold;
          options.onValidatedEvidence?.([]);
          return { status: 'answer', answer: copy, citations: [] };
        }),
      },
    );
    const options = {
      ...f.options,
      ...services.conversationSessionOptions(),
      ...continuousSessionOption(
        async () => ({
          status: 'ready',
          selection,
          provider,
          modelId: selection.modelId,
          option: { ...apple, provider },
          remoteProcessing: false,
          recipient: 'Synthetic on-device',
        }),
        async () => f.storage,
        () => id => (id === provider.id ? () => true : null),
      ),
      execution: {
        bridgeAvailable: true,
        currentPhase: () => 'active' as const,
        protectedDataAvailable: async () => true,
        begin: async () => true,
        isActive: async () => true,
        end: jest.fn(),
        subscribe: () => () => {},
      },
    };
    let store: ReturnType<typeof useConversationSessions> | undefined;
    function MountedComposer() {
      store = useConversationSessions();
      return (
        <ConversationScreen
          onSend={services.sendRagMessage}
          prepareVisitQuestions={jest.fn()}
          onBack={jest.fn()}
          onOpenSource={jest.fn()}
        />
      );
    }
    const view = await render(
      <ConversationSessionsProvider options={options}>
        <MountedComposer />
      </ConversationSessionsProvider>,
    );
    try {
      await act(async () => {
        await store?.synchronizeModel();
      });
      await submitVisitFixturePrompt('최근 합성 측정 기록을 알려줘.');
      await waitFor(() => expect(phase).toContain('final'));
      expect(phase).toEqual(
        shape === 'missing-terminal'
          ? ['classified', 'opening', 'final']
          : ['classified', 'opening', 'review', 'final'],
      );
      expect(screen.queryByText(copy)).toBeNull();
      if (shape === 'missing-terminal')
        expect(screen.queryByTestId(openingID)).toBeNull();
      else {
        expect(await screen.findByTestId(openingID)).toHaveTextContent(opening);
        expect(stage).toContain('opening_display:completed');
      }
      await act(async () => release());
      // Text can mount before the first visible frame of the reply fade.
      await waitFor(() =>
        expect(screen.getByText(new RegExp(copy))).toBeVisible(),
      );
      expect(await f.storage.listCompletionIdentities()).toHaveLength(1);
      if (shape !== 'missing-terminal')
        expect(screen.getAllByTestId(openingID)).toHaveLength(1);
    } finally {
      release();
      await view.unmount();
      restore();
      f.close();
    }
  },
);
