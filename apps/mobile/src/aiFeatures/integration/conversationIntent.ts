import type { FeatureScreenRoute } from './aiFeatureNavigation';
import type { DailyReportContextRequest } from '@orot/domain';

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
  'health-summary': '최근 건강 기록을 날짜와 근거 출처와 함께 요약해 주세요.',
  possibilities:
    '건강 기록에서 검토할 가능성을 지지·반대 근거와 불확실성을 구분해 설명해 주세요.',
  'visit-questions':
    '다음 진료에서 물어볼 질문을 기록과 근거를 바탕으로 준비해 주세요.',
  'medical-literature':
    '관련 의학 문헌을 찾아 출처를 확인할 수 있게 설명해 주세요.',
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
