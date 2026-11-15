import { AppButton } from '../layout/AppButton';
import { t } from '../i18n';

export interface RetainedHealthActions {
  readonly possibilities?: () => void;
  readonly visitQuestions?: () => void;
  readonly healthSummary?: () => void;
}

/** Open the existing intent routes, preserving draft ownership and explicit-send consent. */
export function ConversationRetainedActions({
  actions,
}: {
  readonly actions?: RetainedHealthActions;
}) {
  if (!actions) return null;
  return (
    <>
      <AppButton
        title={t('conversationActions.possibilities')}
        testID="conversation-open-possibilities"
        variant="secondary"
        disabled={!actions.possibilities}
        onPress={actions.possibilities ?? (() => {})}
      />
      <AppButton
        title={t('visitQuestions.conversation.actions.prepare')}
        testID="conversation-open-visit-questions"
        variant="secondary"
        disabled={!actions.visitQuestions}
        onPress={actions.visitQuestions ?? (() => {})}
      />
      <AppButton
        title={t('conversationActions.healthSummary')}
        testID="conversation-open-health-summary"
        variant="secondary"
        disabled={!actions.healthSummary}
        onPress={actions.healthSummary ?? (() => {})}
      />
    </>
  );
}
