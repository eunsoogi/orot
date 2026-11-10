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
import { t } from '../../i18n';
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
                ? t('visitQuestions.conversation.restorationNotice')
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
                setNotice(t('visitQuestions.conversation.save.conflict'));
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
                  ? t('visitQuestions.conversation.save.saved')
                  : t('visitQuestions.conversation.save.searchPending'),
              );
            } else if (outcome.status === 'failed' && outcome.deliverToOwner)
              setNotice(t('visitQuestions.conversation.save.failed'));
          } finally {
            setSaving(false);
          }
        }}
      />
      <ActionButton
        label={t('visitQuestions.conversation.actions.regenerate')}
        disabled={saving}
        onPress={onRegenerate}
        theme={theme}
        testID="inline-visit-regenerate"
      />
    </View>
  );
}
