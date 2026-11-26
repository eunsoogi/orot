import {
  createChatGPTPlanProvider,
  type ChatGPTPlanNativeBridge,
  type ChatGPTPlanNativeEvent,
  type ChatGPTPlanRequest,
} from '@orot/provider-openai';
import { NativeModules } from 'react-native';
import { runRagConversationTurn } from '../../../ragConversation/service';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { localData } from '../featureServiceFixtures';
import { createRagConversationService } from '../ragConversationService';
import { publicEvidenceFixture } from '../testSupport/publicWebEvidenceTestSupport';

test('repeated compatible Conversation requests report only accepted Plan terminal cache usage', async () => {
  const prior = NativeModules.OrotProviderDiagnostics;
  const report = jest.fn();
  NativeModules.OrotProviderDiagnostics = { enabled: true, report };
  const listeners = new Set<(event: ChatGPTPlanNativeEvent) => void>();
  const requests: ChatGPTPlanRequest[] = [];
  const cases = [
    {
      usage: {
        inputTokens: 24,
        outputTokens: 12,
        totalTokens: 36,
        cachedInputTokens: 0,
      },
      state: 'reported_zero',
      observedCount: 0,
    },
    {
      usage: {
        inputTokens: 24,
        outputTokens: 12,
        totalTokens: 36,
        cachedInputTokens: 19,
      },
      state: 'reported_positive',
      observedCount: 19,
    },
    { usage: undefined, state: 'unknown', observedCount: undefined },
    {
      usage: {
        inputTokens: 24,
        outputTokens: 12,
        totalTokens: 36,
        cachedInputTokens: 25,
      },
      state: 'unknown',
      observedCount: undefined,
    },
  ];
  const syntheticResponse = JSON.stringify({
    type: 'result',
    value: { answerKind: 'conversation', answer: '천만에요!' },
    citations: [],
  });
  const emit = (event: ChatGPTPlanNativeEvent) => {
    for (const receive of listeners) receive(event);
  };
  const model = { slug: 'gpt-6-luna', displayName: 'Synthetic' };
  const bridge: ChatGPTPlanNativeBridge = {
    async listModels() {
      return [model];
    },
    subscribe(receive) {
      listeners.add(receive);
      return () => {
        listeners.delete(receive);
      };
    },
    async startResponse(requestId, _client, request) {
      const wire = cases[requests.length];
      if (!wire) throw new Error('Unexpected repeated request');
      requests.push(request);
      emit({
        type: 'response_started',
        requestId,
        responseId: 'synthetic-response',
      });
      emit({ type: 'text_delta', requestId, text: syntheticResponse });
      // Another request cannot supply this terminal.
      emit({
        type: 'completed',
        requestId: 'unowned',
        text: syntheticResponse,
        usage: {
          inputTokens: 24,
          outputTokens: 12,
          totalTokens: 36,
          cachedInputTokens: 24,
        },
      });
      emit({
        type: 'completed',
        requestId,
        text: syntheticResponse,
        usage: wire.usage,
      });
    },
    cancelResponse: jest.fn(),
  };
  const actual = createChatGPTPlanProvider({
    bridge,
    issuedClientID: 'synthetic',
    model,
  });
  const terminalCounts: Array<number | undefined> = [];
  const provider = {
    ...actual,
    async *stream(...input: Parameters<NonNullable<typeof actual.stream>>) {
      for await (const event of actual.stream!(...input)) {
        if (event.ok && event.value.type === 'completed') {
          terminalCounts.push(event.value.response.usage?.cachedInputTokens);
        }
        yield event;
      }
    },
  };
  const { selected, consent } = publicEvidenceFixture();
  const external = jest.fn(async () => {
    throw new Error('Unexpected external search');
  });
  const send = createRagConversationService({
    selectedAi: async () => ({
      ...selected,
      provider,
      option: { ...selected.option, provider },
    }),
    consent,
    queryConsent: { authorize: async () => 'denied' },
    externalEvidence: { search: external },
    loadLocalData: async () => localData([]).data,
    registry: new LocalEvidenceReferenceRegistry(),
    ragRunner: runRagConversationTurn,
  });
  try {
    for (const expected of cases) {
      report.mockClear();
      const result = await send('고마워요.', [], new AbortController().signal, {
        inputOrigin: 'composer',
        suppressContextualOpening: true,
      });
      expect(result).toMatchObject({
        status: 'answer',
        answer: expect.stringContaining('천만에요!'),
      });
      expect(
        report.mock.calls.filter(([, stage]) =>
          stage.startsWith('chatgpt_prompt_cache_'),
        ),
      ).toEqual([
        ['rag', 'chatgpt_prompt_cache_' + expected.state, 'completed'],
      ]);
    }
    expect(terminalCounts).toEqual(
      cases.map(expected => expected.observedCount),
    );
    expect(requests).toHaveLength(cases.length);
    expect(listeners.size).toBe(0);
    // Compare complete compatible input and tool order, without persisting request bytes.
    expect(requests[0]?.tools?.length).toBeGreaterThan(0);
    for (const request of requests)
      expect(JSON.stringify(request)).toBe(JSON.stringify(requests[0]));
    expect(external).not.toHaveBeenCalled();
    expect(bridge.cancelResponse).not.toHaveBeenCalled();
  } finally {
    NativeModules.OrotProviderDiagnostics = prior;
  }
});
