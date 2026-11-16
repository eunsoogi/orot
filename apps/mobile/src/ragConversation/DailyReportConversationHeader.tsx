import { AppButton } from '../layout/AppButton';
import { t } from '../i18n';
import type { ConversationEntryContext } from '../aiFeatures/integration/conversationIntent';

/** Render the explicit request only; report identity stays in session state, not redundant prose. */
export function DailyReportConversationHeader({
  onRequest,
  disabled = false,
}: {
  report?: ConversationEntryContext['dailyReport'];
  onRequest?: () => void;
  disabled?: boolean;
}) {
  return (
    <>
      {onRequest ? (
        <AppButton
          title={t('dailyReport.openFromChat')}
          testID="daily-report-request"
          variant="secondary"
          disabled={disabled}
          onPress={onRequest}
        />
      ) : null}
    </>
  );
}
