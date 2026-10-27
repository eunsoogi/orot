import type { JsonObject } from '@orot/model-runtime';
import type { BaseStore } from '@langchain/langgraph/web';
import type {
  EvidenceBatch,
  EvidenceSearchTool,
  MultiAgentExecutionIdentity,
} from '../multiAgent/contracts';
import { createLangChainEvidenceTool } from '../langchain/evidenceTool';
import type { TrustedEvidenceToolContext } from '../langchain/evidenceTool';

/** Two fixed local reads share the standard tool adapter's schema, scope, size and freshness checks. */
export async function collectHealthReviewEvidence(input: {
  execution: MultiAgentExecutionIdentity;
  trends: { tool: EvidenceSearchTool; input: JsonObject };
  records: { tool: EvidenceSearchTool; input: JsonObject };
  revalidate: TrustedEvidenceToolContext['revalidateEvidence'];
  store?: BaseStore;
  signal: AbortSignal;
}): Promise<EvidenceBatch> {
  const batches: EvidenceBatch[] = [];
  let calls = 0;
  for (const selected of [input.trends, input.records]) {
    if (
      selected.tool.execution !== 'local_read_only' ||
      selected.tool.sourceKind !== 'personal_record'
    )
      throw new Error('Health review requires local personal evidence tools.');
    const tool = createLangChainEvidenceTool(selected.tool, {
      signal: input.signal,
      timedOut: () => false,
      store: input.store,
      revalidateEvidence: input.revalidate,
      reserveSearch: () => {
        calls += 1;
        if (calls > input.execution.budget.maxToolCalls) return { status: 'budget_exceeded' };
        return {
          operationRunId: input.execution.operationRunId,
          operationKey: 'health-review-read-' + calls,
          allowedScope: input.execution.allowedScope,
          resultLimit: Math.floor(input.execution.budget.maxEvidenceItems / 2),
          maxPayloadBytes: Math.floor(input.execution.budget.maxPayloadBytes / 2),
        };
      },
    });
    const response = JSON.parse(await tool.invoke(selected.input));
    if (response.status !== 'result') throw new Error('Health review evidence unavailable.');
    batches.push(response.batch);
  }
  const items = batches.flatMap((batch) => batch.items);
  const coverage = batches.flatMap((batch) => batch.coverage);
  return {
    items,
    conflicts: batches.flatMap((batch) => batch.conflicts),
    coverage: [
      {
        sourceKind: 'personal_record',
        searchedSourceIds: [...new Set(items.map((item) => item.sourceId))],
        resultLimit: input.execution.budget.maxEvidenceItems,
        returnedCount: items.length,
        selectionMethod: 'ranked_retrieval',
        truncated: coverage.some((item) => item.truncated),
        gaps: [
          ...coverage.flatMap((item) => item.gaps),
          ...coverage.flatMap((item) =>
            item.truncated && item.selectionMethod !== 'ranked_retrieval'
              ? ['incomplete_health_coverage']
              : [],
          ),
          ...batches.flatMap((batch, index) =>
            batch.items.length ? [] : [index === 0 ? 'health_trends' : 'personal_records'],
          ),
        ],
      },
    ],
  };
}
