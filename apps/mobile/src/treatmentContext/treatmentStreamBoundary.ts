import type { MultiAgentInvocation } from '@orot/agent-runtime';

/** A treatment response must not expose any prefix before whole-output verification. */
export function bufferTreatmentStream(
  invocation: MultiAgentInvocation,
): MultiAgentInvocation {
  return { ...invocation, onTaskStreamEvent: undefined };
}
