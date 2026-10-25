import { MemorySaver } from '@langchain/langgraph/web';
import { providerSuccess, type LanguageModelRequest } from '@orot/model-runtime';
import { createEuropePmcEvidenceSearchTool } from '../src';
import {
  makeProvider,
  publication,
  scriptedOutputs,
  workflowOptions,
} from './multiAgent-external-evidence-fixtures';

// Both production routes share the same domain adapter and persisted search boundary.
export function standardSearchFixture(native: boolean, delegated = false) {
  const saver = new MemorySaver();
  const config = { configurable: { thread_id: 'standard-evidence-search' } };
  const authorize = jest.fn(async () => 'authorized' as 'authorized' | 'denied');
  const search = jest.fn(async () => ({
    status: 'available' as const,
    publications: [publication],
  }));
  const adapter = createEuropePmcEvidenceSearchTool({
    service: { search },
    consent: { authorize },
  });
  const requests: LanguageModelRequest[] = [];
  const outputs = scriptedOutputs();
  const provider = {
    ...makeProvider([]).provider,
    capabilities: { ...makeProvider([]).provider.capabilities, toolCalling: native },
    generate: jest.fn(async (request: LanguageModelRequest) => {
      if (
        request.messages[0]?.role === 'user' &&
        request.messages[0].content === 'Synthetic public concept'
      ) {
        return providerSuccess({ text: 'Public concept', toolCalls: [], finishReason: 'complete' });
      }
      requests.push(request);
      return native && requests.length === 1
        ? providerSuccess({
            text: '',
            toolCalls: [
              {
                id: 'standard-search-call',
                name: adapter.id,
                arguments: { query: 'synthetic external literature query' },
              },
            ],
            finishReason: 'tool_calls' as const,
          })
        : providerSuccess({
            text: native ? outputs[2]! : outputs[requests.length - 1]!,
            toolCalls: [],
            finishReason: 'complete' as const,
          });
    }),
  };
  const searchDomain = jest.fn(async (request: Parameters<typeof adapter.search>[0]) => {
    if (delegated)
      await provider.generate({
        messages: [{ role: 'user', content: 'Synthetic public concept' }],
      });
    return adapter.search(request);
  });
  const tool = {
    ...adapter,
    ...(delegated ? { additionalModelCalls: 1 as const } : {}),
    search: searchDomain,
  };
  const base = workflowOptions(provider, tool);
  const options = {
    ...base,
    checkpointer: saver,
    execution: {
      ...base.execution,
      budget: { ...base.execution.budget, maxModelCalls: native ? 3 : 4 },
    },
  };
  return { saver, config, authorize, search, searchDomain, requests, provider, tool, options };
}
