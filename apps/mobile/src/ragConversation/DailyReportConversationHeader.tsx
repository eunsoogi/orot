import { AppText } from '../layout/AppText';
import { AppButton } from '../layout/AppButton';
import { t } from '../i18n';
import type { ConversationEntryContext } from '../aiFeatures/integration/conversationIntent';

/** The selected session identifies the report without silently transmitting its content. */
export function DailyReportConversationHeader({
  report,
  onRequest,
}: {
  report?: ConversationEntryContext['dailyReport'];
  onRequest?: () => void;
}) {
  return (
    <>
      {report ? (
        <AppText>
          {t('dailyReport.followUpIdentity', {
            date: report.identity.localDate,
            zone: report.identity.timeZone,
          })}
          {'\n'}
          {t('dailyReport.chatNote')}
        </AppText>
      ) : null}
      {onRequest ? (
        <AppButton
          title={t('dailyReport.openFromChat')}
          testID="daily-report-request"
          variant="secondary"
          onPress={onRequest}
        />
      ) : null}
    </>
  );
}
