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
const fruitAnswer = '사과\n배\n포도';
const envelope = (
  answer: string,
  a2ui?: string,
  answerLayout?: string,
) => ({
  type: 'result',
  value: {
    answerKind: 'conversation',
    answer,
    ...(a2ui !== undefined ? { a2ui } : {}),
    ...(answerLayout !== undefined ? { answerLayout } : {}),
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

function options(
  provider: ReturnType<typeof createChatGPTPlanProvider>,
  question = '고마워요',
) {
  const { options: sample } = fixture();
  return {
    ...sample,
    question,
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
  '%s compiles the required layout enum and returns a verified list',
  async (_name, route) => {
    const captured: ReturnType<typeof serializeAppleRequest>[] = [];
    const response = {
      text: '',
      structuredOutput: envelope(fruitAnswer, undefined, 'list'),
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
    const outcome = await runRagConversationTurn(
      options(provider, '과일 세 가지를 예로 들어 주세요.'),
    );
    expect(outcome).toMatchObject({
      status: 'answer',
      answer: fruitAnswer,
      citations: [],
      a2uiPresentation: {
        component: 'Card',
        children: [{ component: 'List' }],
      },
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
                name: 'answerLayout',
                optional: false,
                schema: { kind: 'enum', values: ['plain', 'list'] },
                description: expect.stringContaining('distinct items'),
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
  ['admits the typed list choice', envelope(fruitAnswer, undefined, 'list'), 'Card'],
  ['admits verified layout', envelope(plainAnswer, exactSurface), 'Text'],
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
      'answerLayout',
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
