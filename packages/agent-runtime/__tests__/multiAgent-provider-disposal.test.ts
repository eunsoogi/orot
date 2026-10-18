import { providerSuccess, type LanguageModelProvider } from '@orot/model-runtime';
import { createEuropePmcEvidenceSearchTool, runMultiAgentWorkflow } from '../src';
import {
  makeProvider,
  publication,
  scriptedOutputs,
  workflowOptions,
} from './multiAgent-external-evidence-fixtures';

// A native Tool callback can outlive a provider reply while the graph validates its request.
// Every graph exit must release that private run without aborting its caller's controller.
test.each(['result', 'invalid_output', 'unavailable', 'cancelled'] as const)(
  'disposes retained provider work when the workflow ends with %s',
  async (expected) => {
    const caller = new AbortController();
    const cancelled = jest.fn();
    const tool = createEuropePmcEvidenceSearchTool({
      service: { search: async () => ({ status: 'available', publications: [publication] }) },
      consent: { authorize: async () => 'authorized' },
    });
    const base = makeProvider([]).provider;
    let runSignal: AbortSignal | undefined;
    let calls = 0;
    const provider: LanguageModelProvider = {
      ...base,
      capabilities: { ...base.capabilities, toolCalling: true },
      async generate(_request, options) {
        calls += 1;
        if (!runSignal) {
          runSignal = options?.signal;
          runSignal?.addEventListener('abort', cancelled, { once: true });
        }
        if (expected === 'unavailable') throw new Error('Synthetic native failure');
        if (expected === 'cancelled') caller.abort();
        return calls === 1
          ? providerSuccess({
              text: '',
              toolCalls: [
                {
                  id: 'bridge-call-1',
                  name: expected === 'invalid_output' ? 'unknown-tool' : tool.id,
                  arguments: { query: 'synthetic query' },
                },
              ],
              finishReason: 'tool_calls',
            })
          : providerSuccess({
              text: scriptedOutputs()[2]!,
              toolCalls: [],
              finishReason: 'complete',
            });
      },
    };
    const result = await runMultiAgentWorkflow(workflowOptions(provider, tool), {
      signal: caller.signal,
    });
    expect(result.status).toBe(expected);
    expect(runSignal?.aborted).toBe(true);
    expect(cancelled).toHaveBeenCalledTimes(1);
    expect(caller.signal.aborted).toBe(expected === 'cancelled');
  },
);
