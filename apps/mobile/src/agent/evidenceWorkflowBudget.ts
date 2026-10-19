import { DEFAULT_MULTI_AGENT_BUDGET } from '@orot/agent-runtime';

/** Model-selected search and the cited answer share one finite, cancellable deadline. */
export const EVIDENCE_WORKFLOW_BUDGET = {
  ...DEFAULT_MULTI_AGENT_BUDGET,
  // A real on-device tool round trip can exceed 45 seconds, including bounded
  // SQL retrieval. Keep the shared runtime's 90-second ceiling and all size/call limits.
  timeoutMs: 90_000,
} as const;
