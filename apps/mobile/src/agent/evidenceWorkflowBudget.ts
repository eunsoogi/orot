import { DEFAULT_MULTI_AGENT_BUDGET } from '@orot/agent-runtime';

/** Interactive evidence work remains user-cancellable without an elapsed time cutoff. */
export const EVIDENCE_WORKFLOW_BUDGET = {
  ...DEFAULT_MULTI_AGENT_BUDGET,
  // Consent review and model latency must not discard the request. Count, size and query limits remain.
  timeoutMs: null,
  // Retrieved batches remain bounded. Do not reject their aggregate prompt/history
  // merely for crossing the same batch limit; the selected provider owns its capacity.
  maxModelRequestBytes: null,
} as const;
