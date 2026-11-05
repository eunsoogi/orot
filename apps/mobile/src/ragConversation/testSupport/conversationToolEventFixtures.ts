import type { ConversationToolEvent } from '@orot/agent-runtime';

/** Synthetic contract fixtures for restoration and collapsed-tool renderer consumers. */
export const conversationToolEventFixtures: readonly ConversationToolEvent[] = [
  {
    version: 1,
    operationRunId: 'synthetic-run',
    callId: 'tool-1',
    toolName: 'local_records',
    order: 1,
    status: 'completed',
    inputSummary: { sourceKind: 'personal_record' },
    resultSummary: { referenceCount: 1 },
    sources: [
      {
        sourceKind: 'personal_record',
        sourceId: 'synthetic-record',
        sourceRevision: '1',
        evidenceId: 'synthetic-span',
        evidenceRevision: '1',
      },
    ],
  },
  {
    version: 1,
    operationRunId: 'synthetic-run',
    callId: 'tool-2',
    toolName: 'medical_literature',
    order: 2,
    status: 'failed',
    inputSummary: { sourceKind: 'external_medical' },
    sources: [],
  },
  {
    version: 1,
    operationRunId: 'synthetic-retry',
    callId: 'tool-1',
    toolName: 'local_records',
    order: 1,
    status: 'interrupted',
    inputSummary: { sourceKind: 'personal_record' },
    sources: [],
  },
];
