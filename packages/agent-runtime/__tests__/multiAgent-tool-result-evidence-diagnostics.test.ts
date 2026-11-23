import { providerSuccess, type LanguageModelRequest } from '@orot/model-runtime';
import { createEuropePmcEvidenceSearchTool, runMultiAgentWorkflow } from '../src';
import type { ModelStage } from '../src/multiAgent/modelStageDiagnostics';
import {
  makeProvider,
  publication,
  scriptedOutputs,
  workflowOptions,
} from './multiAgent-external-evidence-fixtures';

function deferred<T>() {
  let release!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

test.each(['current', 'stale', 'cancelled'] as const)(
  'separates the held tool-result authority wait from search and provider dispatch: %s',
  async (outcome) => {
    const controller = new AbortController();
    const enteredSearch = deferred<void>();
    const heldSearch = deferred<void>();
    const enteredGuard = deferred<void>();
    const heldGuard = deferred<boolean>();
    const search = jest.fn(async () => {
      enteredSearch.release();
      await heldSearch.promise;
      return { status: 'available' as const, publications: [publication] };
    });
    const tool = createEuropePmcEvidenceSearchTool({
      service: { search },
      consent: { authorize: async () => 'authorized' },
    });
    let modelCalls = 0;
    const generate = jest.fn(async (_request: LanguageModelRequest) =>
      providerSuccess(
        ++modelCalls === 1
          ? {
              text: '',
              toolCalls: [
                { id: 'synthetic-call', name: tool.id, arguments: { query: 'synthetic lookup' } },
              ],
              finishReason: 'tool_calls' as const,
            }
          : { text: scriptedOutputs()[2]!, toolCalls: [], finishReason: 'complete' as const },
      ),
    );
    const base = makeProvider([]).provider;
    const options = workflowOptions(
      { ...base, capabilities: { ...base.capabilities, toolCalling: true }, generate },
      tool,
    );
    const stages: [ModelStage, 'started' | 'completed'][] = [];
    const run = runMultiAgentWorkflow(
      {
        ...options,
        onModelStage: (stage, event) => {
          stages.push([stage, event]);
        },
        revalidateEvidence: async (references) => {
          if (
            !references.length ||
            !stages.some(([stage, event]) => stage === 'tool_search_wait' && event === 'completed')
          )
            return true;
          enteredGuard.release();
          return heldGuard.promise;
        },
      },
      { signal: controller.signal },
    );
    const searchAndGuard = () =>
      stages.filter(
        ([stage]) => stage === 'tool_search_wait' || stage === 'tool_result_evidence_check',
      );
    const premature = run.then(() => {
      throw new Error('Workflow completed before the held observation');
    });
    try {
      await Promise.race([enteredSearch.promise, premature]);
      expect(searchAndGuard()).toEqual([['tool_search_wait', 'started']]);
      expect(generate).toHaveBeenCalledTimes(1);
      heldSearch.release();
      await Promise.race([enteredGuard.promise, premature]);
      expect(searchAndGuard()).toEqual([
        ['tool_search_wait', 'started'],
        ['tool_search_wait', 'completed'],
        ['tool_result_evidence_check', 'started'],
      ]);
      expect(generate).toHaveBeenCalledTimes(1);
      if (outcome === 'cancelled') controller.abort();
      else heldGuard.release(outcome === 'current');

      const result = await run;
      expect(result.status).toBe(
        outcome === 'current' ? 'result' : outcome === 'stale' ? 'stale_evidence' : 'cancelled',
      );
      expect(generate).toHaveBeenCalledTimes(outcome === 'current' ? 2 : 1);
      expect(search).toHaveBeenCalledTimes(1);
      expect(searchAndGuard()).toEqual([
        ['tool_search_wait', 'started'],
        ['tool_search_wait', 'completed'],
        ['tool_result_evidence_check', 'started'],
        ['tool_result_evidence_check', 'completed'],
      ]);
    } finally {
      heldSearch.release();
      heldGuard.release(false);
      await run;
    }
  },
);
