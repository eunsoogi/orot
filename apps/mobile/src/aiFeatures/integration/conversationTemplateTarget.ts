import type { ConversationTemplateProposal } from '@orot/agent-runtime';
import type { RagConversationObserver } from '../../ragConversation/conversationObserver';
import type { ConversationEntryContext } from './conversationIntent';

/** A model cannot choose an appointment, date, provider, record, or consent grant. */
export function conversationTemplateTarget(
  intent: ConversationTemplateProposal | undefined,
  admission: NonNullable<RagConversationObserver['modelTemplateAdmission']>,
  canCreateDaily: boolean,
): ConversationEntryContext | undefined {
  switch (intent) {
    case 'visit-questions':
      return admission.prepareVisit
        ? { intent, entryKey: 'model-visit-questions' }
        : undefined;
    case 'daily-report':
      return admission.today && canCreateDaily
        ? {
            intent,
            entryKey: 'model-daily-report',
            reportRequest: admission.today,
          }
        : undefined;
    case 'health-summary':
      return { intent, entryKey: 'model-health-summary' };
    case 'possibilities':
      return {
        intent,
        entryKey: 'model-possibilities',
        typedPossibilityReport: true,
      };
    default:
      return undefined;
  }
}
