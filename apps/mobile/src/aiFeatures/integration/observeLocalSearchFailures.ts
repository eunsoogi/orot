import type { EvidenceSearchTool } from '@orot/agent-runtime';

const LOCAL_SEARCH_FAILURE_GAP =
  '로컬 검색을 사용할 수 없어 근거를 찾지 못했어요.';

/** Track storage failures without retaining exceptions or treating cancellation as failure. */
export function observeLocalSearchFailures(
  tools: readonly EvidenceSearchTool[],
  onFailure: () => void,
): readonly EvidenceSearchTool[] {
  return tools.map(tool => {
    if (tool.execution !== 'local_read_only') return tool;
    return {
      ...tool,
      async search(...args: Parameters<EvidenceSearchTool['search']>) {
        let outcome: Awaited<ReturnType<EvidenceSearchTool['search']>>;
        try {
          outcome = await tool.search(...args);
        } catch (error) {
          if (
            !args[0].signal.aborted &&
            tool.parseInput(args[0].input) !== undefined &&
            !(error instanceof Error && error.name === 'AbortError')
          )
            onFailure();
          throw error;
        }
        if (
          'coverage' in outcome &&
          outcome.coverage.some(coverage =>
            coverage.gaps.includes(LOCAL_SEARCH_FAILURE_GAP),
          )
        )
          onFailure();
        return outcome;
      },
    };
  });
}
