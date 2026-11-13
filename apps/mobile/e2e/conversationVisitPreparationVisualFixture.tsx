import type { Appointment } from '@orot/domain';
import { ConversationVisitQuestionCard } from '../src/aiFeatures/integration/ConversationVisitQuestionCard';
import { createNextVisitQuestionsTheme } from '../src/aiFeatures/integration/nextVisitQuestionsRoutePresentation';
import type { AiFeatureServices } from '../src/aiFeatures/integration/featureServices';
import type { VisitQuestionEvidenceItem } from '../src/agent/visitQuestions/taskContract';
import type { ConversationScreenProps } from '../src/ragConversation/ConversationScreenProps';
import type { VisitQuestionRouteOperations } from '../src/aiFeatures/integration/visitQuestionsRouteOperations';
import { createInlineVisitReview } from '../src/nextVisitQuestions/inlineVisitReview';
import type { NextVisitQuestion } from '../src/nextVisitQuestions/types';

const appointment: Appointment = {
  id: 'synthetic-conversation-visit',
  effectiveAt: '2035-06-02T09:30:00.000Z',
  recordedAt: '2035-01-01T00:00:00.000Z',
  ingestedAt: '2035-01-01T00:00:00.000Z',
  provenance: { origin: 'user_reported', sourceRecordIds: [] },
  reviewState: { status: 'unreviewed' },
  status: 'scheduled',
  clinicLabel: '합성 진료 예약',
};

const question: NextVisitQuestion<VisitQuestionEvidenceItem> = {
  questionText:
    '진료 전에 지난 한 달 동안 증상이 처음 시작된 날짜와 강도를 기록한 시점, 복용 중인 약의 변경 시기, 수면과 활동량의 변화가 서로 어떤 순서로 나타났는지 의사에게 어떻게 설명하면 좋을까요?',
  rationale:
    '합성 질문은 큰 글자와 실제 소프트웨어 키보드가 열린 상태에서도 검토할 수 있도록 긴 문장으로 구성했어요.',
  priority: 'routine',
  citations: [],
};

const visitQuestions = {
  appointment,
  review: createInlineVisitReview(
    'synthetic-conversation-visit-owner',
    [],
    [question],
    [],
    () => 'synthetic-conversation-question',
  ),
  validateSource: async (_reference: VisitQuestionEvidenceItem, signal: AbortSignal) =>
    !signal.aborted,
};

/** This fixture returns local synthetic content only; it never reads records or invokes a provider. */
const prepareVisitQuestions: NonNullable<
  ConversationScreenProps['prepareVisitQuestions']
> = async (_request, _history, signal, _observer, context) => {
  if (signal?.aborted) return { status: 'failure', kind: 'cancelled' };
  if (
    context?.intent !== 'visit-questions' ||
    context.appointmentId !== appointment.id
  )
    return { status: 'failure', kind: 'visit_no_appointment' };
  return {
    status: 'answer',
    answer: '합성 질문을 준비했어요.',
    citations: [],
    visitQuestions,
  };
};

const operations: VisitQuestionRouteOperations = {
  loadAppointment: async () => appointment,
  generate: async () => ({ status: 'cancelled' }),
  save: async () => {
    throw new Error('The synthetic conversation fixture does not save questions.');
  },
};
const services: Pick<
  AiFeatureServices,
  'resolveSource' | 'registerVisitQuestionSource'
> = {
  resolveSource: () => undefined,
  registerVisitQuestionSource: reference => reference,
};

/** Opt-in screen props exercise the production entry action and inline review card without external work. */
export const conversationVisitPreparationVisualProps: Pick<
  ConversationScreenProps,
  'entryContext' | 'prepareVisitQuestions' | 'renderVisitQuestions'
> = {
  entryContext: {
    intent: 'visit-questions',
    entryKey: 'synthetic-home-visit',
    appointmentId: appointment.id,
  },
  prepareVisitQuestions,
  renderVisitQuestions: (message, sessionId, store, onRegenerate) => (
    <ConversationVisitQuestionCard
      message={message}
      sessionId={sessionId}
      store={store}
      operations={operations}
      services={services}
      onOpenSource={() => undefined}
      theme={createNextVisitQuestionsTheme(false)}
      onRegenerate={onRegenerate}
    />
  ),
};
