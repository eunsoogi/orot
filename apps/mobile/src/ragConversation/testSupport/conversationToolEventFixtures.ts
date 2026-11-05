import type { ConversationToolEvent } from '@orot/agent-runtime';

/** Local references are registry aliases, reissued after source validation on restoration. */
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
        sourceId: 's1',
        sourceRevision: 'sr1',
        evidenceId: 'e1',
        evidenceRevision: 'er1',
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
