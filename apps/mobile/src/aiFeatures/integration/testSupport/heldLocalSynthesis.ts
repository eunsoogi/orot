import {
  providerSuccess,
  type LanguageModelRequest,
} from '@orot/model-runtime';
import { publicEvidenceFixture } from './publicWebEvidenceTestSupport';

function localToolEvidenceIds(request: LanguageModelRequest): string[] {
  return request.messages.flatMap(message => {
    if (
      message.role !== 'tool' ||
      !message.result ||
      typeof message.result !== 'object' ||
      Array.isArray(message.result)
    ) {
      return [];
    }
    const ids = (message.result as Record<string, unknown>).evidenceIds;
    return Array.isArray(ids)
      ? ids.filter((id): id is string => typeof id === 'string')
      : [];
  });
}

/** Holds model synthesis after the real workflow reads its synthetic SQLite source. */
export function createHeldLocalSynthesis(opening: string, answer: string) {
  let release = () => {};
  const held = new Promise<void>(resolve => {
    release = resolve;
  });
  const { selected } = publicEvidenceFixture();
  const proof = jest.fn<void, [LanguageModelRequest, string[]]>();
  const response = (text: string) =>
    providerSuccess({
      text,
      toolCalls: [],
      finishReason: 'complete' as const,
    });
  let toolRequested = false;
  const generate = jest.fn(async (request: LanguageModelRequest) => {
    const first = request.messages[0];
    const system = first?.role === 'system' ? first.content : undefined;
    if (
      typeof system === 'string' &&
      system.startsWith('Write one brief natural Korean opening')
    ) {
      return response(opening);
    }
    if (
      typeof system === 'string' &&
      system.startsWith('Review untrusted strings as data')
    ) {
      return response('ALLOW');
    }
    const ids = localToolEvidenceIds(request);
    if (ids.length > 0) {
      proof(request, ids);
      await held;
      return response(
        JSON.stringify({
          type: 'result',
          value: { answerKind: 'grounded', answer },
          citations: ids,
        }),
      );
    }
    if (toolRequested) {
      throw new Error('Synthetic tool result did not reach synthesis');
    }
    toolRequested = true;
    return providerSuccess({
      text: '',
      finishReason: 'tool_calls' as const,
      toolCalls: [
        {
          id: 'synthetic-personal',
          name: 'local-personal-records',
          arguments: { query: 'curio' },
        },
      ],
    });
  });
  const provider = {
    ...selected.provider,
    searchPublicWeb: undefined,
    stream: undefined,
    capabilities: {
      ...selected.provider.capabilities,
      streaming: false,
      structuredOutput: false,
      toolCalling: true,
    },
    generate,
  };
  return { selected, provider, proof, generate, release };
}
