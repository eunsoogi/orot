import type { FeatureScreenRoute } from './aiFeatureNavigation';
import type { DailyReportContextRequest } from '@orot/domain';
import { t } from '../../i18n';

/** Entry intent stays separate from editable text for downstream conversation tools. */
export type ConversationIntent =
  | 'conversation'
  | 'health-summary'
  | 'possibilities'
  | 'visit-questions'
  | 'medical-literature';

/** Retains the exact Home target; consumers must revalidate it rather than choose another visit. */
export interface ConversationEntryContext {
  readonly intent: ConversationIntent;
  readonly entryKey: string;
  readonly appointmentId?: string;
}

/** Explicit daily-report requests stay typed and separate from ordinary conversation text. */
export interface DailyReportConversationIntent {
  readonly kind: 'daily-report';
  readonly entryKey: string;
  readonly request: DailyReportContextRequest;
}

export const conversationIntentRequests: Record<ConversationIntent, string> = {
  conversation: '',
  'health-summary': t('conversationIntent.healthSummary'),
  possibilities: t('conversationIntent.possibilities'),
  'visit-questions': t('conversationIntent.visitQuestions'),
  'medical-literature': t('conversationIntent.medicalLiterature'),
};

/** Legacy links keep their meaning while using the same conversation surface. */
export function conversationIntentForRoute(
  route: FeatureScreenRoute,
): ConversationIntent | null {
  switch (route) {
    case 'entry':
    case 'rag-conversation':
      return 'conversation';
    case 'health-summary':
      return 'health-summary';
    case 'disease-hypotheses':
      return 'possibilities';
    case 'visit-questions':
      return 'visit-questions';
    case 'external-evidence':
      return 'medical-literature';
    default:
      return null;
  }
}
