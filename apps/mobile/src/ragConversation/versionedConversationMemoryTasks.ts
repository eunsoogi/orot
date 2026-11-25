import { withFinalConversationCheckbox } from './conversationA2UICheckboxTask';
import { withFinalConversationCardWeight } from './conversationA2UICardWeightTask';
import { withFinalConversationCaption } from './conversationA2UICaptionTask';
import { withConversationA2UIModal } from './conversationA2UIModalTask';
import type { TaskResponderContract } from '@orot/agent-runtime';
import { withReplyPreferenceSpan } from './authoredReplyPreferenceSpan';
import { withAuthoredMemorySpan } from './authoredMemorySpanTask';
import type { GroundedRagAnswer } from './task';

/** Memory versions own dates/schema independently of optional layout updates. */
export function versionedConversationMemoryTasks(
  conversationTaskV24: TaskResponderContract<GroundedRagAnswer>,
  weightedTask: TaskResponderContract<GroundedRagAnswer>,
  horizontalListTask: TaskResponderContract<GroundedRagAnswer>,
  alignedVerticalListTask: TaskResponderContract<GroundedRagAnswer>,
) {
  const conversationTaskV25 = withReplyPreferenceSpan(conversationTaskV24);
  const conversationTaskV26 = withAuthoredMemorySpan(conversationTaskV25);
  const conversationTaskV27 = withAuthoredMemorySpan(conversationTaskV25, '27');
  const conversationTaskV28 = withAuthoredMemorySpan(
    withReplyPreferenceSpan(conversationTaskV24, true),
    '28',
  );
  const conversationTaskV31 = withAuthoredMemorySpan(
    withReplyPreferenceSpan(alignedVerticalListTask, true),
    '31',
  );
  const conversationTaskV32 = withConversationA2UIModal(conversationTaskV31);
  const conversationTaskV33 = withFinalConversationCaption(conversationTaskV32);
  const conversationTaskV34 =
    withFinalConversationCardWeight(conversationTaskV33);
  return {
    conversationTaskV25,
    conversationTaskV26,
    conversationTaskV27,
    conversationTaskV28,
    conversationTaskV29: withAuthoredMemorySpan(
      withReplyPreferenceSpan(weightedTask, true),
      '29',
    ),
    conversationTaskV30: withAuthoredMemorySpan(
      withReplyPreferenceSpan(horizontalListTask, true),
      '30',
    ),
    conversationTaskV31,
    conversationTaskSavedLayouts: {
      v32: conversationTaskV32,
      v33: conversationTaskV33,
      v34: conversationTaskV34,
    },
    ragConversationTask: withFinalConversationCheckbox(conversationTaskV34),
  };
}
