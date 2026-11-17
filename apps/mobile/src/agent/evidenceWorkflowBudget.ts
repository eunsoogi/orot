import { DEFAULT_MULTI_AGENT_BUDGET } from '@orot/agent-runtime';

/** Interactive work ends on completion, cancellation or a real provider/OS boundary, not a local quota. */
export const EVIDENCE_WORKFLOW_BUDGET = {
  ...DEFAULT_MULTI_AGENT_BUDGET,
  executionLimits: 'unbounded',
  timeoutMs: null,
  maxModelRequestBytes: null,
  maxAccumulatedEvidenceItems: null,
} as const;
