import { Annotation, END, START, StateGraph } from '@langchain/langgraph/web';
import { invokeProductionRequest } from './langchain/production';
import { NativeChatModelError } from './langchain/chatModel';
import type {
  LanguageModelProvider,
  LanguageModelRequest,
  LanguageModelResponse,
  ProviderResult,
} from '@orot/model-runtime';

const ProviderInvocation = Annotation.Root({
  request: Annotation<LanguageModelRequest>(),
  result: Annotation<ProviderResult<LanguageModelResponse> | undefined>(),
});

export function createLanguageModelProviderGraph(provider: LanguageModelProvider) {
  return new StateGraph(ProviderInvocation)
    .addNode('generate', async (state) => {
      // Preserve the graph envelope while the standard adapter owns private dispatch.
      try {
        return {
          result: {
            ok: true as const,
            value: await invokeProductionRequest(provider, state.request),
          },
        };
      } catch (error) {
        return {
          result: {
            ok: false as const,
            error: {
              code:
                error instanceof NativeChatModelError ? error.code : ('internal_error' as const),
              message: '',
              retryable: error instanceof NativeChatModelError && error.retryable,
            },
          },
        };
      }
    })
    .addEdge(START, 'generate')
    .addEdge('generate', END)
    .compile();
}
