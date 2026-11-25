import type { LanguageModelRequest } from '@orot/model-runtime';
import { AppleFoundationModelsProvider } from '@orot/provider-apple';
import {
  createChatGPTPlanProvider,
  type ChatGPTPlanNativeEvent,
  type ChatGPTPlanRequest,
} from '@orot/provider-openai';
import { serializeAppleRequest } from '../../providers/apple/serializeRequest';
import { runRagConversationTurn } from '../service';
import { fixture } from '../testSupport/conversationEnvelopeFixtures';
import { conversationA2UICatalog } from '../conversationA2UI';

const evidence = { items: [], coverage: [], conflicts: [] };
const plainMarkdown = '**천만에요.**';
const plainAnswer = '천만에요.';
const envelope = (
  answer: string,
  a2ui?: string,
  a2uiFrames?: readonly string[],
) => ({
  type: 'result',
  value: {
    answerKind: 'conversation',
    answer,
    ...(a2ui !== undefined ? { a2ui } : {}),
    ...(a2uiFrames !== undefined ? { a2uiFrames } : {}),
  },
  citations: [],
});
const exactSurface = JSON.stringify({
  version: '1.0',
  createSurface: {
    surfaceId: 'orot:response:draft',
    catalogId: conversationA2UICatalog,
    components: [{ id: 'root', component: 'Text', text: plainAnswer }],
  },
});

function options(provider: ReturnType<typeof createChatGPTPlanProvider>) {
  const { options: sample } = fixture();
  return {
    ...sample,
    question: '고마워요',
    loadCurrentEvidence: async () => ({ batch: evidence, chunks: [] }),
    workflow: {
      ...sample.workflow,
      provider,
      execution: { ...sample.workflow.execution, providerId: provider.id },
    },
  };
}

test.each([
  ['native model', 'on-device'],
  ['private cloud model', 'private-cloud-compute'],
] as const)(
  '%s compiles a bounded native frame array',
  async (_name, route) => {
    const captured: ReturnType<typeof serializeAppleRequest>[] = [];
    const response = {
      text: '',
      structuredOutput: envelope(plainMarkdown, undefined, []),
      toolCalls: [],
      finishReason: 'complete' as const,
    };
    const encode = (request: LanguageModelRequest) =>
      captured.push(serializeAppleRequest(request));
    const provider = new AppleFoundationModelsProvider(
      {
        getAvailability: async () => ({ status: 'available' }),
        generate: async request => {
          encode(request);
          return response;
        },
        async *stream(request) {
          encode(request);
          yield { type: 'completed', response };
        },
        cancel() {},
      },
      route,
    );
    const outcome = await runRagConversationTurn(options(provider));
    expect(outcome).toEqual({
      status: 'answer',
      answer: plainMarkdown,
      citations: [],
    });
    expect(captured).toHaveLength(1);
    expect(captured[0]?.nativeResponseSchema).toMatchObject({
      kind: 'object',
      properties: expect.arrayContaining([
        expect.objectContaining({
          name: 'value',
          schema: expect.objectContaining({
            properties: expect.arrayContaining([
              expect.objectContaining({
                name: 'a2uiFrames',
                optional: false,
                schema: {
                  kind: 'array',
                  maximumElements: 12,
                  item: { kind: 'string' },
                },
                description: expect.stringContaining('orot:response:draft'),
              }),
            ]),
          }),
        }),
      ]),
    });
  },
);

test.each([
  ['keeps legacy Markdown fallback', envelope(plainMarkdown, '{'), undefined],
  ['admits verified layout', envelope(plainAnswer, exactSurface), 'Text'],
  [
    'admits a staged frame sequence',
    envelope(plainAnswer, undefined, [exactSurface]),
    'Text',
  ],
])(
  'ChatGPT text encoder %s without a second request',
  async (_name, result, rootKind) => {
    let listener: ((event: ChatGPTPlanNativeEvent) => void) | undefined;
    const packets: ChatGPTPlanRequest[] = [];
    const provider = createChatGPTPlanProvider({
      issuedClientID: 'synthetic',
      model: { slug: 'synthetic', displayName: 'Synthetic' },
      bridge: {
        async listModels() {
          return [];
        },
        subscribe(next) {
          listener = next;
          return () => {
            listener = undefined;
          };
        },
        async startResponse(requestId, _client, packet) {
          packets.push(packet);
          const text = JSON.stringify(result);
          listener?.({ requestId, type: 'text_delta', text });
          listener?.({ requestId, type: 'completed', text });
        },
        cancelResponse() {},
      },
    });
    const outcome = await runRagConversationTurn(options(provider));
    expect(packets).toHaveLength(1);
    expect(packets[0]).not.toHaveProperty('responseFormat');
    expect(JSON.stringify(packets[0]?.messages)).toContain(
      'orot:response:draft',
    );
    expect(outcome).toMatchObject({
      status: 'answer',
      answer: result.value.answer,
      citations: [],
    });
    if (rootKind)
      expect(outcome).toMatchObject({
        a2uiPresentation: { component: rootKind },
      });
    else expect(outcome).not.toHaveProperty('a2uiPresentation');
  },
);
