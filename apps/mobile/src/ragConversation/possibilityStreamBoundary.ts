import type { MultiAgentInvocation } from '@orot/agent-runtime';
import type { ConversationIntent } from '../aiFeatures/integration/conversationIntent';

/** Hold possibility prose until the workflow has validated the complete result and citations. */
export function bufferPossibilityStream(
  intent: ConversationIntent | undefined,
  invocation: MultiAgentInvocation,
): MultiAgentInvocation {
  return intent === 'possibilities'
    ? { ...invocation, onTaskStreamEvent: undefined }
    : invocation;
}
