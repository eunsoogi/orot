import type { EvidenceSearchRequest } from '@orot/agent-runtime';
import type { AiFeatureLocalData } from '../localData';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { createSummaryArtifactTool } from '../summaryArtifactTool';

/** All matching artifacts must remain reachable when one response cannot hold them. */
export async function assertArtifactPayloadPaging(
  data: AiFeatureLocalData,
  request: EvidenceSearchRequest,
) {
  const registry = new LocalEvidenceReferenceRegistry();
  const tool = createSummaryArtifactTool(data, registry);
  let cursor: string | undefined;
  const recovered: string[] = [];
  let pages = 0;
  do {
    const page = await tool.search({
      ...request,
      operationRunId: 'pressure',
      resultLimit: 3,
      maxPayloadBytes: 2048,
      input: { query: 'Synthetic', ...(cursor ? { cursor } : {}) },
    });
    if ('status' in page) throw new Error('Unexpected consent result');
    recovered.push(
      ...page.items.map(item => registry.resolve(item)!.evidenceId),
    );
    cursor = page.coverage[0]?.nextCursor;
    if (++pages > 4) throw new Error('Pagination did not advance');
  } while (cursor);
  expect(pages).toBeGreaterThan(1);
  expect(recovered).toEqual([
    '2035-01-01-run-c',
    '2035-01-01-run-b',
    '2035-01-01-run-a',
  ]);
}
