import { withConversationA2UIRichText } from './conversationA2UIRichText';
import { withConversationA2UIModalPair } from './conversationA2UIModalPairTask';
import {
  withComposedConversationSections,
  withFinalConversationRepeatedChildren,
} from './conversationA2UIRepeatedChildrenTask';
import { withFinalConversationChoice } from './conversationA2UIChoiceTask';
import { withFinalConversationCheckbox } from './conversationA2UICheckboxTask';
import { withFinalConversationCardWeight } from './conversationA2UICardWeightTask';
import { withFinalConversationCaption } from './conversationA2UICaptionTask';
import { withConversationA2UIModal } from './conversationA2UIModalTask';
import type {
  TaskResponderContract,
  TaskResponderInput,
} from '@orot/agent-runtime';
import { withReplyPreferenceSpan } from './authoredReplyPreferenceSpan';
import { withAuthoredMemorySpan } from './authoredMemorySpanTask';
import type { GroundedRagAnswer } from './task';

/** Memory versions own dates/schema independently of optional layout updates. */
export function versionedConversationMemoryTasks(
  conversationTaskV24: TaskResponderContract<GroundedRagAnswer>,
  weightedTask: TaskResponderContract<GroundedRagAnswer>,
  horizontalListTask: TaskResponderContract<GroundedRagAnswer>,
  alignedVerticalListTask: TaskResponderContract<GroundedRagAnswer>,
  allowsOrdinaryA2UI: (input: TaskResponderInput) => boolean,
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
  const conversationTaskV35 =
    withFinalConversationCheckbox(conversationTaskV34);
  const conversationTaskV36 = withFinalConversationChoice(conversationTaskV35);
  const conversationTaskV37 = withFinalConversationRepeatedChildren(
    conversationTaskV36,
    allowsOrdinaryA2UI,
  );
  const conversationTaskV38 =
    withComposedConversationSections(conversationTaskV37);
  const conversationTaskV39 =
    withConversationA2UIModalPair(conversationTaskV38);
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
      v35: conversationTaskV35,
      v36: conversationTaskV36,
      v37: conversationTaskV37,
      v38: conversationTaskV38,
      v39: conversationTaskV39,
    },
    ragConversationTask: withConversationA2UIRichText(conversationTaskV39),
  };
}
