import { DEFAULT_MULTI_AGENT_BUDGET } from '@orot/agent-runtime';

/** Interactive evidence work remains user-cancellable without an elapsed time cutoff. */
export const EVIDENCE_WORKFLOW_BUDGET = {
  ...DEFAULT_MULTI_AGENT_BUDGET,
  // Consent review and model latency must not discard the request. Count, size and query limits remain.
  timeoutMs: null,
} as const;
