import type { ConversationTemplateProposal } from '@orot/agent-runtime';
import { conversationTemplateTarget } from '../../aiFeatures/integration/conversationTemplateTarget';
import type { ConversationScreenProps } from '../ConversationScreenProps';

/** Provider choices are scripted in tests. The app still owns dates, Visit dispatcher and markers. */
export function scriptedTemplateSender(
  send: ConversationScreenProps['onSend'],
  decide: (
    question: string,
  ) => ConversationTemplateProposal | Promise<ConversationTemplateProposal>,
): ConversationScreenProps['onSend'] {
  return async (question, history, signal, observer, context) => {
    const admission = observer?.modelTemplateAdmission;
    if (!admission || observer.photoInput)
      return send(question, history, signal, observer, context);
    const choice = await decide(question);
    if (signal?.aborted || !admission.current())
      return { status: 'failure', kind: 'cancelled' };
    const target = conversationTemplateTarget(choice, admission, true);
    return target?.intent === 'visit-questions' && admission.prepareVisit
      ? admission.prepareVisit(question, history, signal, observer, target)
      : send(question, history, signal, observer, target ?? context);
  };
}
