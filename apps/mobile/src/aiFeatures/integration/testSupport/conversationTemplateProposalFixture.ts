import { providerSuccess } from '@orot/model-runtime';
import type {
  LanguageModelProvider,
  LanguageModelResponse,
} from '@orot/model-runtime';
import type { RagConversationObserver } from '../../../ragConversation/conversationObserver';
import type { SelectedAiResolution } from '../provider';
export const question =
  '지금 병원에 가는데 검사 결과를 물어볼 건데 질문 뽑아줘';
const modelId = 'model';
const providerId = 'chatgpt-plan:test-account:model';

export function fixture(response: LanguageModelResponse, allowed = true) {
  const generate = jest.fn<
    ReturnType<LanguageModelProvider['generate']>,
    Parameters<LanguageModelProvider['generate']>
  >(async () => providerSuccess(response));
  const provider = {
    kind: 'language-model',
    id: providerId,
    displayName: 'Synthetic selected model',
    capabilities: {
      inputTypes: ['text'],
      streaming: false,
      structuredOutput: false,
      toolCalling: true,
    },
    generate,
  } satisfies LanguageModelProvider;
  const current = jest.fn(() => true);
  const isDurablyCurrent = jest.fn(async () => true);
  const observer: RagConversationObserver = {
    inputOrigin: 'composer',
    retentionRequestId: 'synthetic',
    templateProposalOwner: {
      providerId,
      modelId,
      current,
      recheck: isDurablyCurrent,
      watch: () => () => {},
    },
    modelTemplateAdmission: { current, today: null },
    onTaskStreamEvent: jest.fn(),
    onProviderReceipt: jest.fn(),
  };
  const controller = new AbortController();
  const signal = controller.signal;
  const authorization = jest.fn(async () =>
    allowed ? ('authorized' as const) : ('renewal_required' as const),
  );
  const input = {
    question,
    signal,
    observer,
    consent: { authorize: authorization },
    select: jest.fn(async (): Promise<SelectedAiResolution> => ({
      status: 'ready',
      selection: { providerId, modelId },
      modelId,
      recipient: 'synthetic-selected-recipient',
      remoteProcessing: true,
      option: {
        provider,
        modelId,
        displayName: 'Synthetic',
        privacyBoundary: 'selected-context-remote',
        availability: { status: 'available' },
      },
      provider,
    })),
  };
  return {
    input,
    generate,
    current,
    isDurablyCurrent,
    authorization,
    controller,
  };
}

export function choice(args: Record<string, string>): LanguageModelResponse {
  return {
    text: 'This text is never displayed or accepted.',
    toolCalls: [
      {
        id: 'test-call',
        name: 'propose_conversation_template',
        arguments: args,
      },
    ],
    finishReason: 'tool_calls',
  };
}
