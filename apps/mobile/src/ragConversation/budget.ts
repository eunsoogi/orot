import { DEFAULT_MULTI_AGENT_BUDGET } from '@orot/agent-runtime';

/** Literature turns include three model calls and one network search inside one finite deadline. */
export const RAG_CONVERSATION_BUDGET = {
  ...DEFAULT_MULTI_AGENT_BUDGET,
  timeoutMs: 90_000,
} as const;
