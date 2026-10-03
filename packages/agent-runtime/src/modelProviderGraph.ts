import { Annotation, END, START, StateGraph } from '@langchain/langgraph/web';
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
    .addNode('generate', async state => ({
      result: await provider.generate(state.request),
    }))
    .addEdge(START, 'generate')
    .addEdge('generate', END)
    .compile();
}
