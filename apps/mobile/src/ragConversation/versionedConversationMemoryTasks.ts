import type { TaskResponderContract } from '@orot/agent-runtime';
import { withReplyPreferenceSpan } from './authoredReplyPreferenceSpan';
import { withAuthoredMemorySpan } from './authoredMemorySpanTask';
import type { GroundedRagAnswer } from './task';

/** Memory versions own dates/schema independently of optional layout updates. */
export function versionedConversationMemoryTasks(
  conversationTaskV24: TaskResponderContract<GroundedRagAnswer>,
  weightedTask: TaskResponderContract<GroundedRagAnswer>,
  horizontalListTask: TaskResponderContract<GroundedRagAnswer>,
) {
  const conversationTaskV25 = withReplyPreferenceSpan(conversationTaskV24);
  const conversationTaskV26 = withAuthoredMemorySpan(conversationTaskV25);
  const conversationTaskV27 = withAuthoredMemorySpan(conversationTaskV25, '27');
  const conversationTaskV28 = withAuthoredMemorySpan(
    withReplyPreferenceSpan(conversationTaskV24, true),
    '28',
  );
  return {
    conversationTaskV25,
    conversationTaskV26,
    conversationTaskV27,
    conversationTaskV28,
    conversationTaskV29: withAuthoredMemorySpan(
      withReplyPreferenceSpan(weightedTask, true),
      '29',
    ),
    ragConversationTask: withAuthoredMemorySpan(
      withReplyPreferenceSpan(horizontalListTask, true),
      '30',
    ),
  };
}
