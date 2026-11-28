import { publicSearchNotice } from '../defaultPublicSearch';
import { agentMemoryDatabaseFacade } from '../../../storage/agentMemoryDatabaseFacade';
import { guardedNativeDatabase } from '../../../storage/protectedReadEpoch';
import { fireEvent, screen } from '@testing-library/react-native';
import {
  createChatGPTPlanProvider,
  type ChatGPTPlanNativeEvent,
  type ChatGPTPlanRequest,
} from '@orot/provider-openai';
import { conversationA2UICatalog } from '../../../ragConversation/conversationA2UI';
import { conversationExecutionNative } from '../../../ragConversation/conversationExecutionNative';
import { submitVisitFixturePrompt } from '../../../ragConversation/testSupport/mountedVisitTemplateFixture';
import * as openAI from '../../../providers/openai';
import { nativeChatGPTSelectionServices } from '../../../providers/selection/chatGPTServices';
import { providerSelectionStore } from '../../../providers/selection/keychainSelectionStore';
import { createConversationArtifactStorage } from '../../../storage/conversationArtifactStorage';
import { captureNativeConversationSelectionWitness } from '../conversationNativeSelectionWitness';
import { createAiFeatureServices } from '../featureServices';
import { localData, selectionStore } from '../featureServiceFixtures';
import { createMountedShortcutRoundTrip } from '../testSupport/mountedShortcutRoundTrip';

jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);
jest.mock('../../../ragConversation/conversationExecutionNative');
jest.mock('../conversationNativeSelectionWitness');
const answer = '실내\n**물병**\n야외\n모자';
const frames = [
  {
    version: '1.0',
    createSurface: {
      surfaceId: 'orot:response:draft',
      catalogId: conversationA2UICatalog,
      components: [
        {
          id: 'root',
          component: 'Tabs',
          tabs: [
            { title: '실내', child: 'inside' },
            { title: '야외', child: 'outside' },
          ],
        },
        { id: 'inside', component: 'Text', text: '**물병**' },
        { id: 'outside', component: 'Text', text: '모자' },
      ],
    },
  },
];

const prompt =
  '주말에 나갈 때 챙길 물건을 실내와 야외로 나눠 눌러서 볼 수 있게 정리해줘.';

test('stock rich Plan tabs and app notice reopen from the same protected reply', async () => {
  const issuedClientID = 'synthetic';
  const model = { slug: 'gpt-layout', displayName: 'Synthetic Plan' };
  const listeners = new Set<(event: ChatGPTPlanNativeEvent) => void>();
  const requests: ChatGPTPlanRequest[] = [];
  const provider = createChatGPTPlanProvider({
    issuedClientID,
    model,
    bridge: {
      listModels: async () => [model],
      subscribe(listener) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      cancelResponse: jest.fn(),
      async startResponse(requestId, _client, request) {
        requests.push(request);
        const emit = (event: ChatGPTPlanNativeEvent) =>
          listeners.forEach(listener => listener(event));
        emit({
          type: 'response_started',
          requestId,
          responseId: 'fixture-' + requests.length,
        });
        if (request.toolChoice === 'required') {
          emit({
            type: 'completed',
            requestId,
            text: '',
            toolCalls: [
              {
                id: 'proposal',
                name: 'propose_conversation_template',
                arguments: JSON.stringify({ intent: 'ordinary' }),
              },
            ],
          });
          return;
        }
        const text = JSON.stringify({
          type: 'result',
          value: { answerKind: 'conversation', answer, a2uiFrames: frames },
          citations: [],
        });
        emit({ type: 'text_delta', requestId, text });
        emit({ type: 'completed', requestId, text });
      },
    },
  });
  const selection = { providerId: provider.id, modelId: model.slug };
  const account = {
    issuedClientID,
    hasDirectPlanAccess: true,
    requiresSignIn: false,
  };
  const createPlan = jest
    .spyOn(openAI, 'createOpenAIPlanProvider')
    .mockReturnValue(provider);
  const warmSelection = jest
    .spyOn(providerSelectionStore, 'load')
    .mockResolvedValue(selection);
  const warmAccount = jest
    .spyOn(nativeChatGPTSelectionServices, 'loadAccountSummary')
    .mockResolvedValue(account);
  jest
    .mocked(captureNativeConversationSelectionWitness)
    .mockReturnValue(id => (id === provider.id ? () => true : null));
  jest.mocked(conversationExecutionNative).mockReturnValue({
    bridgeAvailable: true,
    currentPhase: () => 'active',
    protectedDataAvailable: async () => true,
    subscribe: () => () => {},
    begin: async () => true,
    isActive: async () => true,
    end: () => {},
  });
  const consent = { authorize: jest.fn(async () => 'authorized' as const) };
  const feature = await createMountedShortcutRoundTrip(
    async database => {
      const owned = agentMemoryDatabaseFacade(guardedNativeDatabase(database));
      const storage = createConversationArtifactStorage(
        owned,
        owner => owner === owned,
      );
      const data = localData([]).data;
      const dependencies = {
        selectedAi: {
          selectionStore: selectionStore(selection),
          chatGPTServices: {
            listAccounts: async () => [account],
            listModels: async () => ({
              ok: true as const,
              value: [{ ...model, id: provider.id }],
            }),
            signIn: jest.fn(),
            signOut: jest.fn(),
            cancelSignIn: jest.fn(),
          },
        },
        externalQueryConsent: { authorize: async () => 'denied' as const },
        loadLocalData: async () => ({
          ...data,
          openConversationArtifactStorage: async () => storage,
        }),
      };
      const services = createAiFeatureServices(consent, dependencies);
      return {
        services,
        dependencies,
        consent,
      };
    },
    { archiveOwner: true },
  );
  try {
    await feature.mount();
    await submitVisitFixturePrompt(prompt);
    const outdoor = await screen.findByRole('tab', { name: '야외' });
    await fireEvent.press(outdoor);
    expect(screen.getByText('모자')).toBeVisible();
    expect(requests).toHaveLength(2);
    expect(JSON.stringify(requests[1]?.messages)).toContain('a2uiFrames');
    const notice = publicSearchNotice('unavailable');
    expect(screen.getAllByText(notice)).toHaveLength(1);
    const { rows } = await feature
      .database()
      .execute('SELECT result_json FROM conversation_artifacts');
    expect(rows).toHaveLength(1);
    expect(JSON.parse(String(rows[0]?.result_json))).toMatchObject({
      answer: [answer, notice].join('\n\n'),
      archivedA2UILayout: { version: 9, tree: ['Column', ['Tabs', 1, 0], 0] },
      sources: [],
      citations: [],
    });
    await feature.reopen(false);
    expect(await screen.findByRole('tab', { name: '실내' })).toBeVisible();
    expect(screen.getByText('물병')).toBeVisible();
    expect(screen.getAllByText(notice)).toHaveLength(1);
    expect(requests).toHaveLength(2);
    expect(await feature.storage().listCompletionIdentities()).toHaveLength(1);
  } finally {
    await feature.close();
    createPlan.mockRestore();
    warmSelection.mockRestore();
    warmAccount.mockRestore();
  }
});
