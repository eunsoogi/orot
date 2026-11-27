import type { ConversationTemplateProposal } from '@orot/agent-runtime';
import type { RagConversationObserver } from './conversationObserver';
import type { ConversationEntryContext } from '../aiFeatures/integration/conversationIntent';

/** A model cannot choose an appointment, date, provider, record, or consent grant. */
export function conversationTemplateTarget(
  intent: ConversationTemplateProposal | undefined,
  admission: NonNullable<RagConversationObserver['modelTemplateAdmission']>,
  canCreateDaily: boolean,
): ConversationEntryContext | undefined {
  switch (intent) {
    case 'visit-questions-followup':
      return admission.prepareVisit && admission.visitFollowup
        ? {
            intent: 'visit-questions',
            entryKey: 'model-visit-questions',
            appointmentId: admission.visitFollowup.appointmentId,
          }
        : undefined;
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
