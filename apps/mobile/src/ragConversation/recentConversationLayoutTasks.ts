import type { TaskResponderContract } from '@orot/agent-runtime';
import { observeConversationA2UIFinalAdmission } from './conversationA2UIFinalDiagnostic';
import { withConversationA2UIOrdinals } from './conversationA2UIOrdinalTask';
import { withPublicWebConversationLayout } from './conversationA2UIPublicWebLayout';
import { withConversationA2UITabSelectionLifetime } from './conversationA2UITabSelectionLifetime';
import type { GroundedRagAnswer } from './task';

type CurrentFormLayout = (
  multiline: true,
  filterable: 'chips',
  mixedWeights: true,
  folderIcon: 'grouped',
  checklistProse: 'mixed' | 'markdown',
  numeric: true,
  combinedDateTime: true,
) => TaskResponderContract<GroundedRagAnswer>;

/** Keep prior request-and-restore grammar exact while opting in for new sends. */
export function recentConversationLayoutTasks(form: CurrentFormLayout) {
  const layout = (checklist: 'mixed' | 'markdown') =>
    withPublicWebConversationLayout(
      withConversationA2UITabSelectionLifetime(
        form(true, 'chips', true, 'grouped', checklist, true, true),
        '60',
      ),
      '67',
    );
  const previous = layout('mixed');
  return {
    v67: observeConversationA2UIFinalAdmission(previous),
    v68: observeConversationA2UIFinalAdmission(
      withConversationA2UIOrdinals(previous),
    ),
    current: observeConversationA2UIFinalAdmission(
      withConversationA2UIOrdinals(layout('markdown'), '69'),
    ),
  };
}
