import { stableJson } from './evidenceUtils';
import type {
  EvidenceSearchTool,
  EvidenceSearchRequest,
  EvidenceSearchRuntime,
  EvidenceSearchOutcome,
} from '@orot/agent-runtime';

type Around = (
  request: EvidenceSearchRequest,
  runtime: EvidenceSearchRuntime | undefined,
  dispatch: () => Promise<EvidenceSearchOutcome>,
) => Promise<EvidenceSearchOutcome>;

/** Preserve adapter receivers and post-dispatch lineage for both ordinary and pre-authorized execution. */
export function wrapEvidenceSearch(
  tool: EvidenceSearchTool,
  around: Around,
  mapRequest: (
    request: EvidenceSearchRequest,
  ) => EvidenceSearchRequest = request => request,
): EvidenceSearchTool {
  return {
    id: tool.id,
    sourceKind: tool.sourceKind,
    execution: tool.execution,
    additionalModelCalls: tool.additionalModelCalls,
    description: tool.description,
    inputSchema: tool.inputSchema,
    parseInput: value => tool.parseInput(value),
    search: (request, runtime) =>
      around(request, runtime, () => tool.search(mapRequest(request), runtime)),
    ...(tool.prepareAuthorizedSearch
      ? ({
          async prepareAuthorizedSearch(request, runtime) {
            const identity = () =>
              stableJson({
                run: request.operationRunId,
                key: request.operationKey,
                input: request.input,
                scope: request.allowedScope,
                limit: request.resultLimit,
                bytes: request.maxPayloadBytes,
              });
            const original = identity();
            const prepared = await tool.prepareAuthorizedSearch!(
              mapRequest(request),
              runtime,
            );
            if (prepared.status !== 'authorized') return prepared;
            let consumed = false;
            return {
              status: 'authorized' as const,
              async dispatch() {
                if (
                  consumed ||
                  request.signal.aborted ||
                  identity() !== original
                )
                  throw new Error('Prepared search is no longer available.');
                consumed = true;
                return around(request, runtime, () => prepared.dispatch());
              },
            };
          },
        } satisfies Pick<EvidenceSearchTool, 'prepareAuthorizedSearch'>)
      : {}),
  };
}
