import { useState } from 'react';
import type { EvidenceReference } from '@orot/agent-runtime';
import type { VisitQuestionEvidenceItem } from '../../agent/visitQuestions/taskContract';
import { InlineVisitQuestionCard } from '../../nextVisitQuestions/InlineVisitQuestionCard';
import { ActionButton } from '../../nextVisitQuestions/NextVisitComponents';
import { View } from 'react-native';
import { inlineReviewCommitted } from '../../nextVisitQuestions/inlineVisitReview';
import { createInlineVisitSave } from '../../nextVisitQuestions/inlineVisitSave';
import type { NextVisitQuestionsTheme } from '../../nextVisitQuestions/types';
import type { DisplayMessage } from '../../ragConversation/ConversationMessage';
import type { ConversationSessions } from '../../ragConversation/conversationSessions';
import { withConversationVisitSave } from '../../ragConversation/conversationVisitSaveLease';
import type { AiFeatureServices } from './featureServices';
import type { VisitQuestionRouteOperations } from './visitQuestionsRouteOperations';
import type { VisitQuestionRouteSaveResult } from './visitQuestionsRouteSave';

/** Keeps explicit question saves separate from the conversation turn and its own retention. */
export function ConversationVisitQuestionCard({
  message,
  sessionId,
  store,
  operations,
  services,
  onOpenSource,
  theme,
  onRegenerate,
}: {
  readonly message: DisplayMessage;
  readonly sessionId: number;
  readonly store: ConversationSessions;
  readonly operations: VisitQuestionRouteOperations;
  readonly services: Pick<
    AiFeatureServices,
    'resolveSource' | 'registerVisitQuestionSource'
  >;
  readonly onOpenSource: (reference: EvidenceReference) => void;
  readonly theme: NextVisitQuestionsTheme;
  readonly onRegenerate: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const visit = message.visitQuestions!;
  const current = () =>
    store
      .getSnapshot()
      .sessions.find(session => session.id === sessionId)
      ?.messages.find(item => item.id === message.id)?.visitQuestions;
  const save = createInlineVisitSave<
    VisitQuestionEvidenceItem,
    VisitQuestionRouteSaveResult
  >(
    visit.review.ownerKey,
    selection =>
      operations.save({
        appointment: visit.appointment,
        ...selection,
        resolveSource: services.resolveSource,
        validateGeneratedArtifact: visit.validateSource,
      }),
    () => current()?.review.ownerKey === visit.review.ownerKey,
  );
  return (
    <View>
      <InlineVisitQuestionCard
        state={visit.review}
        theme={theme}
        isSaving={saving}
        saveMessage={
          (notice ??
            [
              visit.restorationNotice,
              visit.restoredFromSnapshot
                ? '저장된 질문과 처음 생성된 후보를 불러왔어요. 저장하지 않은 편집은 반영되지 않았을 수 있어요.'
                : '',
            ]
              .filter(Boolean)
              .join(' ')) ||
          undefined
        }
        onChange={review => {
          store.updateVisitQuestionReview(sessionId, message.id, review);
          setNotice(null);
        }}
        onOpenSource={reference => {
          const resolved = services.resolveSource(reference);
          onOpenSource(
            resolved
              ? reference
              : services.registerVisitQuestionSource(reference, signal =>
                  visit.validateSource(reference, signal),
                ),
          );
        }}
        onSave={async () => {
          setSaving(true);
          setNotice(null);
          try {
            const result = await withConversationVisitSave(
              store,
              visit.review.ownerKey,
              () => save(visit.review),
            );
            if (result.status === 'busy') return;
            const outcome = result.value;
            if (outcome.status === 'committed' && outcome.deliverToOwner) {
              const latest = current();
              if (!latest) return;
              if (latest.review !== visit.review) {
                setNotice(
                  '질문 저장 중 다른 변경이 있었어요. 저장된 목록을 다시 불러와 주세요.',
                );
                return;
              }
              store.updateVisitQuestionReview(
                sessionId,
                message.id,
                inlineReviewCommitted(
                  latest.review,
                  outcome.ownerKey,
                  outcome.result.questions,
                ),
                async (reference, signal) =>
                  (await outcome.result.validateSource(reference, signal)) ||
                  (!signal.aborted &&
                    (await latest.validateSource(reference, signal))),
              );
              setNotice(
                outcome.result.memoryStatus === 'saved'
                  ? '질문을 저장했어요.'
                  : '질문은 저장됐지만 검색 반영은 다시 시도해야 해요.',
              );
            } else if (outcome.status === 'failed' && outcome.deliverToOwner)
              setNotice(
                '질문을 저장하지 못했어요. 예약과 근거를 확인하고 다시 시도해 주세요.',
              );
          } finally {
            setSaving(false);
          }
        }}
      />
      <ActionButton
        label="질문 다시 만들기"
        disabled={saving}
        onPress={onRegenerate}
        theme={theme}
        testID="inline-visit-regenerate"
      />
    </View>
  );
}
