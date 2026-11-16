import { AppButton } from '../layout/AppButton';
import { t } from '../i18n';

export interface RetainedHealthActions {
  readonly possibilities?: () => void;
  readonly visitQuestions?: () => void;
  readonly healthSummary?: () => void;
}

/** Submit an explicit in-place purpose without replacing existing input; sender consent still applies. */
export function ConversationRetainedActions({
  actions,
  disabled = false,
  hideVisitQuestions = false,
}: {
  readonly actions?: RetainedHealthActions;
  readonly disabled?: boolean;
  readonly hideVisitQuestions?: boolean;
}) {
  if (!actions) return null;
  return (
    <>
      <AppButton
        title={t('conversationActions.possibilities')}
        testID="conversation-open-possibilities"
        variant="secondary"
        disabled={disabled || !actions.possibilities}
        onPress={actions.possibilities ?? (() => {})}
      />
      {!hideVisitQuestions && (
        <AppButton
          title={t('visitQuestions.conversation.actions.prepare')}
          testID="conversation-open-visit-questions"
          variant="secondary"
          disabled={disabled || !actions.visitQuestions}
          onPress={actions.visitQuestions ?? (() => {})}
        />
      )}
      <AppButton
        title={t('conversationActions.healthSummary')}
        testID="conversation-open-health-summary"
        variant="secondary"
        disabled={disabled || !actions.healthSummary}
        onPress={actions.healthSummary ?? (() => {})}
      />
    </>
  );
}
