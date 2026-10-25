import type { EvidenceBatch, EvidenceSearchTool } from '../src/multiAgent/evidenceContracts';
import type { TrustedEvidenceToolContext } from '../src/langchain/evidenceTool';
import { createLangChainEvidenceTool } from '../src/langchain/evidenceTool';

// A real LangChain tool around a fake domain service exercises transport and trusted capability wiring.
export function fixture() {
  const controller = new AbortController();
  const batch: EvidenceBatch = {
    items: [
      {
        sourceKind: 'personal_record',
        sourceId: 'record',
        sourceRevision: 'r1',
        evidenceId: 'evidence',
        evidenceRevision: 'e1',
        locator: { row: 1 },
        effectiveTime: null,
        reviewState: 'reviewed',
        content: 'Local observation',
      },
    ],
    coverage: [
      {
        sourceKind: 'personal_record',
        searchedSourceIds: ['record'],
        gaps: [],
        truncated: false,
        resultLimit: 1,
        returnedCount: 1,
      },
    ],
    conflicts: [],
  };
  const domain: EvidenceSearchTool = {
    id: 'search_records',
    description: 'Search selected records',
    sourceKind: 'personal_record',
    execution: 'local_read_only',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
      additionalProperties: false,
    },
    parseInput: jest.fn((value) => {
      const input = value as { query: string };
      return input.query.trim() ? { query: input.query } : undefined;
    }),
    search: jest.fn(async () => batch),
  };
  const request = {
    operationRunId: 'run',
    operationKey: 'tool:1',
    allowedScope: { sourceKinds: ['personal_record'] as const, sourceIds: ['record'] },
    resultLimit: 1,
    maxPayloadBytes: 4096,
  };
  const context: TrustedEvidenceToolContext = {
    signal: controller.signal,
    timedOut: () => false,
    reserveSearch: jest.fn(() => request),
    revalidateEvidence: jest.fn(async () => true),
  };
  return {
    controller,
    batch,
    domain,
    request,
    context,
    tool: createLangChainEvidenceTool(domain, context),
  };
}
